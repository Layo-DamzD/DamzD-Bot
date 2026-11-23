// The view-once TEST extractors (.vv / .vv2) — per the owner's plan these
// two stay only to PROVE the view-once engine works; once it does, .ggs (the
// silent skin) is the everyday tool and these go.
//
// Hardened per the Gemini review:
//   • every wrapper is unwrapped — viewOnceMessage, viewOnceMessageV2,
//     viewOnceMessageV2Extension, ephemeralMessage,
//     documentWithCaptionMessage, deviceSentMessage (recursive);
//   • the media may also be a DIRECT node with viewOnce: true (newer
//     WhatsApp builds) — that counts too;
//   • view-once voice notes (audioMessage, ptt) are supported;
//   • the reply quote is read from contextInfo.quotedMessage, and — the
//     part the old build missed — the PERSISTENT arrival stash is consulted
//     first, the same cache .ggs uses, because WhatsApp strips the view-once
//     fields out of quoted copies;
//   • nothing view-once is ever re-sent as view-once: the outgoing payload
//     is built fresh from the recovered bytes.
import {
  getContextInfo,
  normalizeJid,
  unwrapMessage
} from "../../lib/message-utils.js";
import {
  findCachedViewOnce,
  recentStashIds,
  viewOnceCacheSize
} from "../../src/damzd/viewonce.js";
import {
  hasViewOnceWrapper,
  mediaKindOf,
  recoverBuffer
} from "./damzd.js";

const MEDIA_NODES = ["imageMessage", "videoMessage", "audioMessage", "documentMessage"];

function getQuotedMessage(ctx) {
  const info = getContextInfo(ctx.msg?.message);
  return info?.stanzaId && info?.quotedMessage ? info.quotedMessage : null;
}

function getQuotedKey(ctx) {
  const info = getContextInfo(ctx.msg?.message);
  if (!info?.stanzaId || !info?.quotedMessage) return null;

  const participant = normalizeJid(info.participant || "");
  const selfIds = [
    ctx.sock?.user?.id,
    ctx.sock?.user?.lid
  ].map(normalizeJid).filter(Boolean);

  const key = {
    remoteJid: String(ctx.msg?.key?.remoteJid || ctx.jid || ""),
    id: String(info.stanzaId),
    fromMe: Boolean(participant && selfIds.includes(participant))
  };
  if (participant) key.participant = participant;
  return key;
}

// The media node itself may carry viewOnce: true with no wrapper at all.
function hasViewOnceFlag(message) {
  const body = unwrapMessage(message);
  return MEDIA_NODES.some(nodeKey => body?.[nodeKey]?.viewOnce === true);
}

const MAX_RECOVERED_MEDIA_ENTRIES = 50;
const MAX_RECOVERED_MEDIA_BYTES = 64 * 1024 * 1024;
const recoveredMediaCache = new Map();
let recoveredMediaBytes = 0;

function recoveredMediaKey(key) {
  return key && key.remoteJid && key.id
    ? String(key.remoteJid) + ":" + String(key.id)
    : "";
}

function getCachedRecoveredMedia(key) {
  const cacheKey = recoveredMediaKey(key);
  const entry = cacheKey && recoveredMediaCache.get(cacheKey);
  if (!entry) return null;
  recoveredMediaCache.delete(cacheKey);
  recoveredMediaCache.set(cacheKey, entry);
  return entry.result;
}

function rememberRecoveredMedia(key, result) {
  const cacheKey = recoveredMediaKey(key);
  const buffer = result?.buffer;
  if (!cacheKey || !Buffer.isBuffer(buffer) || !buffer.length ||
      buffer.length > MAX_RECOVERED_MEDIA_BYTES) return;

  const previous = recoveredMediaCache.get(cacheKey);
  if (previous) {
    recoveredMediaBytes -= previous.size;
    recoveredMediaCache.delete(cacheKey);
  }

  recoveredMediaCache.set(cacheKey, { result, size: buffer.length });
  recoveredMediaBytes += buffer.length;

  while (recoveredMediaCache.size > MAX_RECOVERED_MEDIA_ENTRIES ||
         recoveredMediaBytes > MAX_RECOVERED_MEDIA_BYTES) {
    const oldestKey = recoveredMediaCache.keys().next().value;
    const oldest = recoveredMediaCache.get(oldestKey);
    if (!oldest) break;
    recoveredMediaBytes -= oldest.size;
    recoveredMediaCache.delete(oldestKey);
  }
}

