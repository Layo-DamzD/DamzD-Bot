import { numberFromJid } from "../src/utils.js";
import { ANTILINK_ON, WELCOME_ON, GOODBYE_ON } from "../src/store.js";

async function requireGroup(ctx) {
  if (!ctx.isGroup) throw new Error("this one only works inside a group");
  const meta = await ctx.groupMetadataSafe();
  if (!meta) throw new Error("I could not load this group — try again in a moment");
  return meta;
}

async function requireAdmin(ctx) {
  if (!(await ctx.isAdmin())) {
    throw new Error("only a group admin can use that here");
  }
}

async function requireBotAdmin(ctx) {
  if (!(await ctx.isBotAdmin())) {
    throw new Error("make me a group admin first, then I can do that");
  }
}

function targets(ctx, meta, excludeSelf = true) {
  const numbers = String(ctx.args || "").replace(/[^0-9,+\s]/g, " ").split(/[\s,]+/).filter(Boolean);
  if (numbers.length) {
    return numbers.map(number => number.replace(/\D/g, "") + "@s.whatsapp.net");
  }
  const mentioned = msgMentions(ctx);
  if (mentioned.length) return mentioned;
  if (excludeSelf) throw new Error("mention the person, or send their number");
  return meta.participants.map(participant => participant.id);
}

function msgMentions(ctx) {
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  return (info?.mentionedJid || []).map(jid => String(jid));
}

async function updateParticipants(ctx, action, successText) {
  const meta = await requireGroup(ctx);
  await requireAdmin(ctx);
  await requireBotAdmin(ctx);
  const list = targets(ctx, meta);
  if (!list.length) throw new Error("tell me who that applies to");
  await ctx.sock.groupParticipantsUpdate(ctx.jid, list, action);
  await ctx.reply(successText + (list.length === 1 ? "" : " (" + list.length + " people)"));
}

