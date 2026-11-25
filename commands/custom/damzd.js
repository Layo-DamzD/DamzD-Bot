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
// recovers while the sender's phone is online. The original message
// timestamp rides along — the media-retry IQ validates message age, and
// FEI XMD (the father repo) always passes it.
async function retryDownload(ctx, key, message, messageTimestamp = 0, errors = null, label = "") {
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
        message,
        ...(Number(messageTimestamp) > 0 ? { messageTimestamp: Number(messageTimestamp) } : {})
      },
      "buffer",
      {},
      { reuploadRequest: ctx.sock.updateMediaMessage }
    );
    return Buffer.isBuffer(buffer) && buffer.length ? buffer : null;
  } catch (error) {
    if (errors) errors.push((label || "download") + ": " + String(error?.message || error).slice(0, 110));
    return null;
  }
}

export async function recoverBuffer(ctx, cached, quoted, quotedKey = null) {
  const errors = [];
  // 1) Bytes captured on arrival — instant, immune to the one-serving policy.
  const captured = readCachedMedia(cached);
  if (captured) return { buffer: captured, node: cached.node };
  // The retry protocol needs the ORIGINAL message key — remoteJid, fromMe
  // and above all the sender's participant jid. Without the participant a
  // group media-retry cannot be routed to the sender's phone, so every
  // retry fails even while the sender is online (v2.3.3 field report).
  const fallbackKey = quotedKey && quotedKey.id ? quotedKey : {
    remoteJid: String(ctx.jid || ""),
    id: String(cached?.stanzaId || ""),
    fromMe: Boolean(cached?.fromMe)
  };
  const key = cached?.chat || cached?.stanzaId ? {
    remoteJid: String(cached?.chat || ctx.jid || ""),
    id: String(cached?.stanzaId || ""),
    fromMe: Boolean(cached?.fromMe),
    ...(cached?.sender ? { participant: String(cached.sender) } : {})
  } : fallbackKey;
  // 2) THE FATHER-REPO PATH (FEI XMD — proven working in the field): the
  //    official Baileys download straight off the quoted copy, original
  //    timestamp attached, reupload hook wired. Baileys fights the
  //    media-retry protocol INTERNALLY when the CDN says 404/410, so this
  //    one call covers stripped quotes and aged URLs alike. Tried FIRST —
  //    everything below only runs when this one says no.
  if (quoted) {
    const official = await retryDownload(ctx, fallbackKey, quoted,
      Number(ctx.msg?.messageTimestamp || 0), errors, "quote");
    if (official) return { buffer: official, node: null };
  }
  // 2b) THE QUOTE-RETRY PATH (v2.4.1 field fix): WhatsApp strips the media
  //     location out of view-once quotes — the url field is there but empty,
  //     so Baileys' official downloader dies with status 400, and 400 is NOT
  //     in its reupload list [410, 404]. It never asks the sender's phone.
  //     We run the media-retry ourselves: updateMediaMessage needs only the
  //     message key and the mediaKey the quote still carries, and hands back
  //     a FRESH node with a live directPath.
  if (quoted && fallbackKey?.id) {
    const freshQuote = await refreshQuotedMedia(ctx, fallbackKey, quoted, errors);
    if (freshQuote) {
      try {
        const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
        const kind = freshQuote.kind === "stickerMessage" ? "sticker" : freshQuote.kind.replace("Message", "");
        const stream = await downloadContentFromMessage(freshQuote.node, kind);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length) return { buffer, node: freshQuote.node };
        errors.push("quote-retry: empty stream");
      } catch (error) {
        errors.push("quote-retry download: " + String(error?.message || error).slice(0, 110));
      }
    } else if (!errors.some(line => line.startsWith("quote-retry"))) {
      errors.push("quote-retry: no fresh location returned");
    }
  }
  // 3) The stashed full-metadata node (what the bot actually received live).
  if (cached?.node) {
    try {
      const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
      const stream = await downloadContentFromMessage(cached.node, cached.kind === "sticker" ? "sticker" : cached.kind);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (buffer.length) return { buffer, node: cached.node };
      errors.push("stash: empty stream");
    } catch (error) {
      errors.push("stash: " + String(error?.message || error).slice(0, 110));
    }
    // 4) The media-retry protocol: fresh node from WhatsApp + sender's phone.
    if (key.id) {
      const fresh = await refreshMediaLocation(ctx, key, cached.node);
      if (fresh) {
        try {
          const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
          const stream = await downloadContentFromMessage(fresh, cached.kind === "sticker" ? "sticker" : cached.kind);
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          const buffer = Buffer.concat(chunks);
          if (buffer.length) return { buffer, node: fresh };
          errors.push("refreshed: empty stream");
        } catch (error) {
          errors.push("refreshed: " + String(error?.message || error).slice(0, 110));
        }
      } else {
        errors.push("refresh: no fresh location returned");
      }
      // 5) Baileys' own reupload protocol on the stashed node, last resort.
      const official = await retryDownload(ctx, key, { [cached.nodeKind || mediaNodeKeyOf(cached.kind)]: cached.node },
        Number(cached.ts || 0), errors, "stash-node");
      if (official) return { buffer: official, node: cached.node };
    }
  }
  // Every attempt is reported — the next field report tells us exactly what
  // WhatsApp said instead of a flat "nothing worked".
  return { failure: errors.slice(0, 3).join(" · ") || "no source had the bytes" };
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

