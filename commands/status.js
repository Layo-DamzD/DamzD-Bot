import { numberFromJid } from "../src/utils.js";

function quotedStatusKey(ctx) {
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  if (!info?.stanzaId) return null;
  return {
    remoteJid: ctx.jid === "status@broadcast" ? "status@broadcast" : String(info.remoteJid || "status@broadcast"),
    id: String(info.stanzaId),
    fromMe: false,
    participant: info.participant ? String(info.participant) : undefined,
    key: undefined
  };
}

async function postStatus(ctx, content) {
  try {
    await ctx.sock.sendMessage("status@broadcast", content);
  } catch {
    throw new Error("WhatsApp refused the status post — try again in a moment");
  }
}

export default [
  {
    name: "status",
    category: "Status",
    description: "post a text status",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("give me the status text, e.g. " + ctx.config.prefix + "status good vibes only");
      await postStatus(ctx, { text });
      await ctx.reply("Posted to your status. ✅");
    }
  },
  {
    name: "gcstatus",
    aliases: ["groupstatus", "gcstatusdm", "dmgcstatus"],
    category: "Status",
    description: "post text or a replied-to media as a status",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
      const quoted = info?.quotedMessage;
      if (quoted?.imageMessage) {
        const { downloadContentFromMessage } = await import("baileys");
        const stream = await downloadContentFromMessage(quoted.imageMessage, "image");
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        await postStatus(ctx, { image: Buffer.concat(chunks), caption: text || "" });
      } else if (quoted?.videoMessage) {
        const { downloadContentFromMessage } = await import("baileys");
        const stream = await downloadContentFromMessage(quoted.videoMessage, "video");
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        await postStatus(ctx, { video: Buffer.concat(chunks), caption: text || "" });
      } else if (text) {
        await postStatus(ctx, { text });
      } else {
        throw new Error("send text to post, or reply to an image/video and add a caption");
      }
      await ctx.reply("Posted to your status. ✅");
    }
  },
  {
    name: "statusmention",
    category: "Status",
    description: "post a status mentioning this group's members",
    run: async ctx => {
      if (!ctx.isGroup) throw new Error("send this inside the group you want mentioned");
      const meta = await ctx.groupMetadataSafe();
      if (!meta) throw new Error("I could not load this group");
      const text = String(ctx.args || "").trim() || "Hello everyone! 👋";
      const participants = meta.participants.map(participant => participant.id);
      await postStatus(ctx, { text, mentions: participants });
      await ctx.reply("Status posted with " + participants.length + " mentions. ✅");
    }
  },
  {
    name: "statusinfo",
    category: "Status",
    description: "metadata for a replied-to status",
    run: async ctx => {
      const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
      if (!info?.stanzaId) throw new Error("reply to the status to inspect");
      const type = info.quotedMessage
        ? Object.keys(info.quotedMessage)[0] || "unknown"
        : "unknown";
      await ctx.reply(
        "Status ID: `" + info.stanzaId + "`\n" +
        "Posted by: +" + numberFromJid(info.participant || "") + "\n" +
        "Type: " + type
      );
    }
  },
  {
    name: "statusreact",
    category: "Status",
    description: "react to a replied-to status with an emoji",
    run: async ctx => {
      const emoji = String(ctx.args || "").trim().split(/\s+/)[0];
      if (!emoji) throw new Error("give me an emoji, e.g. " + ctx.config.prefix + "statusreact 🔥");
      const key = quotedStatusKey(ctx);
      if (!key) throw new Error("reply to the status you want to react to");
      await ctx.sock.sendMessage("status@broadcast", { react: { key: { remoteJid: "status@broadcast", id: key.id, fromMe: false, participant: key.participant }, text: emoji } });
      await ctx.react("✅");
    }
  },
  {
    name: "autostatus",
    aliases: ["autoview"],
    category: "Status",
    description: "automatically view new statuses",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) {
        const current = ctx.store.get("autostatusOn", false);
        await ctx.reply("Auto status view is currently *" + (current ? "on" : "off") + "*. Use " + ctx.config.prefix + "autostatus on or off.");
        return;
      }
      ctx.store.set("autostatusOn", arg === "on");
      await ctx.reply("Auto status view is now *" + arg + "*.");
    }
  },
  {
    name: "statusreacton",
    aliases: ["statusreact"],
    category: "Status",
    description: "toggle status auto-reactions",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) {
        const current = ctx.store.get("statusreactOn", false);
        await ctx.reply("Status auto-reactions are currently *" + (current ? "on" : "off") + "*. Use " + ctx.config.prefix + "statusreacton on or off.");
        return;
      }
      ctx.store.set("statusreactOn", arg === "on");
      await ctx.reply("Status auto-reactions are now *" + arg + "*.");
    }
  },
  {
    name: "statusreactmode",
    category: "Status",
    description: "choose the emoji used for status auto-reactions",
    run: async ctx => {
      const emoji = String(ctx.args || "").trim().split(/\s+/)[0];
      if (!emoji) throw new Error("give me the emoji, e.g. " + ctx.config.prefix + "statusreactmode 💚");
      ctx.store.set("statusreactEmoji", emoji);
      await ctx.reply("Status auto-reactions will now use " + emoji + ".");
    }
  },
  {
    name: "statusreactkeys",
    category: "Status",
    description: "only auto-react to statuses containing these words",
    run: async ctx => {
      const words = String(ctx.args || "").split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
      if (!words.length) throw new Error("list the trigger words, or send 'off' to react to everything");
      if (words[0].toLowerCase() === "off") {
        ctx.store.set("statusreactKeys", []);
        await ctx.reply("Status auto-reactions now apply to every status.");
        return;
      }
      ctx.store.set("statusreactKeys", words);
      await ctx.reply("Status auto-reactions now trigger on: " + words.join(", "));
    }
  },
  {
    name: "typing",
    category: "Status",
    description: "show a typing indicator here briefly",
    run: async ctx => {
      await ctx.sock.sendPresenceUpdate("composing", ctx.jid);
      await new Promise(resolve => setTimeout(resolve, 2500));
      await ctx.sock.sendPresenceUpdate("paused", ctx.jid).catch(() => {});
      await ctx.react("⌨️");
    }
  },
  {
    name: "recording",
    category: "Status",
    description: "show a recording indicator here briefly",
    run: async ctx => {
      await ctx.sock.sendPresenceUpdate("recording", ctx.jid);
      await new Promise(resolve => setTimeout(resolve, 2500));
      await ctx.sock.sendPresenceUpdate("paused", ctx.jid).catch(() => {});
      await ctx.react("🎙");
    }
  },
  {
    name: "autotype",
    category: "Status",
    description: "show typing whenever this chat sends a message",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) throw new Error("use " + ctx.config.prefix + "autotype on or off");
      ctx.store.set("autotype:" + ctx.jid, arg === "on");
      await ctx.reply("Auto typing is now *" + arg + "* for this chat.");
    }
  },
  {
    name: "autorec",
    category: "Status",
    description: "show recording whenever this chat sends a message",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) throw new Error("use " + ctx.config.prefix + "autorec on or off");
      ctx.store.set("autorec:" + ctx.jid, arg === "on");
      await ctx.reply("Auto recording indicator is now *" + arg + "* for this chat.");
    }
  },
  {
    name: "online",
    aliases: ["alwayson"],
    category: "Status",
    description: "publish online presence continuously",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) throw new Error("use " + ctx.config.prefix + "online on or off");
      await ctx.sock.sendPresenceUpdate(arg === "on" ? "available" : "unavailable");
      await ctx.reply("Presence is now *" + (arg === "on" ? "online" : "offline") + "*.");
    }
  },
  {
    name: "pres",
    category: "Status",
    description: "set presence: available or unavailable",
    run: async ctx => {
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(available|unavailable)$/.test(arg)) throw new Error("use available or unavailable");
      await ctx.sock.sendPresenceUpdate(arg);
      await ctx.reply("Presence set to *" + arg + "*.");
    }
  }
];
