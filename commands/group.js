import { numberFromJid } from "../src/utils.js";
import { ANTILINK_ON, WELCOME_ON, GOODBYE_ON } from "../src/store.js";
import { askAIAboutText } from "../src/ai.js";
import { activityFor, recentChat } from "../src/cache.js";

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

async function groupStory(ctx, style, intro) {
  const recent = recentChat(ctx.jid, 50);
  if (recent.length < 4) {
    throw new Error("I need a bit more conversation to work with — chat for a while first");
  }
  const transcript = recent.map(line => (line.name || "+" + numberFromJid(line.sender)) + ": " + line.text).join("\n").slice(0, 3500);
  await ctx.typing(2500);
  const answer = await askAIAboutText({
    prompt: intro + "\n\nGroup transcript:\n" + transcript,
    ownerName: ctx.config.ownerName,
    style
  });
  await ctx.reply(answer);
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
      const lines = participants.map(jid => "@" + numberFromJid(jid));
      await ctx.reply(
        (note ? "*" + note + "*\n\n" : "") + lines.join(" "),
        { mentions: participants }
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
        .filter(participant => ["admin", "superadmin"].includes(String(participant.admin || "")));
      await ctx.reply(
        "The admins here: " + admins.map(participant => "@" + numberFromJid(participant.id)).join(" "),
        { mentions: admins.map(participant => participant.id) }
      );
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
    name: "link",
    category: "Group",
    description: "get the group invite link",
    run: async ctx => {
      await requireGroup(ctx);
      const code = await ctx.sock.groupInviteCode(ctx.jid);
      await ctx.reply("https://chat.whatsapp.com/" + code);
    }
  },
  {
    name: "revoke",
    aliases: ["resetlink"],
    category: "Group",
    description: "reset the group invite link (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      await ctx.sock.groupRevokeInvite(ctx.jid);
      await ctx.reply("The invite link has been reset.");
    }
  },
  {
    name: "groupname",
    aliases: ["setname"],
    category: "Group",
    description: "change the group name (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      await requireBotAdmin(ctx);
      const name = String(ctx.args || "").trim();
      if (!name) throw new Error("give me the new group name");
      await ctx.sock.groupUpdateSubject(ctx.jid, name.slice(0, 60));
      await ctx.reply("Group name updated. ✅");
    }
  },
  {
    name: "groupdesc",
    aliases: ["setdesc"],
    category: "Group",
    description: "change the group description (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      await requireBotAdmin(ctx);
      const desc = String(ctx.args || "").trim();
      if (!desc) throw new Error("give me the new description");
      await ctx.sock.groupUpdateDescription(ctx.jid, desc.slice(0, 500));
      await ctx.reply("Group description updated. ✅");
    }
  },
  {
    name: "leave",
    category: "Group",
    description: "make me leave this group (admin)",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      await ctx.reply("Alright — leaving the group. Take care. 👋");
      await new Promise(resolve => setTimeout(resolve, 1200));
      await ctx.sock.groupLeave(ctx.jid);
    }
  },
  {
    name: "getgcpp",
    category: "Group",
    description: "show this group's picture",
    run: async ctx => {
      await requireGroup(ctx);
      try {
        const url = await ctx.sock.profilePictureUrl(ctx.jid, "image");
        await ctx.send({ image: { url }, caption: "*" + (await requireGroup(ctx)).subject + "*" });
      } catch {
        throw new Error("this group has no picture");
      }
    }
  },
  {
    name: "groupjid",
    category: "Group",
    description: "get the current group's JID",
    run: async ctx => {
      await requireGroup(ctx);
      const arg = String(ctx.args || "").trim();
      if (arg && /chat\.whatsapp\.com\//.test(arg)) {
        const code = arg.split("/").pop();
        try {
          const info = await ctx.sock.groupGetInviteInfo(code);
          await ctx.reply("That invite points to: `" + info?.id + "` (" + (info?.subject || "unknown group") + ")");
          return;
        } catch {
          throw new Error("I could not resolve that invite link");
        }
      }
      await ctx.reply("This group's JID: `" + ctx.jid + "`");
    }
  },
  {
    name: "onlineusers",
    category: "Group",
    description: "members who messaged here recently",
    run: async ctx => {
      await requireGroup(ctx);
      const rows = activityFor(ctx.jid).filter(row => Date.now() - row.last < 3600000).sort((a, b) => b.last - a.last).slice(0, 15);
      if (!rows.length) throw new Error("nobody has spoken here in the last hour");
      await ctx.reply(
        "🟢 Active in the last hour:\n" +
        rows.map(row => "@" + row.sender + " (" + row.count + " msg)").join("\n"),
        { mentions: rows.map(row => row.sender + "@s.whatsapp.net") }
      );
    }
  },
  {
    name: "top",
    category: "Group",
    description: "the three most active members today",
    run: async ctx => {
      await requireGroup(ctx);
      const rows = activityFor(ctx.jid).filter(row => Date.now() - row.last < 86400000).sort((a, b) => b.count - a.count).slice(0, 3);
      if (!rows.length) throw new Error("no activity recorded here today yet");
      const medals = ["🥇", "🥈", "🥉"];
      await ctx.reply(
        "Top chatters today:\n" +
        rows.map((row, index) => medals[index] + " @" + row.sender + " — " + row.count + " messages").join("\n"),
        { mentions: rows.map(row => row.sender + "@s.whatsapp.net") }
      );
    }
  },
  {
    name: "ghost",
    category: "Group",
    description: "mention the quietest members",
    run: async ctx => {
      const meta = await requireGroup(ctx);
      const active = new Set(activityFor(ctx.jid).filter(row => Date.now() - row.last < 604800000).map(row => row.sender));
      const quiet = meta.participants
        .map(participant => numberFromJid(participant.id))
        .filter(number => number && !active.has(number) && number !== ctx.senderNumber)
        .slice(0, 5);
      if (!quiet.length) throw new Error("everyone has been chatting — no ghosts today");
      await ctx.reply(
        "👻 Quiet corner squad: " + quiet.map(number => "@" + number).join(" ") +
        "\nCome out and say something!",
        { mentions: quiet.map(number => number + "@s.whatsapp.net") }
      );
    }
  },
  {
    name: "tldr",
    aliases: ["summarize", "summary"],
    category: "Group",
    description: "summarise the recent discussion",
    run: async ctx => groupStory(
      ctx,
      "Be concise and structured.",
      "Summarise this group conversation: the main topics, any decisions made, and action items. Keep it under 10 lines."
    )
  },
  {
    name: "lore",
    category: "Group",
    description: "retell recent chat as an epic saga",
    run: async ctx => groupStory(
      ctx,
      "Write with mock-epic flair but keep every detail accurate.",
      "Retell this group conversation as a short epic fantasy saga. Give members heroic titles based on what they said, but stay recognisable and good-natured. Under 15 lines."
    )
  },
  {
    name: "roast",
    category: "Group",
    description: "a light-hearted roast from recent messages",
    run: async ctx => {
      const meta = await requireGroup(ctx);
      const mentioned = msgMentions(ctx);
      let targetNumber = "";
      let targetName = "";
      if (mentioned.length) {
        targetNumber = numberFromJid(mentioned[0]);
      } else {
        const rows = activityFor(ctx.jid).sort((a, b) => b.count - a.count);
        targetNumber = rows[0]?.sender || "";
      }
      if (!targetNumber) throw new Error("mention the person to roast");
      const participant = meta.participants.find(entry => numberFromJid(entry.id) === targetNumber);
      if (!participant) throw new Error("that person is not in this group");
      const recent = recentChat(ctx.jid, 40).filter(line => numberFromJid(line.sender) === targetNumber);
      targetName = recent.find(line => line.name)?.name || "+" + targetNumber;
      const material = (recent.length ? recent.map(line => line.text).join(" | ").slice(0, 1500) : "(has not said much)");
      await ctx.typing(2000);
      const roast = await askAIAboutText({
        prompt: "Write a light-hearted, friendly roast of a group member named " + targetName +
          ", based on their recent messages. Keep it playful and kind-hearted — no insults about appearance, ethnicity, or anything personal and hurtful. Under 4 sentences.\n\nTheir recent messages: " + material,
        ownerName: ctx.config.ownerName,
        style: "You write playful, warm-hearted roasts that everyone laughs with, not at."
      });
      await ctx.reply(roast, { mentions: [targetNumber + "@s.whatsapp.net"] });
    }
  },
  {
    name: "addmeta",
    aliases: ["addai", "addmetaai"],
    category: "Group",
    description: "try to add Meta AI to this group",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.jid, ["13135550002@s.whatsapp.net"], "add");
        await ctx.reply("I sent an add request to Meta AI — if WhatsApp allows it in your region, it will appear shortly.");
      } catch {
        throw new Error("WhatsApp did not accept the request — Meta AI availability depends on your region and account");
      }
    }
  },
  {
    name: "removemeta",
    aliases: ["removeai", "removemetaai"],
    category: "Group",
    description: "remove Meta AI from this group",
    run: async ctx => {
      await requireGroup(ctx);
      await requireAdmin(ctx);
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.jid, ["13135550002@s.whatsapp.net"], "remove");
        await ctx.reply("Done — Meta AI removal requested.");
      } catch {
        throw new Error("I could not remove that participant — it may not be Meta AI after all");
      }
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
