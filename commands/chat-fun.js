// Fun additions: quotes, internet jokes, chat toys (echo/quoted/react) and
// the small social games (rate/love). Offline where possible so they never
// depend on a provider being awake.
import { getContextInfo, normalizeJid, messageText } from "../lib/message-utils.js";

const QUOTES = Object.freeze([
  "Discipline is choosing between what you want now and what you want most.",
  "Small daily wins beat rare dramatic ones.",
  "You do not rise to your goals; you fall to your systems.",
  "The person who moves a mountain begins with small stones.",
  "Energy flows where attention goes.",
  "Consistency is what transforms average into excellence.",
  "Do the hard thing while it is still easy to skip.",
  "Comparison steals the joy of your own progress.",
  "Start where you are. Use what you have. Do what you can.",
  "A calm mind is a strong mind.",
  "What you tolerate, you teach.",
  "Better done than perfect; better perfect than never.",
  "Focus is saying no to a thousand good ideas.",
  "The best time to plant a tree was years ago. The second best is now.",
  "Your future self is watching you through memories.",
  "Quiet work, loud results.",
  "You cannot pour from an empty cup — rest is productive.",
  "Courage is not the absence of fear, but action with it.",
  "Learn like you will live forever; build like you will die tomorrow.",
  "Every expert was once a beginner who kept going."
]);

const RATE_QUIPS = Object.freeze({
  9: "Top tier. Almost suspicious.",
  8: "Solid. Respect.",
  7: "Good — good enough to brag, careful enough to improve.",
  6: "Above average. Keep going.",
  5: "Balanced. Middle of the road.",
  4: "There is room to grow.",
  3: "Bold of you to ask.",
  2: "Ouch. But recoverable.",
  1: "Catastrophic, and honestly entertaining."
});

function seededPercent(left, right) {
  const pair = [left, right].sort().join("|").toLowerCase();
  let hash = 7;
  for (const char of pair) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }
  return 55 + (hash % 46); // always a positive, believable 55–100%
}

const commands = [
  {
    name: "quote",
    category: "Fun",
    description: "A short thought for the day.",
    run: async ctx => {
      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      await ctx.reply("💭 *" + quote + "*\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ");
    }
  },
  {
    name: "randomjoke",
    category: "Fun",
    description: "A random joke from the internet.",
    run: async ctx => {
      const response = await fetch("https://v2.jokeapi.dev/joke/Any?type=single,twopart&safe-mode", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error("The joke service returned HTTP " + response.status + ".");
      const joke = await response.json();
      if (joke?.error) throw new Error("The joke service is out of jokes right now.");
      const text = joke.type === "twopart"
        ? joke.setup + "\n\n..." + joke.delivery
        : joke.joke;
      await ctx.reply("😂 " + text);
    }
  },
  {
    name: "echo",
    category: "Fun",
    description: "Repeat your text back.",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("Give me something to echo: " + ctx.config.prefix + "echo DamzD is live");
      if (text.length > 2000) throw new Error("Keep it under 2000 characters.");
      await ctx.reply(text);
    }
  },
  {
    name: "quoted",
    category: "Fun",
    description: "Repeat the text of a replied-to message.",
    run: async ctx => {
      const info = getContextInfo(ctx.msg?.message);
      const text = info?.quotedMessage ? messageText(info.quotedMessage) : "";
      if (!text) throw new Error("Reply to a text message with " + ctx.config.prefix + "quoted to repeat it.");
      await ctx.reply("🔁 " + text.slice(0, 2000));
    }
  },
  {
    name: "react",
    category: "Fun",
    description: "React to a message, e.g. .react 🔥",
    run: async ctx => {
      const emoji = String(ctx.args || "").trim();
      if (!emoji || [...emoji].length > 8 || !/\p{Extended_Pictographic}/u.test(emoji)) {
        throw new Error("Send one emoji: " + ctx.config.prefix + "react 🔥 (reply to a message to target it)");
      }
      const info = getContextInfo(ctx.msg?.message);
      const key = info?.stanzaId
        ? {
            remoteJid: ctx.jid,
            id: String(info.stanzaId),
            fromMe: Boolean(normalizeJid(info.participant || "") &&
              [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).includes(normalizeJid(info.participant))),
            ...(info.participant ? { participant: normalizeJid(info.participant) } : {})
          }
        : ctx.msg.key;
      await ctx.sock.sendMessage(ctx.jid, { react: { text: emoji, key } });
    }
  },
  {
    name: "rate",
    category: "Games",
    description: "Rate anything out of ten.",
    run: async ctx => {
      const thing = String(ctx.args || "").trim();
      if (!thing) throw new Error("What should I rate? " + ctx.config.prefix + "rate jollof rice");
      const score = 1 + Math.floor(Math.random() * 10);
      await ctx.reply("📊 *" + thing.slice(0, 120) + "* scores *" + score + "/10*.\n" +
        (RATE_QUIPS[score] || "") + "\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ");
    }
  },
  {
    name: "love",
    category: "Games",
    description: "Match two names, separated by |.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      const parts = raw.split("|").map(part => part.trim()).filter(Boolean);
      if (parts.length !== 2) throw new Error("Give two names: " + ctx.config.prefix + "love Layo | DamzD");
      const [left, right] = parts;
      if (left.length > 60 || right.length > 60) throw new Error("Keep each name under 60 characters.");
      const percent = seededPercent(left, right);
      const verdict = percent >= 90 ? "Wedding bells incoming 🔔💍"
        : percent >= 75 ? "Strong match — do not mess it up 💞"
        : percent >= 65 ? "Solid chemistry with a little drama 🌶️"
        : "It could work with patience 🌱";
      await ctx.reply("💕 *LOVE METER*\n" + left + " 💗 " + right + "\nMatch: *" + percent + "%*\n" + verdict +
        "\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ");
    }
  }
];

export default commands;
