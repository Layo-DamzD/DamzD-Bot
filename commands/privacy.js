import { numberFromJid } from "../src/utils.js";
import { getCached } from "../src/cache.js";

function quotedContext(ctx) {
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  if (!info?.stanzaId) return null;
  return {
    id: String(info.stanzaId),
    participant: info.participant ? String(info.participant) : "",
    message: info.quotedMessage || null
  };
}

function parseDuration(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (/^(off|none|never)$/.test(value)) return 0;
  if (/^forever$/.test(value)) return -1;
  const match = value.match(/^(\d+)\s*(h|d|hour|hours|day|days)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] || "h";
  if (unit.startsWith("h")) return amount * 3600000;
  return amount * 86400000;
}

async function targetJid(ctx) {
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  if (info?.participant) return String(info.participant);
  const number = String(ctx.args || "").replace(/[^0-9]/g, "");
  if (number) return number + "@s.whatsapp.net";
  throw new Error("reply to the person's message or send their number");
}

export default [
  {
    name: "antidel",
    aliases: ["antidelete"],
    category: "Privacy",
    description: "alert me when someone deletes a message",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) {
        const current = ctx.store.get("antidelOn", false);
        await ctx.reply("Anti-delete is currently *" + (current ? "on" : "off") + "*. Use " + ctx.config.prefix + "antidel on or " + ctx.config.prefix + "antidel off.");
        return;
      }
      ctx.store.set("antidelOn", arg === "on");
      await ctx.reply("Anti-delete is now *" + arg + "*. " + (arg === "on" ? "Deleted messages will be reported to you." : ""));
    }
  },
  {
    name: "antiedit",
    category: "Privacy",
    description: "alert me when a message is edited",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) {
        const current = ctx.store.get("antieditOn", false);
        await ctx.reply("Anti-edit is currently *" + (current ? "on" : "off") + "*. Use " + ctx.config.prefix + "antiedit on or off.");
        return;
      }
      ctx.store.set("antieditOn", arg === "on");
      await ctx.reply("Anti-edit is now *" + arg + "*.");
    }
  },
  {
    name: "unsend",
    category: "Privacy",
    description: "delete a message I sent (reply to it)",
    run: async ctx => {
      const quoted = quotedContext(ctx);
      if (!quoted) throw new Error("reply to my message you want deleted");
      try {
        await ctx.sock.sendMessage(ctx.jid, { delete: { remoteJid: ctx.jid, fromMe: true, id: quoted.id } });
      } catch {
        throw new Error("I could not delete that one");
      }
    }
  },
  {
    name: "edit",
    aliases: ["fakemsg", "fake", "editmsg"],
    category: "Privacy",
    description: "edit a message I sent (reply to it)",
    run: async ctx => {
      const quoted = quotedContext(ctx);
      if (!quoted) throw new Error("reply to my message you want to edit");
      const newText = String(ctx.args || "").trim();
      if (!newText) throw new Error("give me the new text for that message");
      try {
        await ctx.sock.sendMessage(ctx.jid, { text: newText, edit: { remoteJid: ctx.jid, fromMe: true, id: quoted.id } });
      } catch {
        throw new Error("I could not edit that one");
      }
    }
  },
  {
    name: "pin",
    category: "Privacy",
    description: "pin this chat",
    run: async ctx => {
      await ctx.sock.chatModify({ pin: true }, ctx.jid);
      await ctx.react("📌");
    }
  },
  {
    name: "unpin",
    category: "Privacy",
    description: "unpin this chat",
    run: async ctx => {
      await ctx.sock.chatModify({ pin: false }, ctx.jid);
      await ctx.react("Done");
    }
  },
  {
    name: "archive",
    category: "Privacy",
    description: "archive this chat",
    run: async ctx => {
      await ctx.sock.chatModify({ archive: true }, ctx.jid);
      await ctx.react("🗄");
    }
  },
  {
    name: "unarchive",
    category: "Privacy",
    description: "unarchive this chat",
    run: async ctx => {
      await ctx.sock.chatModify({ archive: false }, ctx.jid);
      await ctx.react("📂");
    }
  },
  {
    name: "mutechat",
    category: "Privacy",
    description: "mute this chat: 8h, 24h, 7d or forever",
    run: async ctx => {
      const ms = parseDuration(ctx.args);
      if (ms === null) throw new Error("use 8h, 24h, 7d or forever");
      await ctx.sock.chatModify({ mute: ms === -1 ? 2147483647000 : Date.now() + ms }, ctx.jid);
      await ctx.reply("Chat muted" + (ms === -1 ? " forever" : " for " + String(ctx.args).trim()) + ". 🔇");
    }
  },
  {
    name: "unmutechat",
    category: "Privacy",
    description: "unmute this chat",
    run: async ctx => {
      await ctx.sock.chatModify({ mute: null }, ctx.jid);
      await ctx.reply("Chat unmuted. 🔊");
    }
  },
  {
    name: "readchat",
    category: "Privacy",
    description: "mark this chat as read",
    run: async ctx => {
      await ctx.sock.chatModify({ markRead: true, lastMessages: [{ key: ctx.key }] }, ctx.jid);
      await ctx.react("👁");
    }
  },
  {
    name: "unreadchat",
    category: "Privacy",
    description: "mark this chat as unread",
    run: async ctx => {
      await ctx.sock.chatModify({ markRead: false, lastMessages: [{ key: ctx.key }] }, ctx.jid);
      await ctx.react("🔵");
    }
  },
  {
    name: "star",
    category: "Privacy",
    description: "star a replied-to message",
    run: async ctx => {
      const quoted = quotedContext(ctx);
      if (!quoted) throw new Error("reply to the message to star");
      await ctx.sock.chatModify({ star: { messages: [{ id: quoted.id, fromMe: quoted.participant === ctx.sock?.user?.id, star: true }] } }, ctx.jid);
      await ctx.react("⭐");
    }
  },
  {
    name: "unstar",
    category: "Privacy",
    description: "unstar a replied-to message",
    run: async ctx => {
      const quoted = quotedContext(ctx);
      if (!quoted) throw new Error("reply to the message to unstar");
      await ctx.sock.chatModify({ star: { messages: [{ id: quoted.id, fromMe: quoted.participant === ctx.sock?.user?.id, star: false }] } }, ctx.jid);
      await ctx.react("☆");
    }
  },
  {
    name: "disappear",
    category: "Privacy",
    description: "disappearing messages: off, 24h, 7d or 90d",
    run: async ctx => {
      const value = String(ctx.args || "").trim().toLowerCase();
      const map = { off: 0, "24h": 86400, "7d": 604800, "90d": 7776000 };
      if (!(value in map)) throw new Error("use off, 24h, 7d or 90d");
      await ctx.sock.sendMessage(ctx.jid, { disappearingMessagesInChat: map[value] });
      await ctx.reply(value === "off" ? "Disappearing messages are off." : "Disappearing messages set to *" + value + "*.");
    }
  },
  {
    name: "block",
    category: "Privacy",
    description: "block a contact (reply or send number)",
    run: async ctx => {
      const jid = await targetJid(ctx);
      await ctx.sock.updateBlockStatus(jid, "block");
      await ctx.reply("Blocked +" + numberFromJid(jid) + ".");
    }
  },
  {
    name: "unblock",
    category: "Privacy",
    description: "unblock a contact",
    run: async ctx => {
      const jid = await targetJid(ctx);
      await ctx.sock.updateBlockStatus(jid, "unblock");
      await ctx.reply("Unblocked +" + numberFromJid(jid) + ".");
    }
  },
  {
    name: "forward",
    category: "Privacy",
    description: "forward a replied-to message here",
    run: async ctx => {
      const quoted = quotedContext(ctx);
      if (!quoted?.message) throw new Error("reply to the message to forward");
      try {
        await ctx.sock.sendMessage(ctx.jid, {
          forward: { key: { remoteJid: ctx.jid, id: quoted.id, fromMe: false, participant: quoted.participant }, message: quoted.message }
        });
      } catch {
        throw new Error("I could not forward that one");
      }
    }
  },
  {
    name: "banchecker",
    category: "Privacy",
    description: "check if a number is on WhatsApp",
    run: async ctx => {
      const number = String(ctx.args || "").replace(/[^0-9]/g, "");
      if (!number) throw new Error("send the number with country code, e.g. " + ctx.config.prefix + "banchecker 2348012345678");
      const results = await ctx.sock.onWhatsApp(number);
      const on = results?.[0]?.exists;
      await ctx.reply(
        on
          ? "✅ +" + number + " is registered on WhatsApp.\n\nWhether that account is temporarily banned is something only WhatsApp knows — no public service can check that reliably."
          : "❌ +" + number + " is not on WhatsApp."
      );
    }
  },
  {
    name: "pollres",
    category: "Privacy",
    description: "show what I can see about a replied-to poll",
    run: async ctx => {
      const quoted = quotedContext(ctx);
      const cached = quoted ? getCached(quoted.id) : null;
      const poll = cached?.msg?.pollCreationMessage || quoted?.message?.pollCreationMessage;
      if (!poll) throw new Error("reply to the poll message — note that WhatsApp encrypts vote updates, so live results are limited");
      const options = (poll.options || []).map(option => "• " + (option.optionName || option.optionHash || "option"));
      await ctx.reply("📊 Poll: *" + (poll.name || "unnamed") + "*\n" + options.join("\n") + "\n\nWhatsApp encrypts individual votes, so I can only show the options — not who voted for what.");
    }
  }
];