export default [
  {
    name: "kick",
    category: "Group",
    description: "remove a member (admin)",
    run: async ctx => {
      await updateParticipants(ctx, "remove", "Done — they have been removed.");
    }
  },
  {
    name: "add",
    category: "Group",
    description: "add a member by number (admin)",
    run: async ctx => {
      await updateParticipants(ctx, "add", "Done — invitation sent.");
    }
  },
  {
    name: "promote",
    category: "Group",
    description: "make a member an admin (admin)",
    run: async ctx => {
      await updateParticipants(ctx, "promote", "Done — they are an admin now.");
    }
  },
  {
    name: "demote",
    category: "Group",
    description: "remove admin rights (admin)",
    run: async ctx => {
      await updateParticipants(ctx, "demote", "Done — admin rights removed.");
    }
  },
  {
    name: "tagall",
    category: "Group",
    description: "mention every member (admin)",
    run: async ctx => {
      const meta = await requireGroup(ctx);
      await requireAdmin(ctx);
      const note = String(ctx.args || "").trim();
      const participants = meta.participants.map(participant => participant.id);
      const mentions = participants;
      const lines = participants.map(jid => "@" + numberFromJid(jid));
      await ctx.reply(
        (note ? "*" + note + "*\n\n" : "") + lines.join(" "),
        { mentions }
      );
    }
  },
  {
    name: "admins",
    category: "Group",
    description: "list the group admins",
    run: async ctx => {
      const meta = await requireGroup(ctx);
      const admins = (meta.participants || [])
        .filter(participant => ["admin", "superadmin"].includes(String(participant.admin || "")))
        .map(participant => "@" + numberFromJid(participant.id));
      await ctx.reply("The admins here: " + admins.join(" "), {
        mentions: (meta.participants || [])
          .filter(participant => ["admin", "superadmin"].includes(String(participant.admin || "")))
          .map(participant => participant.id)
      });
    }
  },
  {
    name: "groupinfo",
    category: "Group",
    description: "details about this group",
    run: async ctx => {
      const meta = await requireGroup(ctx);
      await ctx.reply(
        "*" + meta.subject + "*\n" +
        "Members: " + meta.participants.length + "\n" +
        "Created: " + new Date(Number(meta.creation || 0) * 1000).toISOString().slice(0, 10) + "\n" +
        (meta.desc ? "\n" + String(meta.desc).slice(0, 400) : "")
      );
    }
  },
  {
    name: "close",
    category: "Group",
    description: "only admins can send messages (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      await requireBotAdmin(ctx);
      await ctx.sock.groupSettingUpdate(ctx.jid, "announcement");
      await ctx.reply("The group is now closed — only admins can send messages.");
    }
  },
  {
    name: "open",
    category: "Group",
    description: "everyone can send messages (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      await requireBotAdmin(ctx);
      await ctx.sock.groupSettingUpdate(ctx.jid, "not_announcement");
      await ctx.reply("The group is open again — everyone can send messages.");
    }
  },
  {
    name: "welcome",
    category: "Group",
    description: "turn welcome messages on or off (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      const turnOn = /^(on|yes|enable|start)$/i.test(String(ctx.args || "").trim());
      const turnOff = /^(off|no|disable|stop)$/i.test(String(ctx.args || "").trim());
      if (!turnOn && !turnOff) {
        const current = ctx.store.get(WELCOME_ON + ":" + ctx.jid, false);
        await ctx.reply("Welcome messages are currently " + (current ? "on" : "off") +
          ". Use " + ctx.config.prefix + "welcome on or " + ctx.config.prefix + "welcome off.");
        return;
      }
      ctx.store.set(WELCOME_ON + ":" + ctx.jid, turnOn);
      await ctx.reply("Welcome messages are now " + (turnOn ? "on" : "off") + ".");
    }
  },
  {
    name: "goodbye",
    category: "Group",
    description: "turn goodbye messages on or off (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      const turnOn = /^(on|yes|enable|start)$/i.test(String(ctx.args || "").trim());
      const turnOff = /^(off|no|disable|stop)$/i.test(String(ctx.args || "").trim());
      if (!turnOn && !turnOff) {
        const current = ctx.store.get(GOODBYE_ON + ":" + ctx.jid, false);
        await ctx.reply("Goodbye messages are currently " + (current ? "on" : "off") +
          ". Use " + ctx.config.prefix + "goodbye on or " + ctx.config.prefix + "goodbye off.");
        return;
      }
      ctx.store.set(GOODBYE_ON + ":" + ctx.jid, turnOn);
      await ctx.reply("Goodbye messages are now " + (turnOn ? "on" : "off") + ".");
    }
  },
  {
    name: "antilink",
    category: "Group",
    description: "auto-remove posted links (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      const turnOn = /^(on|yes|enable|start)$/i.test(String(ctx.args || "").trim());
      const turnOff = /^(off|no|disable|stop)$/i.test(String(ctx.args || "").trim());
      if (!turnOn && !turnOff) {
        const current = ctx.store.get(ANTILINK_ON + ":" + ctx.jid, false);
        await ctx.reply("Link protection is currently " + (current ? "on" : "off") +
          ". Use " + ctx.config.prefix + "antilink on or " + ctx.config.prefix + "antilink off.");
        return;
      }
      ctx.store.set(ANTILINK_ON + ":" + ctx.jid, turnOn);
      await ctx.reply("Link protection is now " + (turnOn ? "on — I will remove posted links" : "off") + ".");
    }
  },
  {
    name: "warn",
    category: "Group",
    description: "warn a member (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      const mentioned = msgMentions(ctx);
      if (!mentioned.length) throw new Error("mention the person to warn");
      const warnings = ctx.store.get("warns:" + ctx.jid, {});
      for (const jid of mentioned) {
        const number = numberFromJid(jid);
        const list = warnings[number] || [];
        const reason = String(ctx.args || "").replace(/@\S+/g, "").trim() || "no reason given";
        list.push({ at: Date.now(), reason });
        warnings[number] = list;
        await ctx.reply("@" + number + ", that is a warning from the admins (" + list.length + " of 3). " +
          "Reason: " + reason + ".", { mentions: [jid] });
      }
      ctx.store.set("warns:" + ctx.jid, warnings);
    }
  },
  {
    name: "warnlist",
    category: "Group",
    description: "show warnings issued here",
    run: async ctx => {
      await requireGroup(ctx);
      const warnings = ctx.store.get("warns:" + ctx.jid, {});
      const entries = Object.entries(warnings).filter(([, list]) => list.length);
      if (!entries.length) {
        await ctx.reply("No warnings here so far. Keep it that way. 🙂");
        return;
      }
      const lines = entries.map(([number, list]) =>
        "+" + number + " — " + list.length + " warning" + (list.length === 1 ? "" : "s")
      );
      await ctx.reply("Warnings in this group:\n" + lines.join("\n"));
    }
  },
  {
    name: "del",
    category: "Group",
    description: "delete a message I sent (reply to it)",
    run: async ctx => {
      const quotedKey = ctx.msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
      if (!quotedKey) throw new Error("reply to my message with " + ctx.config.prefix + "del");
      try {
        await ctx.sock.sendMessage(ctx.jid, { delete: { remoteJid: ctx.jid, fromMe: true, id: quotedKey } });
      } catch {
        throw new Error("I could not delete that one");
      }
    }
  }
];