async function recoverViewOnce(ctx) {
  const key = getQuotedKey(ctx);
  if (!key) {
    return {
      error: "Reply to a view-once photo, video, voice note or document with " +
        ctx.config.prefix + ctx.command + " (test extractor)."
    };
  }

  const cachedResult = getCachedRecoveredMedia(key);
  if (cachedResult) return cachedResult;

  const quoted = getQuotedMessage(ctx);

  // 1) The arrival stash — what the bot actually received live. WhatsApp
  //    strips view-once fields from quoted copies, so this is the source
  //    of truth when the original reached us.
  const stashKey = key.id ? String(key.id) : "";
  const cached = (stashKey && (findCachedViewOnce(key.remoteJid, stashKey) ||
    findCachedViewOnce("", stashKey))) || null;

  // 2) The quote may still carry a wrapper (older clients) or a direct
  //    viewOnce-flagged media node (newer clients).
  const quoteCarriesIt = Boolean(quoted) &&
    (hasViewOnceWrapper(quoted) || hasViewOnceFlag(quoted));

  if (!cached && !quoteCarriesIt) {
    return {
      error: "That message is not view-once as far as I can tell — no wrapper " +
        "on the quote and nothing in my arrival cache for it.\n" +
        "If it WAS a view-once, the original never reached me (bot was " +
        "restarting, re-pairing, or WhatsApp withheld it from this linked " +
        "device). Check .vvinfo, or use .ggs / react 🔓 — and remember: " +
        "media remembered since boot = " + viewOnceCacheSize() +
        " (" + (recentStashIds(3).map(x => "…" + x).join("  ") || "no ids") + ")."
    };
  }

  const kind = cached?.kind || (quoted ? mediaKindOf(unwrapMessage(quoted)) : "");
  if (!kind || kind === "sticker") {
    return {
      error: "That view-once message carries no supported media (view-once " +
        "stickers and text are not supported)."
    };
  }

  const result = await recoverBuffer(
    ctx,
    cached ? { ...cached, stanzaId: stashKey, nodeKind: cached.nodeKind || nodeKeyOf(kind) } : null,
    quoteCarriesIt ? quoted : null
  );
  if (!result?.buffer) {
    return {
      error: "I recognised this view-once, but WhatsApp would not hand the " +
        "bytes back this time. Try again while the sender's phone is " +
        "online — or react 🔓 to it."
    };
  }

  const found = { kind, buffer: result.buffer, media: unwrapMessage(quoted)?.[nodeKeyOf(kind)] || result.node?.[nodeKeyOf(kind)] || {} };
  rememberRecoveredMedia(key, found);
  return found;
}

function nodeKeyOf(kind) {
  return MEDIA_NODES.find(nodeKey => nodeKey.toLowerCase().startsWith(kind)) ||
    ({ image: "imageMessage", video: "videoMessage", audio: "audioMessage", document: "documentMessage" }[kind] || "");
}

export function viewOncePayload(result) {
  const content = { [result.kind]: result.buffer };
  const caption = String(result.media?.caption || "").trim();

  if (["image", "video", "document"].includes(result.kind) && caption) {
    content.caption = caption.slice(0, 1000);
  }
  if (result.kind === "image" || result.kind === "video") {
    content.mimetype = result.media?.mimetype ||
      (result.kind === "image" ? "image/jpeg" : "video/mp4");
  }
  if (result.kind === "audio") {
    content.mimetype = result.media?.mimetype || "audio/mpeg";
    content.ptt = Boolean(result.media?.ptt);
  }
  if (result.kind === "document") {
    content.mimetype = result.media?.mimetype || "application/octet-stream";
    content.fileName = String(result.media?.fileName || "view-once").slice(0, 180);
  }
  // Defensive: the re-sent media is NEVER view-once.
  delete content.viewOnce;
  return content;
}

export function buildViewOnceCaption(result) {
  const originalCaption = String(result?.media?.caption || "").trim().slice(0, 750);
  return [
    "Media extracted from view-once successfully ✅ (test extractor)",
    ...(originalCaption ? [originalCaption] : [])
  ].join("\n\n");
}

async function sendBrandedViewOnce(ctx, result) {
  const payload = viewOncePayload(result);
  const caption = buildViewOnceCaption(result);

  if (result.kind === "audio") {
    await ctx.send(payload);
    await ctx.send({ text: caption });
    return;
  }

  payload.caption = caption;
  await ctx.send(payload);
}

export default [
  {
    name: "vv",
    category: "Media & Tools",
    description: "TEST extractor — recovers a replied-to view-once media into this chat. Once proven, .ggs takes over.",
    run: async ctx => {
      const result = await recoverViewOnce(ctx);
      if (result.error) {
        await ctx.reply("⚠️ " + result.error);
        return;
      }
      await sendBrandedViewOnce(ctx, result);
    }
  },
  {
    name: "vv2",
    category: "Media & Tools",
    description: "TEST extractor — recovers a replied-to view-once media into your DM with the bot.",
    run: async ctx => {
      const result = await recoverViewOnce(ctx);
      if (result.error) {
        await ctx.reply("⚠️ " + result.error);
        return;
      }

      const target = normalizeJid(ctx.senderJid || "");
      if (!target) {
        await ctx.reply("⚠️ Could not resolve your WhatsApp ID for the DM.");
        return;
      }

      try {
        await ctx.sock.sendMessage(target, viewOncePayload(result));
        await ctx.reply("✅ The media was sent to your private chat with DamzD.");
      } catch (error) {
        await ctx.reply("⚠️ Could not send the media to your DM: " +
          String(error?.message || error).slice(0, 180));
      }
    }
  }
];
