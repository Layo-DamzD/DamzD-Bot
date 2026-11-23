// DamzD signature commands on the FEI engine — the Ggs skin (their .vv
// engine underneath), .vvinfo, and the group activity trio (.onlineusers,
// .top, .ghost). The Ggs skin keeps the old DamzD behavior: typing GGs with
// no view-once attached is just a good-game reply; with a view-once quoted
// the recovery runs silently — the media lands in the OWNER's own chat, no
// trace in the original chat.
import { unwrapMessage, normalizeJid } from "../../lib/message-utils.js";
import { POWERED_FOOTER } from "../../lib/api-client.js";
import {
  findCachedViewOnce,
  readCachedMedia,
  viewOnceCacheSize,
  recentStashIds
} from "../../src/damzd/viewonce.js";
import { activityFor, activityWindow } from "../../src/damzd/activity.js";
import { resolveParticipants, ownNumbers } from "../../src/damzd/lid.js";

export function hasViewOnceWrapper(message) {
  let current = message;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (Object.keys(current).some(key => /viewOnceMessage/i.test(key))) return true;
    current = current.ephemeralMessage?.message ||
      current.documentWithCaptionMessage?.message ||
      current.deviceSentMessage?.message;
  }
  return false;
}

export function quotedContext(ctx) {
  const info = ctx.msg?.message?.extendedTextMessage?.contextInfo;
  if (!info?.stanzaId || !info?.quotedMessage) return null;
  return { info, quoted: info.quotedMessage };
}

function ownerChatJid(ctx) {
  const number = String(ctx.config?.ownerNumber || "").replace(/\D/g, "");
  return number ? number + "@s.whatsapp.net" : "";
}

