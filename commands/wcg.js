// .wcg — Multiplayer Word Chain lobby. Players join a lobby, the first
// chain word is given, and each player in turn sends .wcg <word> where the
// word starts with the previous word's last letter. Miss your 60-second
// window and you sit out; last brain standing wins. State is per-group,
// in-memory, and cleaned up automatically.
import { numberFromJid } from "../lib/message-utils.js";

const MIN_WORD_LENGTH = 3;
const TURN_SECONDS = 60;
const MAX_PLAYERS = 30;

const lobbies = new Map(); // groupJid -> game

function freshLobby(hostNumber) {
  return {
    phase: "lobby", // lobby | chain | ended
    players: [],
    host: hostNumber,
    order: [],
    turn: 0,
    lastWord: "",
    used: new Set(),
    deadline: 0,
    timer: null,
    scores: new Map(),
    createdAt: Date.now()
  };
}

function playerNumber(jid) {
  return numberFromJid(jid);
}

function mentionList(game) {
  return game.order.map(number => number + "@s.whatsapp.net");
}

function board(game) {
  return game.order
    .map((number, index) => (index === game.turn ? "▶️ " : "• ") + "+" + number +
      (game.scores.get(number) ? " — " + game.scores.get(number) + " word(s)" : ""))
    .join("\n");
}

function scheduleTurnCheck(ctx, game) {
  if (game.timer) clearTimeout(game.timer);
  const remaining = Math.max(1000, game.deadline - Date.now());
  game.timer = setTimeout(() => {
    void timeOutPlayer(ctx, game).catch(() => {});
  }, remaining);
}

async function timeOutPlayer(ctx, game) {
  if (game.phase !== "chain") return;
  const skipped = game.order[game.turn];
  game.order.splice(game.turn, 1);
  if (game.turn >= game.order.length) game.turn = 0;

  if (game.order.length <= 1) {
    await endGame(ctx, game, skipped
      ? "+ " + skipped + " ran out of time. That ends the chain!"
      : "The chain has ended!");
    return;
  }
  await ctx.sock.sendMessage(ctx.jid, {
    text: "⏰ +" + skipped + " missed the " + TURN_SECONDS + "s window and sits out.\n\n" +
      "Next word starts with *" + game.lastWord.slice(-1).toUpperCase() + "*\n" +
      "Now: +" + game.order[game.turn] + "\n\n" + board(game),
    mentions: mentionList(game)
  });
  game.deadline = Date.now() + TURN_SECONDS * 1000;
  scheduleTurnCheck(ctx, game);
}

async function endGame(ctx, game, closingLine) {
  game.phase = "ended";
  if (game.timer) clearTimeout(game.timer);
  const winner = game.order[0];
  const scoreboard = [...game.scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([number, score], index) => (index + 1) + ". +" + number + " — " + score)
    .join("\n");
  lobbies.delete(ctx.jid);
  await ctx.sock.sendMessage(ctx.jid, {
    text: "🏁 *WORD CHAIN FINISHED*\n" + (closingLine || "") + "\n\n" +
      (winner ? "🏆 Winner: +" + winner + "\n" : "") +
      (scoreboard ? "\n*Scores:*\n" + scoreboard : "\nThe chain collapsed early — no scores."),
    mentions: winner ? [winner + "@s.whatsapp.net"] : []
  });
}

function usage(prefix) {
  return "How to play:\n" +
    prefix + "wcg — open/join the lobby\n" +
    prefix + "wcg start — the host begins the chain\n" +
    prefix + "wcg <word> — play your turn when the chain is live\n" +
    prefix + "wcg board — show the state\n" +
    prefix + "wcg stop — the host ends the game";
}