// The media-retry protocol run DIRECTLY on a quoted view-once copy (v2.4.1).
// The quote carries mediaKey but no usable URL — updateMediaMessage needs
// exactly that: it asks WhatsApp, WhatsApp asks the sender's phone, and the
// fresh directPath comes back. Exported for tests.
export async function refreshQuotedMedia(ctx, key, quoted, errors = null) {
  try {
    const inner = unwrapMessage(quoted);
    const nodeKey = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"]
      .find(k => inner?.[k]?.mediaKey);
    if (!nodeKey) {
      if (errors) errors.push("quote-retry: quote carries no mediaKey");
      return null;
    }
    const updated = await ctx.sock.updateMediaMessage({
      key: {
        remoteJid: String(key.remoteJid || ""),
        id: String(key.id || ""),
        fromMe: Boolean(key.fromMe),
        ...(key.participant ? { participant: String(key.participant) } : {})
      },
      message: { [nodeKey]: inner[nodeKey] }
    });
    const fresh = updated?.message?.[nodeKey] || inner[nodeKey];
    return (fresh?.url || fresh?.directPath) ? { node: fresh, kind: nodeKey } : null;
  } catch (error) {
    // A refusal carries the reason: MISSING = the view-once was opened or
    // expired on the sender's phone, and WhatsApp will not re-serve it.
    if (errors) errors.push("quote-retry: " + String(error?.message || error).slice(0, 110));
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

// When a .ggs lands inside WhatsApp's re-serve window, the stash fills
// seconds AFTER the command already answered — and the sequential message
// queue means waiting inside the command would block the very arrival it
// waits for. So the late check runs OUTSIDE the command: two short timers
// re-read the stash and deliver automatically when the bytes land.
const lateArmed = new Set();

function inferKindFromNode(node) {
  const mime = String(node?.mimetype || "");
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "image";
}

export function scheduleLateRecovery(ctx, quotedKey, quoted, deliver, delays = [4000, 10000]) {
  const chat = String(quotedKey?.remoteJid || ctx.jid || "");
  const id = String(quotedKey?.id || "");
  if (!id) return;
  const stamp = chat + "|" + id;
  if (lateArmed.has(stamp)) return;
  lateArmed.add(stamp);
  if (lateArmed.size > 100) {
    for (const key of lateArmed) { lateArmed.delete(key); if (lateArmed.size <= 60) break; }
  }
  let done = false;
  for (const delayMs of delays) {
    const last = delayMs >= Math.max(...delays);
    setTimeout(() => {
      void (async () => {
        try {
          if (!done) {
            const fresh = findCachedViewOnce(chat, id) || findCachedViewOnce("", id);
            if (fresh && (fresh.node || fresh.file)) {
              const result = await recoverBuffer(ctx, {
                ...fresh,
                stanzaId: id,
                nodeKind: fresh.nodeKind || mediaNodeKeyOf(fresh.kind === "unknown" ? "image" : fresh.kind)
              }, null, quotedKey);
              if (result?.buffer) {
                done = true;
                await deliver(result.buffer, result.node || fresh.node,
                  fresh.kind && fresh.kind !== "unknown" ? fresh.kind : inferKindFromNode(result.node || fresh.node));
              }
            }
          }
        } catch { /* a late check must never break anything */ }
        if (last) lateArmed.delete(stamp);
      })();
    }, delayMs);
  }
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
      const kind = (cached?.kind && cached.kind !== "unknown")
        ? cached.kind
        : mediaKindOf(unwrapMessage(qc.quoted));
      const nodeKind = mediaNodeKeyOf(kind);
      // The quote's participant is the ORIGINAL sender — the best retry key
      // when the stash entry somehow lost its own. fromMe is COMPUTED, the
      // v1.4.45 rule: forcing it false made every self-sent and LID-chat
      // retry refused by the server.
      const participant = normalizeJid(qc.info.participant || "");
      const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid]
        .map(normalizeJid).filter(Boolean);
      const quotedKey = {
        remoteJid: String(ctx.jid || ""),
        id: String(qc.info.stanzaId || ""),
        fromMe: Boolean(participant && selfIds.includes(participant)),
        ...(participant ? { participant } : {})
      };
      const result = await recoverBuffer(ctx, cached ? {
        ...cached,
        stanzaId: qc.info.stanzaId,
        nodeKind
      } : null, qc.quoted, quotedKey);
      if (!result?.buffer) {
        const held = cached?.marker === true;
        await ctx.reply("⚠️ I saw that view-once, but WhatsApp would not hand the bytes back this time.\nTried: " +
          (result?.failure || "no source had the bytes") +
          (held
            ? "\n\nWhatsApp withheld the original from this device and the re-serve hasn't landed yet. If it lands in the next few seconds I will deliver it here automatically. Otherwise: keep the view-once un-opened on the sender's phone, resend while THEIR phone is online and unlocked, wait ~5 seconds, then try again."
            : "\nIf it is still un-opened, react 🔓 to it and I will try again while the sender is online."));
        scheduleLateRecovery(ctx, quotedKey, null, (buffer, node, lateKind) =>
          sendRecovered(ctx, lateKind || kind, buffer, source, node));
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
      // Diagnostics must REPLY, never throw: the runtime's catch-all turns a
      // throw into a generic "could not be completed" and the explanation
      // never reaches the owner (v2.3.3 bug report).
      if (!qc) {
        await ctx.reply("⚠️ Reply to the view-once message first — .vvinfo inspects the message you replied to.");
        return;
      }
      const cached = findCachedViewOnce(ctx.jid, qc.info.stanzaId) ||
        findCachedViewOnce("", qc.info.stanzaId);
      if (!cached) {
        await ctx.reply(
          "⚠️ That message never reached me — WhatsApp does not re-deliver missed media, whether I was restarting, re-pairing, or the network never handed it over.\n" +
          "Recent ids remembered: " + (recentStashIds(3).map(x => "…" + x).join("  ") || "none") +
          ".\nMedia remembered since boot: " + viewOnceCacheSize() + ".\n" +
          "Tip: send the view-once again while I am online — the bytes are captured the moment they arrive.");
        return;
      }
      const captured = readCachedMedia(cached);
      const lines = [
        "*VIEW-ONCE REPORT*",
        "View-once: " + (cached.wasViewOnce ? "true" : "false"),
        "Kind: " + cached.kind,
        "Arrival id: " + qc.info.stanzaId,
        "Bytes on disk: " + (captured ? "captured ✅" : (cached.node ? "no — live fetch only" : "never arrived")),
        "Capture passes: " + (cached.captureAttempts || 0) +
          (cached.captureError ? " (last: " + cached.captureError + ")" : "")
      ];
      if (!cached.node && !captured) {
        lines.push("", "That message reached me, but WhatsApp withheld its content — the linked-device view-once limitation. React 🔓 now: un-opened view-onces re-serve in seconds; opened or expired ones never do.");
      } else if (!captured) {
        lines.push("", "The bytes were not captured on arrival, so recovery depends on the sender's phone being online (media-retry). If .ggs/.vv fail, ask the sender to stay online and react 🔓 to the original.");
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
