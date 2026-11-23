import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { POWERED_FOOTER } from "../../lib/api-client.js";
import {
  getContextInfo,
  normalizeJid,
  unwrapMessage
} from "../../lib/message-utils.js";

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

function viewOnceMedia(message) {
  const body = unwrapMessage(message);
  if (body.imageMessage) return { kind: "image", media: body.imageMessage };
  if (body.videoMessage) return { kind: "video", media: body.videoMessage };
  if (body.audioMessage) return { kind: "audio", media: body.audioMessage };
  if (body.documentMessage) return { kind: "document", media: body.documentMessage };
  return null;
}

function hasViewOnceWrapper(message) {
  let current = message;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (Object.keys(current).some(key => /viewOnceMessage/i.test(key))) return true;
    current = current.ephemeralMessage?.message ||
      current.documentWithCaptionMessage?.message ||
      current.deviceSentMessage?.message;
  }
  return false;
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
      error: "Reply to a view-once image, video, voice note or document with " +
        ctx.config.prefix + ctx.command + "."
    };
  }

  const cachedResult = getCachedRecoveredMedia(key);
  if (cachedResult) return cachedResult;

  const quoted = getQuotedMessage(ctx);
  if (!hasViewOnceWrapper(quoted)) {
    return { error: "The replied-to message is not view-once media." };
  }

  const found = viewOnceMedia(quoted);
  if (!found) {
    return {
      error: "That view-once message carries no downloadable media (view-once stickers and text are not supported)."
    };
  }

  let buffer;
  try {
    buffer = await downloadMediaMessage(
      { key, message: quoted, messageTimestamp: ctx.msg?.messageTimestamp },
      "buffer",
      {},
      { reuploadRequest: ctx.sock.updateMediaMessage }
    );
  } catch (error) {
    const detail = String(error?.message || error || "unknown download error").slice(0, 160);
    return {
      error: "I couldn't download this media (Baileys: " + detail +
        "). Try again while the original sender is online."
    };
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { error: "WhatsApp did not return the view-once media data." };
  }

  const result = { ...found, buffer };
  rememberRecoveredMedia(key, result);
  return result;
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
  return content;
}

export function buildViewOnceCaption(result) {
  const originalCaption = String(result?.media?.caption || "").trim().slice(0, 750);
  return [
    "Media extracted from view-once successfully ✅",
    ...(originalCaption ? [originalCaption] : []),
    POWERED_FOOTER
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
    description: "Recover a replied-to view-once media message into this chat.",
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
    description: "Recover a replied-to view-once media message into your DM with the bot.",
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
        await ctx.reply("✅ The media was sent to your private chat with FEI XMD.");
      } catch (error) {
        await ctx.reply("⚠️ Could not send the media to your DM: " +
          String(error?.message || error).slice(0, 180));
      }
    }
  }
];
