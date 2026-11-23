import fs from "node:fs";
import path from "node:path";
import { compressForWhatsApp } from "./mediautil.js";

// The bot's picture (assets/bot-image.png by default, or a BOT_IMAGE URL) —
// sent first on .menu, .help and the connect note. A URL passes straight
// through; a local file is read once and cached. Null when nothing usable is
// set, so callers simply skip the picture.
let botImageBuffer;
let botImageCachedFor = "";
export function botImagePayload(config) {
  const source = String(config?.botImage || "").trim();
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return { image: { url: source } };
  try {
    if (botImageCachedFor !== source) {
      botImageBuffer = fs.readFileSync(path.resolve(source));
      botImageCachedFor = source;
    }
    return { image: botImageBuffer };
  } catch {
    return null;
  }
}

// The send-ready picture: same sources as botImagePayload, but a local file
// is compressed down to a WhatsApp-inline-friendly JPEG once (and cached) so
// it auto-loads on the phone instead of waiting for a manual download. URLs
// pass through untouched; null when nothing usable is set.
let botImageMediaPromise = null;
export async function botImageMedia(config) {
  const payload = botImagePayload(config);
  if (!payload) return null;
  if (payload.image?.url) return payload;
  if (!botImageMediaPromise) {
    botImageMediaPromise = compressForWhatsApp(payload.image)
      .then(buffer => ({ image: buffer }))
      .catch(() => payload);
  }
  return botImageMediaPromise;
}

const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "deviceSentMessage"
];

export function normalizeJid(value) {
  if (typeof value !== "string" || !value.includes("@")) return "";
  const [name, ...rest] = value.trim().toLowerCase().split("@");
  return name.split(":")[0] + "@" + rest.join("@");
}

export function numberFromJid(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

export function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth += 1) {
    const wrapper = WRAPPER_KEYS.find(key => current[key] && current[key].message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current || {};
}

export function messageText(message) {
  const value = unwrapMessage(message);
  return String(
    value.conversation ||
    value.extendedTextMessage?.text ||
    value.imageMessage?.caption ||
    value.videoMessage?.caption ||
    value.documentMessage?.caption ||
    value.buttonsResponseMessage?.selectedDisplayText ||
    value.listResponseMessage?.title ||
    ""
  ).trim();
}

export function getContextInfo(message) {
  const value = unwrapMessage(message);
  const keys = [
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage"
  ];
  for (const key of keys) {
    if (value[key]?.contextInfo) return value[key].contextInfo;
  }
  return null;
}

export function mentionedJids(message) {
  const info = getContextInfo(message);
  return (info?.mentionedJid || []).map(jid => normalizeJid(jid)).filter(Boolean);
}

export function quotedParticipant(message) {
  const info = getContextInfo(message);
  return normalizeJid(info?.participant || "");
}

export function quotedText(message) {
  const info = getContextInfo(message);
  const quoted = info?.quotedMessage;
  if (!quoted) return "";
  return messageText(quoted);
}

export function getMessageSender(msg, sock) {
  const key = msg?.key || {};
  if (key.participant) return normalizeJid(key.participant);
  if (key.fromMe) return normalizeJid(sock?.user?.id || sock?.user?.lid || key.remoteJid);
  return normalizeJid(key.remoteJid);
}

export async function fetchJson(url, { timeoutMs = 60000, label = "service", headers } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DamzD-Bot/1.1 (personal WhatsApp assistant)",
        ...(headers || {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long to respond. Try again in a moment.");
    }
    throw new Error("Could not reach the " + label + ". Please try again later.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The " + label + " returned something I could not read.");
  }
  if (!response.ok || payload?.success === false || payload?.status === false || payload?.error) {
    const detail = payload?.error?.message || payload?.error || payload?.message;
    throw new Error(typeof detail === "string" && detail.trim()
      ? detail.trim().slice(0, 200)
      : "The " + label + " could not handle that request.");
  }
  return payload;
}

export function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomInt(max) {
  return Math.floor(Math.random() * max);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const MEDIA_NODE_KEYS = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"];

// Which *Message key a bare media node travels under — for a full message
// object. A bare media node (mediaKey + mimetype, no *Message key) is the
// shape every stash entry and every quote actually carries, so the retry
// helpers below accept both shapes and wrap the bare one themselves.
export function mediaNodeKeyOf(node) {
  return MEDIA_NODE_KEYS.find(k => node?.[k]) || null;
}

function mediaRetryShape(node) {
  const keyed = mediaNodeKeyOf(node);
  if (keyed) return { key: keyed, message: node };
  if (!node?.mediaKey) return null; // neither shape — nothing to retry with
  // Bare media node: guess the *Message kind from the mimetype (a sticker's
  // image/webp correctly lands in imageMessage — the retry only needs the
  // key to package the node, the download is mimetype-driven anyway).
  const mime = String(node.mimetype || "");
  const kind = mime.startsWith("video/") ? "videoMessage"
    : mime.startsWith("audio/") ? "audioMessage"
    : "imageMessage";
  return { key: kind, message: { [kind]: node } };
}

// WhatsApp strips or expires the media location on messages the bot still
// holds: quotes lose url/directPath outright, and reconnect syncs can serve
// arrivals without them too ("No valid media URL or directPath present in
// message"). The official media-retry protocol asks WhatsApp and the
// sender's device to re-serve fresh media info for a message whose mediaKey
// we still have. Baileys' updateMediaMessage RETURNS the updated message —
// the fresh node with a new url/directPath is the whole point, so it is
// returned here. It does NOT mutate the node in place (the v1.4.30 comment
// claimed it did — that made every caller re-download the stale copy and
// waste a retry that had actually succeeded). Returns the fresh node, or
// null when there is nothing to retry with. The sender's phone can be slow
// to answer, so a refused or timed-out attempt is retried once.
export async function refreshMediaLocation(sock, key, node) {
  try {
    const shape = mediaRetryShape(node);
    if (!shape || !key?.id || !node.mediaKey || typeof sock?.updateMediaMessage !== "function") return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const updated = await sock.updateMediaMessage({
          key: {
            remoteJid: String(key.remoteJid || ""),
            id: String(key.id),
            fromMe: Boolean(key.fromMe),
            ...(key.participant ? { participant: String(key.participant) } : {})
          },
          message: shape.message
        });
        const fresh = updated?.message?.[shape.key] || updated?.[shape.key];
        if (fresh?.url || fresh?.directPath) return fresh;
      } catch (error) {
        if (attempt === 0) await sleep(1500);
      }
    }
    return null;
  } catch {
    return null; // the caller's original error stands
  }
}

// The official Baileys retry path (the father repo's proven shape):
// downloadMediaMessage drives the whole reupload protocol itself — failed
// download, media-retry IQ, fresh url, re-download — and returns the bytes.
// `message` accepts a full message object or a bare media node.
export async function officialRetryDownload(sock, key, message) {
  try {
    const shape = mediaRetryShape(message);
    if (!shape || !key?.id || typeof sock?.updateMediaMessage !== "function") return null;
    const { downloadMediaMessage } = await import("baileys");
    const buffer = await downloadMediaMessage(
      {
        key: {
          remoteJid: String(key.remoteJid || ""),
          id: String(key.id),
          fromMe: Boolean(key.fromMe),
          ...(key.participant ? { participant: String(key.participant) } : {})
        },
        message: shape.message
      },
      "buffer",
      {},
      { reuploadRequest: sock.updateMediaMessage }
    );
    return Buffer.isBuffer(buffer) && buffer.length ? buffer : null;
  } catch {
    return null;
  }
}
