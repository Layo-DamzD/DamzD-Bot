// Presence controls and status posting/reacting. Presence updates are
// real Baileys presence signals; the auto variants keep firing while the
// bot is connected.
import {
  getAutoPresence,
  setAutoPresence,
  setPublishOnline
} from "../src/damzd/presence.js";
import {
  findSeenStatus,
  getSeenStatuses,
  reactToSeenStatus
} from "../lib/status-automation.js";
import { getContextInfo, normalizeJid, numberFromJid } from "../lib/message-utils.js";

function ownerOnly(ctx, feature) {
  if (ctx.owner) return true;
  ctx.reply("⛔ Only the configured bot owner can use " + feature + ".").catch(() => {});
  return false;
}

async function sendOnePresence(ctx, kind) {
  await ctx.sock.sendPresenceUpdate(kind, ctx.jid);
}

function quotedParticipant(ctx) {
  const info = getContextInfo(ctx.msg?.message);
  if (!info?.participant) return "";
  return normalizeJid(info.participant);
}

const commands = [
  {
    name: "typing",
    category: "Status",
    description: "Show a typing indicator here briefly.",
    run: async ctx => {
      await sendOnePresence(ctx, "composing");
      await ctx.reply("⌨️ Typing indicator sent to this chat.");
    }
  },
  {
    name: "recording",
    category: "Status",
    description: "Show a recording indicator here briefly.",
    run: async ctx => {
      await sendOnePresence(ctx, "recording");
      await ctx.reply("🎙️ Recording indicator sent to this chat.");
    }
  },
  {
    name: "autotype",
    category: "Status",
    description: "Show typing whenever this chat sends a message.",
    run: async ctx => {
      if (!ownerOnly(ctx, "auto typing")) return;
      const raw = String(ctx.args || "").trim().toLowerCase();
      if (!["on", "off"].includes(raw)) {
        const state = getAutoPresence(ctx.jid);
        await ctx.reply("⌨️ Auto typing in this chat: " + (state.typing ? "ON ✅" : "OFF 🔕") +
          "\nUsage: " + ctx.config.prefix + "autotype on/off");
        return;
      }
      const state = await setAutoPresence(ctx.jid, "typing", raw === "on");
      await ctx.reply("⌨️ Auto typing " + (state.typing ? "enabled" : "disabled") +
        " for this chat" + (state.recording ? " (auto recording is also on)." : "."));
    }
  },
  {
    name: "autorec",
    category: "Status",
    description: "Show recording whenever this chat sends a message.",
    run: async ctx => {
      if (!ownerOnly(ctx, "auto recording")) return;
      const raw = String(ctx.args || "").trim().toLowerCase();
      if (!["on", "off"].includes(raw)) {
        const state = getAutoPresence(ctx.jid);
        await ctx.reply("🎙️ Auto recording in this chat: " + (state.recording ? "ON ✅" : "OFF 🔕") +
          "\nUsage: " + ctx.config.prefix + "autorec on/off");
        return;
      }
      const state = await setAutoPresence(ctx.jid, "recording", raw === "on");
      await ctx.reply("🎙️ Auto recording " + (state.recording ? "enabled" : "disabled") +
        " for this chat" + (state.typing ? " (auto typing is also on)." : "."));
    }
  },
  {
    name: "online",
    category: "Status",
    description: "Publish online presence continuously.",
    run: async ctx => {
      if (!ownerOnly(ctx, "online presence")) return;
      await ctx.sock.sendPresenceUpdate("available");
      setPublishOnline(true);
      await ctx.reply("🟢 DamzD now publishes an online presence and re-publishes it after every reconnect." +
        " Send " + ctx.config.prefix + "pres unavailable to stop.");
    }
  },
  {
    name: "pres",
    category: "Status",
    description: "Set presence: available or unavailable.",
    run: async ctx => {
      if (!ownerOnly(ctx, "presence")) return;
      const choice = String(ctx.args || "").trim().toLowerCase();
      if (!["available", "unavailable"].includes(choice)) {
        throw new Error("Usage: " + ctx.config.prefix + "pres available | unavailable");
      }
      await ctx.sock.sendPresenceUpdate(choice);
      if (choice === "unavailable") setPublishOnline(false);
      await ctx.reply(choice === "available"
        ? "🟢 Presence published: available."
        : "⚫ Presence published: unavailable.");
    }
  },
  {
    name: "status",
    aliases: ["poststatus"],
    category: "Status",
    description: "Post a text status.",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("Usage: " + ctx.config.prefix + "status your status text");
      if (text.length > 700) throw new Error("Keep the status under 700 characters.");
      await ctx.sock.sendMessage("status@broadcast", { text });
      await ctx.reply("✅ Status posted:\n\n" + text);
    }
  },
  {
    name: "statusmention",
    category: "Status",
    description: "Post a status mentioning this group's members.",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("Usage: " + ctx.config.prefix + "statusmention your announcement");
      if (!ctx.jid.endsWith("@g.us")) throw new Error("Run this inside the group whose members you want mentioned.");
      if (text.length > 700) throw new Error("Keep the status under 700 characters.");
      const metadata = await ctx.sock.groupMetadata(ctx.jid);
      const members = (metadata?.participants || [])
        .map(participant => normalizeJid(participant.phoneNumber || participant.pn || participant.id || ""))
        .filter(jid => jid.endsWith("@s.whatsapp.net"))
        .slice(0, 60);
      const mentions = members.map(jid => numberFromJid(jid) + "@s.whatsapp.net");
      const body = text + "\n\n" + mentions.map(jid => "@" + numberFromJid(jid)).join(" ");
      await ctx.sock.sendMessage("status@broadcast", { text: body, mentions });
      await ctx.reply("✅ Status posted mentioning " + mentions.length + " member(s) of this group.");
    }
  },
  {
    name: "statusinfo",
    category: "Status",
    description: "Metadata for a replied-to status.",
    run: async ctx => {
      const filter = quotedParticipant(ctx) || String(ctx.args || "").replace(/\D/g, "");
      const entry = filter
        ? findSeenStatus(filter)
        : findSeenStatus("");
      if (!entry) {
        const seen = getSeenStatuses(10);
        throw new Error(seen.length
          ? "No matching status found. Statuses I saw: " +
            seen.map(item => "+" + item.author.split("@")[0]).join(", ")
          : "No status has been seen yet in this session. Enable " + ctx.config.prefix +
            "autostatus on so DamzD notices statuses.");
      }
      await ctx.reply([
        "ℹ️ *STATUS METADATA*",
        "Sender: " + (entry.author ? "+" + entry.author.split("@")[0] : "unknown"),
        "Type: " + entry.kind,
        "Message ID: " + entry.key.id,
        "Seen: " + new Date(entry.at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
        entry.text ? "Text: " + entry.text : ""
      ].filter(Boolean).join("\n"));
    }
  },
  {
    name: "statusreact",
    category: "Status",
    description: "React to a replied-to status with an emoji.",
    run: async ctx => {
      const emoji = String(ctx.args || "").trim();
      if (!emoji || [...emoji].length > 8 || !/\p{Extended_Pictographic}/u.test(emoji)) {
        throw new Error("Usage: " + ctx.config.prefix + "statusreact 🔥 — or reply to a status and send it");
      }
      const filter = quotedParticipant(ctx);
      const entry = findSeenStatus(filter);
      if (!entry) {
        throw new Error("No status matched. DamzD only remembers statuses it has seen in this session" +
          " (turn on " + ctx.config.prefix + "autostatus on).");
      }
      await reactToSeenStatus(ctx.sock, entry, emoji);
      await ctx.reply("🔥 Reacted " + emoji + " to the status from +" + entry.author.split("@")[0] + ".");
    }
  }
];

export default commands;
