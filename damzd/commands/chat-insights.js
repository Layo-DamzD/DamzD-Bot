// Group conversation extras: .tldr, .lore and .roast read DamzD's rolling
// in-memory chat log (src/damzd/chat-log.js — last hour of text, nothing
// persisted), and .del manages DamzD's own messages.
import { getContextInfo, normalizeJid, numberFromJid } from "../lib/message-utils.js";
import { recentChatMessages, chatLogSize } from "../src/damzd/chat-log.js";

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "this", "you", "are", "was", "but", "not", "have",
  "has", "had", "they", "them", "their", "will", "would", "could", "should", "from",
  "what", "when", "where", "who", "why", "how", "just", "like", "dont", "didn", "cant",
  "can't", "your", "our", "she", "him", "her", "his", "its", "all", "get", "got", "one",
  "now", "then", "there", "here", "been", "were", "about", "into", "out", "too", "very"
]);

function keywords(entries, limit = 6) {
  const counts = new Map();
  for (const entry of entries) {
    for (const word of entry.text.toLowerCase().match(/[a-z']{4,}/g) || []) {
      const clean = word.replace(/'/g, "");
      if (STOP_WORDS.has(clean) || clean.length < 4) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => [word, count]);
}

function activeSenders(entries) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry.sender) counts.set(entry.sender, (counts.get(entry.sender) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function longestMessages(entries, limit = 4) {
  return [...entries]
    .filter(entry => entry.text.length > 40)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, limit);
}

function needChatContext(ctx) {
  if (!ctx.jid.endsWith("@g.us")) {
    throw new Error("This command reads group conversation — run it inside a group.");
  }
  const entries = recentChatMessages(ctx.jid, 40);
  if (entries.length < 4) {
    throw new Error("I have only " + chatLogSize(ctx.jid) +
      " recent message(s) from this group. Chat a bit more and try again — DamzD only remembers text seen since it started.");
  }
  return entries;
}

const commands = [
  {
    name: "tldr",
    category: "Group",
    description: "Summarise the recent discussion.",
    run: async ctx => {
      const entries = needChatContext(ctx);
      const [topWords, senders, highlights] = [
        keywords(entries),
        activeSenders(entries),
        longestMessages(entries)
      ];
      const lines = [
        "📌 *TL;DR — last " + entries.length + " messages*",
        "",
        "*Main topics:* " + (topWords.length
          ? topWords.map(([word, count]) => word + " (" + count + ")").join(", ")
          : "short exchanges, no clear topic"),
        "*Most active:* " + (senders.length
          ? senders.slice(0, 3).map(([number, count]) => "+" + number + " (" + count + ")").join(", ")
          : "unknown")
      ];
      if (highlights.length) {
        lines.push("", "*Longest takes:*");
        for (const entry of highlights) {
          lines.push("• +" + (entry.sender || "?") + ": " + entry.text.slice(0, 140));
        }
      }
      await ctx.reply(lines.join("\n") + "\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ");
    }
  },
  {
    name: "lore",
    category: "Group",
    description: "Retell recent chat as an epic saga.",
    run: async ctx => {
      const entries = needChatContext(ctx);
      const [topWords, senders] = [keywords(entries, 3), activeSenders(entries)];
      const heroes = (senders.slice(0, 2).map(([number]) => "+" + number));
      const [heroA, heroB] = [heroes[0] || "a mysterious stranger", heroes[1] || "the quiet one"];
      const [topicA, topicB, topicC] = [
        topWords[0]?.[0] || "destiny",
        topWords[1]?.[0] || "the ancient code",
        topWords[2]?.[0] || "the promised banhammer"
      ];
      const saga = [
        "⚔️ *THE SAGA OF THIS GROUP, VOLUME " + (1 + Math.floor(Math.random() * 9)) + "*",
        "",
        "In the age before the " + topicA + " wars, " + heroA + " strode into the council of " +
          entries.length + " voices.",
        "Where others whispered, they spoke of " + topicB + " — and the hall trembled.",
        "Then " + heroB + " rose, defender of " + topicC + ", and the two factions clashed in " +
          Math.max(3, entries.length) + " rounds of wit.",
        "Scrolls were typed. Dots were watched. Screenshots were whispered about but never shown.",
        "And when the dust settled, the prophecy of " + topicA + " remained unfulfilled…",
        "",
        "_To be continued the next time the group goes quiet._"
      ].join("\n");
      await ctx.reply(saga + "\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ");
    }
  },
  {
    name: "roast",
    category: "Group",
    description: "A light-hearted roast from recent messages.",
    run: async ctx => {
      const entries = needChatContext(ctx);
      const senders = activeSenders(entries);
      if (!senders.length) throw new Error("Not enough recent chat to build a roast.");
      const target = senders[Math.floor(Math.random() * Math.min(3, senders.length))][0];
      const targetEntry = entries.filter(entry => entry.sender === target).slice(-3);
      const theirWords = targetEntry.map(entry => entry.text.slice(0, 60));
      const roastLines = [
        "🔥 *A GENTLE ROAST*",
        "",
        "Target: +" + target,
        "",
        "Their recent contributions to humanity:",
        ...theirWords.map(text => "💬 " + text),
        "",
        "Analysis: typing speed of a payment reminder, content depth of a WhatsApp status,",
        "and the consistency of Nigerian light. And yet — we keep them. That is love. 💛"
      ];
      await ctx.reply(roastLines.join("\n") + "\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ");
    }
  },
  {
    name: "del",
    category: "Group",
    description: "Delete a message I sent (reply to it).",
    run: async ctx => {
      const info = getContextInfo(ctx.msg?.message);
      if (!info?.stanzaId || !info?.quotedMessage) {
        throw new Error("Reply to DamzD's message with " + ctx.config.prefix + "del to delete it.");
      }
      const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).filter(Boolean);
      const participant = normalizeJid(info.participant || "");
      if (!info.participant || !selfIds.includes(participant)) {
        throw new Error("That message was not sent by DamzD — I can only delete my own messages.");
      }
      await ctx.sock.sendMessage(ctx.jid, {
        delete: {
          remoteJid: ctx.jid,
          id: String(info.stanzaId),
          fromMe: true,
          ...(participant ? { participant } : {})
        }
      });
      await ctx.reply("🗑️ Done — deleted for everyone.");
    }
  }
];

export default commands;