const commands = [
  {
    name: "wcg",
    category: "Games",
    description: "Multiplayer Word Chain lobby.",
    run: async ctx => {
      if (!ctx.jid.endsWith("@g.us")) {
        throw new Error("Word Chain is a group game. Open a lobby inside a group.");
      }
      const arg = String(ctx.args || "").trim().toLowerCase();
      const me = playerNumber(ctx.senderJid || ctx.msg?.key?.participant || "");
      const prefix = ctx.config.prefix;

      const existing = lobbies.get(ctx.jid);
      if (existing?.phase === "chain" && arg && !["board", "stop"].includes(arg)) {
        // A chain move.
        const word = arg.replace(/[^a-z]/g, "");
        const expectedPlayer = existing.order[existing.turn];
        if (!me || me !== expectedPlayer) {
          await ctx.reply("It is +" + expectedPlayer + "'s turn — wait for your name. ⏳");
          return;
        }
        if (!word || word.length < MIN_WORD_LENGTH) {
          await ctx.reply("Use a real word of at least " + MIN_WORD_LENGTH + " letters: " + prefix + "wcg <word>");
          return;
        }
        if (existing.used.has(word)) {
          await ctx.reply("⌛ *" + word + "* was already used in this chain. Try another.");
          return;
        }
        if (existing.lastWord && !word.startsWith(existing.lastWord.slice(-1))) {
          await ctx.reply("The word must start with *" + existing.lastWord.slice(-1).toUpperCase() +
            "* (last letter of *" + existing.lastWord + "*).");
          return;
        }
        existing.used.add(word);
        existing.lastWord = word;
        existing.scores.set(me, (existing.scores.get(me) || 0) + 1);
        existing.turn = (existing.turn + 1) % existing.order.length;
        existing.deadline = Date.now() + TURN_SECONDS * 1000;
        scheduleTurnCheck(ctx, existing);
        await ctx.sock.sendMessage(ctx.jid, {
          text: "✅ *" + word + "* accepted by +" + me +
            ".\nNext word starts with *" + word.slice(-1).toUpperCase() + "*\nNow: +" +
            existing.order[existing.turn] + " (" + TURN_SECONDS + "s)",
          mentions: [existing.order[existing.turn] + "@s.whatsapp.net"]
        });
        return;
      }

      if (!existing || existing.phase === "ended") {
        const lobby = freshLobby(me);
        lobby.players.push(me);
        lobbies.set(ctx.jid, lobby);
        await ctx.reply("🧩 *WORD CHAIN LOBBY OPENED* by +" + me +
          ".\nPlayers: 1/" + MAX_PLAYERS + "\n\nJoin with " + prefix + "wcg — the host starts with " +
          prefix + "wcg start\n\n" + usage(prefix));
        return;
      }

      if (["board", "status"].includes(arg)) {
        await ctx.reply(existing.phase === "lobby"
          ? "🧩 *LOBBY*\nHost: +" + existing.host + "\nPlayers:\n" +
            existing.players.map((number, index) => (index + 1) + ". +" + number).join("\n")
          : "🧩 *WORD CHAIN*\nLast word: *" + existing.lastWord + "*\nNext starts with *" +
            existing.lastWord.slice(-1).toUpperCase() + "*\n\n" + board(existing));
        return;
      }

      if (arg === "stop") {
        if (me !== existing.host && !ctx.owner) {
          await ctx.reply("Only the host (+" + existing.host + ") can stop the game.");
          return;
        }
        await endGame(ctx, existing, "Stopped by the host.");
        return;
      }

      if (arg === "start") {
        if (me !== existing.host) {
          await ctx.reply("Only the host (+" + existing.host + ") can start the chain.");
          return;
        }
        if (existing.players.length < 2) {
          await ctx.reply("Need at least 2 players. Invite people to join with " + prefix + "wcg first.");
          return;
        }
        existing.phase = "chain";
        existing.order = [...existing.players].sort(() => Math.random() - 0.5);
        existing.turn = 0;
        existing.lastWord = "";
        existing.used = new Set();
        existing.deadline = Date.now() + TURN_SECONDS * 1000;
        scheduleTurnCheck(ctx, existing);
        const starter = existing.order[0];
        const firstLetter = "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
        await ctx.sock.sendMessage(ctx.jid, {
          text: "🎬 *CHAIN STARTED!*\nPlayers: " + existing.order.map(n => "+" + n).join(", ") +
            "\n\n+" + starter + " goes first: send " + prefix + "wcg <word> starting with *" +
            firstLetter.toUpperCase() + "*\n" + TURN_SECONDS + " seconds per turn!",
          mentions: mentionList(existing)
        });
        existing.lastWord = firstLetter; // a bare letter still validates the first move
        return;
      }

      if (arg === "") {
        if (existing.players.includes(me)) {
          await ctx.reply("You are already in the lobby (" + existing.players.length + "/" + MAX_PLAYERS + ").");
          return;
        }
        if (existing.players.length >= MAX_PLAYERS) {
          await ctx.reply("The lobby is full (" + MAX_PLAYERS + " players).");
          return;
        }
        existing.players.push(me);
        await ctx.reply("🙋 +" + me + " joined the Word Chain lobby (" +
          existing.players.length + "/" + MAX_PLAYERS + "). Host: +" + existing.host +
          "\n" + prefix + "wcg start to begin.");
        return;
      }

      await ctx.reply(usage(prefix));
    }
  }
];

export default commands;