// The official Baileys retry download (father-repo proven): the message is
// downloaded with a reuploadRequest so a stripped quote or aged URL still
// recovers while the sender's phone is online.
async function retryDownload(ctx, key, message) {
  try {
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
    const buffer = await downloadMediaMessage(
      {
        key: {
          remoteJid: String(key.remoteJid || ""),
          id: String(key.id || ""),
          fromMe: Boolean(key.fromMe),
          ...(key.participant ? { participant: String(key.participant) } : {})
        },
        message
      },
      "buffer",
      {},
      { reuploadRequest: ctx.sock.updateMediaMessage }
    );
    return Buffer.isBuffer(buffer) && buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

export async function recoverBuffer(ctx, cached, quoted) {
  // 1) Bytes captured on arrival — instant, immune to the one-serving policy.
  const captured = readCachedMedia(cached);
  if (captured) return { buffer: captured, node: cached.node };
  // 2) The stashed full-metadata node.
  if (cached?.node) {
    try {
      const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
      const stream = await downloadContentFromMessage(cached.node, cached.kind === "sticker" ? "sticker" : cached.kind);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (buffer.length) return { buffer, node: cached.node };
    } catch { /* the retry protocol is next */ }
    // 3) The media-retry protocol: fresh node from WhatsApp + sender's phone.
    const fresh = await refreshMediaLocation(ctx, { remoteJid: ctx.jid, id: cached.stanzaId }, cached.node);
    if (fresh) {
      try {
        const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
        const stream = await downloadContentFromMessage(fresh, cached.kind === "sticker" ? "sticker" : cached.kind);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length) return { buffer, node: fresh };
      } catch { /* official path is next */ }
    }
    // 4) Baileys' own reupload protocol.
    const official = await retryDownload(ctx, { remoteJid: ctx.jid, id: cached.stanzaId }, { [cached.nodeKind]: cached.node });
    if (official) return { buffer: official, node: cached.node };
  }
  // 5) No cache at all — the quote itself may still carry the mediaKey.
  if (quoted) {
    const official = await retryDownload(ctx, { remoteJid: ctx.jid, participant: undefined }, quoted);
    if (official) return { buffer: official, node: null };
  }
  return null;
}

async function refreshMediaLocation(ctx, key, node) {
  try {
    const nodeKey = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"]
      .find(k => node?.[k]);
    if (!nodeKey || !key?.id || !node.mediaKey) return null;
    const updated = await ctx.sock.updateMediaMessage({
      key: {
        remoteJid: String(key.remoteJid || ""),
        id: String(key.id),
        fromMe: Boolean(key.fromMe),
        ...(key.participant ? { participant: String(key.participant) } : {})
      },
      message: { [nodeKey]: node }
    });
    const fresh = updated?.message?.[nodeKey] || updated?.[nodeKey];
    return (fresh?.url || fresh?.directPath) ? fresh : null;
  } catch {
    return null;
  }
}

export function mediaKindOf(node) {
  if (node?.imageMessage) return "image";
  if (node?.videoMessage) return "video";
  if (node?.stickerMessage) return "sticker";
  if (node?.audioMessage) return "audio";
  return "image";
}

function mediaNodeKeyOf(kind) {
  return ({ image: "imageMessage", video: "videoMessage", sticker: "stickerMessage", audio: "audioMessage" })[kind] || "imageMessage";
}

async function sendRecovered(ctx, kind, buffer, origin, node) {
  const target = ownerChatJid(ctx);
  if (!target) throw new Error("I could not resolve your own chat");
  const caption = "👀 Recovered view-once\nFrom: " + origin + "\n\n" + POWERED_FOOTER;
  if (kind === "image") {
    await ctx.sock.sendMessage(target, { image: buffer, caption });
  } else if (kind === "video") {
    await ctx.sock.sendMessage(target, { video: buffer, mimetype: node?.mimetype || "video/mp4", caption });
  } else if (kind === "audio") {
    await ctx.sock.sendMessage(target, { audio: buffer, mimetype: node?.mimetype || "audio/mpeg", ptt: node?.ptt === true });
    await ctx.sock.sendMessage(target, { text: "👀 Recovered voice note\nFrom: " + origin });
  } else {
    await ctx.sock.sendMessage(target, { sticker: buffer });
    await ctx.sock.sendMessage(target, { text: "👀 Recovered sticker\nFrom: " + origin });
  }
}

const GG_LINES = [
  "GGs! 🔥 legendary play.",
  "GGs! that was clean. 😎",
  "GGs! better luck next round. 🎮"
];

export default [
  {
    name: "ggs",
    aliases: ["gg"],
    category: "Media & Tools",
    description: "GGs! reply it to a view-once photo/video and I save it quietly for you",
    run: async ctx => {
      const source = ctx.jid.endsWith("@g.us") ? "a group" : "+" + String(ctx.jid).split("@")[0].replace(/\D/g, "");
      const qc = quotedContext(ctx);
      if (!qc) {
        await ctx.reply(GG_LINES[Math.floor(Math.random() * GG_LINES.length)]);
        return;
      }
      const cached = findCachedViewOnce(ctx.jid, qc.info.stanzaId) ||
        findCachedViewOnce("", qc.info.stanzaId);
      const wrapper = hasViewOnceWrapper(qc.quoted);
      if (!cached && !wrapper) {
        await ctx.reply(GG_LINES[Math.floor(Math.random() * GG_LINES.length)]);
        return;
      }
      const kind = cached?.kind || mediaKindOf(unwrapMessage(qc.quoted));
      const nodeKind = mediaNodeKeyOf(kind);
      const result = await recoverBuffer(ctx, cached ? {
        ...cached,
        stanzaId: qc.info.stanzaId,
        nodeKind
      } : null, qc.quoted);
      if (!result) {
        await ctx.reply("⚠️ I saw that view-once, but WhatsApp would not hand the bytes back this time. If it is still un-opened, react 🔓 to it and I will try again while the sender is online.");
        return;
      }
      await sendRecovered(ctx, kind, result.buffer, source, result.node);
    }
  },
  {
    name: "vvinfo",
    category: "Media & Tools",
    description: "reply to a view-once to see whether its original reached me",
    run: async ctx => {
      const qc = quotedContext(ctx);
      if (!qc) throw new Error("reply to the view-once message first");
      const cached = findCachedViewOnce(ctx.jid, qc.info.stanzaId) ||
        findCachedViewOnce("", qc.info.stanzaId);
      if (!cached) {
        throw new Error("that message never reached me — WhatsApp does not re-deliver missed media, whether I was restarting, re-pairing, or the network never handed it over. (Recent ids remembered: " +
          (recentStashIds(3).map(x => "…" + x).join("  ") || "none") + ". Media remembered since boot: " + viewOnceCacheSize() + ".)");
      }
      const lines = [
        "*VIEW-ONCE REPORT*",
        "View-once: " + (cached.wasViewOnce ? "true" : "false"),
        "Kind: " + cached.kind,
        "Arrival id: " + qc.info.stanzaId,
        "Bytes on disk: " + (readCachedMedia(cached) ? "captured ✅" : (cached.node ? "no — live fetch only" : "never arrived"))
      ];
      if (!cached.node && !readCachedMedia(cached)) {
        lines.push("", "That message reached me, but WhatsApp withheld its content — the linked-device view-once limitation. React 🔓 now: un-opened view-onces re-serve in seconds; opened or expired ones never do.");
      }
      await ctx.reply(lines.join("\n"));
    }
  },
  {
    name: "onlineusers",
    category: "Group",
    description: "members who messaged here recently",
    run: async ctx => {
      if (!ctx.jid.endsWith("@g.us")) throw new Error("this one only works inside a group");
      const rows = activityFor(ctx.jid)
        .filter(row => row.pn && Date.now() - row.last < 3600000)
        .sort((a, b) => b.last - a.last)
        .slice(0, 15);
      if (!rows.length) throw new Error("nobody has spoken here in the last hour");
      await ctx.reply(
        "🟢 Active in the last hour:\n" +
        rows.map(row => "@" + row.pn + " (" + row.count + " msg)").join("\n"),
        { mentions: rows.map(row => row.pn + "@s.whatsapp.net") }
      );
    }
  },
  {
    name: "top",
    category: "Group",
    description: "the three most active members today",
    run: async ctx => {
      if (!ctx.jid.endsWith("@g.us")) throw new Error("this one only works inside a group");
      const rows = activityFor(ctx.jid)
        .filter(row => row.pn && Date.now() - row.last < 86400000)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      if (!rows.length) throw new Error("no activity recorded here today yet");
      const medals = ["🥇", "🥈", "🥉"];
      await ctx.reply(
        "Top chatters today:\n" +
        rows.map((row, index) => medals[index] + " @" + row.pn + " — " + row.count + " messages").join("\n"),
        { mentions: rows.map(row => row.pn + "@s.whatsapp.net") }
      );
    }
  },
  {
    name: "ghost",
    category: "Group",
    description: "mention the quietest members",
    run: async ctx => {
      if (!ctx.jid.endsWith("@g.us")) throw new Error("this one only works inside a group");
      let meta;
      try {
        meta = await ctx.sock.groupMetadata(ctx.jid);
      } catch {
        throw new Error("I could not load this group — try again in a moment");
      }
      const members = await resolveParticipants(ctx.sock, meta);
      const win = activityWindow(ctx.jid);
      const own = ownNumbers(ctx.sock);
      const caller = normalizeJid(String(ctx.senderJid || ""));
      const exclude = [own.pn, own.lid, caller.split("@")[0].replace(/\D/g, "") || ""];
      const result = pickGhosts({ members, rows: activityFor(ctx.jid), watchedMs: win.watchedMs, totalSeen: win.total, exclude });
      if (result.insufficient) {
        throw new Error(
          "I have only been watching this group for " + humanWatchTime(result.watchedMs) +
          " and I have seen " + result.totalSeen + " message" + (result.totalSeen === 1 ? "" : "s") +
          " in that time — that is far too little to judge who is quiet. Give me a few hours of normal chat, then ask me again."
        );
      }
      if (!result.quiet.length) throw new Error("everyone has been chatting — no ghosts today");
      const numbers = result.quiet.map(member => member.number);
      const jids = result.quiet.map(member => (member.lid && !member.number) ? member.lid + "@lid" : member.number + "@s.whatsapp.net");
      await ctx.reply(
        "👻 Quiet corner squad (no messages from them in the " + humanWatchTime(result.watchedMs) +
        " I have been watching): " + numbers.map(number => "@" + number).join(" ") +
        "\nCome out and say something!",
        { mentions: jids }
      );
    }
  }
];

function humanWatchTime(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return minutes + " minute" + (minutes === 1 ? "" : "s");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + " hour" + (hours === 1 ? "" : "s");
  return Math.floor(hours / 24) + " days";
}

// The honest core of .ghost: a member is "quiet" only when neither of their
// identities (phone or LID) appears in the recorded activity window.
function pickGhosts({ members, rows, watchedMs, totalSeen, exclude = [] }) {
  const MIN_WATCH_MS = 2 * 60 * 60 * 1000; // judge nobody before 2 hours of watching
  const MIN_MESSAGES = 15;                 // or before 15 messages were seen
  if (watchedMs < MIN_WATCH_MS || totalSeen < MIN_MESSAGES) {
    return { insufficient: true, watchedMs, totalSeen };
  }
  const active = new Set();
  for (const row of rows || []) {
    if (Date.now() - row.last < 7 * 86400000) {
      if (row.pn) active.add(row.pn);
      if (row.lid) active.add(row.lid);
    }
  }
  const skip = new Set(exclude.filter(Boolean));
  const quiet = (members || [])
    .filter(member => member.number &&
      !active.has(member.number) &&
      !(member.lid && active.has(member.lid)) &&
      !skip.has(member.number))
    .slice(0, 5);
  return { quiet, watchedMs, totalSeen };
}
