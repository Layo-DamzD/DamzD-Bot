import { pick, randomInt } from "../src/utils.js";
import { defineWord } from "../src/apis.js";

// Word Chain (.wcg) — a lobby game. The bot gives a starting word; each
// player, in turn, sends ".wcg <word>" beginning with the previous word's
// last letter. Words are validated against the free dictionary API.

const lobbies = new Map();
const LOBBY_TTL_MS = 120000;
const TURN_TTL_MS = 45000;

function cleanupExpired() {
  const now = Date.now();
  for (const [jid, lobby] of lobbies) {
    if (now > lobby.expiresAt || (lobby.started && now > lobby.turnExpiresAt)) {
      lobbies.delete(jid);
    }
  }
}

function describePlayer(lobby, number) {
  const player = lobby.players.get(number);
  return player ? (player.name ? player.name + " (+" + number + ")" : "+" + number) : "+" + number;
}

export default [
  {
    name: "wcg",
    aliases: ["wrg"],
    category: "Games",
    description: "multiplayer Word Chain lobby",
    run: async ctx => {
      cleanupExpired();
      const arg = String(ctx.args || "").trim().toLowerCase();
      const lobby = lobbies.get(ctx.jid);

      if (arg === "join") {
        if (!lobby || lobby.started) throw new Error("no open lobby here — start one with " + ctx.config.prefix + "wcg");
        if (lobby.players.has(ctx.senderNumber)) throw new Error("you are already in this lobby");
        lobby.players.set(ctx.senderNumber, { name: ctx.pushName || "", order: lobby.players.size });
        await ctx.reply(
          "✋ @" + ctx.senderNumber + " joined (" + lobby.players.size + " player" + (lobby.players.size === 1 ? "" : "s") + ").",
          { mentions: [ctx.sender] }
        );
        return;
      }

      if (arg === "start" || (lobby && !lobby.started && !arg)) {
        if (!lobby) throw new Error("no lobby here yet — type " + ctx.config.prefix + "wcg to create one, " + ctx.config.prefix + "wcg join to enter");
        if (lobby.players.size < 2) throw new Error("you need at least 2 players — invite people with " + ctx.config.prefix + "wcg join");
        const starters = ["table", "music", "sunny", "bridge", "planet", "silver", "garden", "window"];
        lobby.started = true;
        lobby.word = pick(starters);
        lobby.chain = [lobby.word];
        lobby.turn = 0;
        lobby.turnExpiresAt = Date.now() + TURN_TTL_MS;
        lobby.expiresAt = Date.now() + 1800000;
        const order = [...lobby.players.keys()];
        await ctx.reply(
          "🎬 *Word Chain begins!*\n\nStarting word: *" + lobby.word + "*\n" +
          "First up: @" + order[0] + " — send " + ctx.config.prefix + "wcg <word> starting with *" + lobby.word.slice(-1).toUpperCase() + "*.\n" +
          "You have 45 seconds per turn.",
          { mentions: [order[0] + "@s.whatsapp.net"] }
        );
        return;
      }

      if (!lobby || !lobby.started) {
        lobbies.set(ctx.jid, {
          players: new Map([[ctx.senderNumber, { name: ctx.pushName || "", order: 0 }]]),
          started: false,
          expiresAt: Date.now() + LOBBY_TTL_MS
        });
        await ctx.reply(
          "🔤 *Word Chain lobby open!*\n\n@" + ctx.senderNumber + " created a lobby.\n" +
          "Type " + ctx.config.prefix + "wcg join to enter (need at least 2 players), then " + ctx.config.prefix + "wcg start.",
          { mentions: [ctx.sender] }
        );
        return;
      }

      // In a started lobby: treat the argument as the player's word.
      const word = arg.replace(/[^a-z-]/g, "");
      if (!word) {
        throw new Error("send your word like this: " + ctx.config.prefix + "wcg apple");
      }
      const order = [...lobby.players.keys()];
      const expected = order[lobby.turn % order.length];
      if (ctx.senderNumber !== expected) {
        throw new Error("it is @" + expected + "'s turn — hold on");
      }
      if (lobby.chain.includes(word)) {
        throw new Error("*" + word + "* has already been used in this chain");
      }
      if (word[0] !== lobby.word.slice(-1)) {
        throw new Error("it must start with *" + lobby.word.slice(-1).toUpperCase() + "* — " + lobby.word + " → ?");
      }
      await ctx.typing(1000);
      const real = await defineWord(word);
      if (!real) {
        lobby.turn = (lobby.turn + 1) % order.length;
        lobby.turnExpiresAt = Date.now() + TURN_TTL_MS;
        const next = order[lobby.turn % order.length];
        await ctx.reply(
          "❌ *\"" + word + "\"* is not in the dictionary. @" + ctx.senderNumber + " loses this round!\n\n" +
          "Chain so far: " + lobby.chain.join(" → ") + "\n" +
          "New word from @" + next + " on *" + lobby.word + "* or start fresh with " + ctx.config.prefix + "wcg.",
          { mentions: [ctx.sender, next + "@s.whatsapp.net"] }
        );
        lobbies.delete(ctx.jid);
        return;
      }
      lobby.chain.push(word);
      lobby.word = word;
      lobby.turn = (lobby.turn + 1) % order.length;
      lobby.turnExpiresAt = Date.now() + TURN_TTL_MS;
      const next = order[lobby.turn % order.length];
      await ctx.reply(
        "✅ *" + word + "* accepted. Chain: " + lobby.chain.slice(-6).join(" → ") + "\n" +
        "Your move @" + next + " — next word starts with *" + word.slice(-1).toUpperCase() + "*.",
        { mentions: [next + "@s.whatsapp.net"] }
      );
    }
  }
];
