import path from "node:path";
import { downloadMediaMessage, proto } from "@whiskeysockets/baileys";

import { createJsonStateStore } from "./state-store.js";
import { messageText, normalizeJid, numberFromJid, unwrapMessage } from "./message-utils.js";

const dataDirectory = path.resolve(process.env.FEI_DATA_DIR || "./data");
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 24 * 1024 * 1024;
const MAX_PARALLEL_MEDIA_DOWNLOADS = 3;

function normalizeDelivery(value) {
  const target = String(value || "").trim().toLowerCase();
  if (target === "dm" || target === "both") return target;
  return "chat";
}

export function createAntiDeleteSettingsStore({
  filePath = path.join(dataDirectory, "antidelete-settings.json")
} = {}) {
  const store = createJsonStateStore({
    filePath,
    defaults: {
      chats: {},
      global: { deltarget: "chat" }
    }
  });

  async function getSettings(chatJid) {
    const state = await store.load();
    const local = state.chats?.[String(chatJid || "")] || {};
    return {
      enabled: local.antidelete === true,
      delivery: normalizeDelivery(state.global?.deltarget)
    };
  }

  async function setEnabled(chatJid, enabled) {
    const jid = String(chatJid || "");
    if (!jid.includes("@")) throw new Error("A valid WhatsApp chat JID is required.");
    await store.update(state => {
      state.chats ||= {};
      state.chats[jid] ||= {};
      state.chats[jid].antidelete = Boolean(enabled);
    });
    return getSettings(jid);
  }

  async function setDelivery(value) {
    const target = normalizeDelivery(value);
    await store.update(state => {
      state.global ||= {};
      state.global.deltarget = target;
    });
    return target;
  }

  async function getDelivery() {
    const state = await store.load();
    return normalizeDelivery(state.global?.deltarget);
  }

  return {
    getSettings,
    setEnabled,
    setDelivery,
    getDelivery,
    flush: () => store.flush()
  };
}

const settingsStore = createAntiDeleteSettingsStore();

export const getAntiDeleteSettings = chatJid => settingsStore.getSettings(chatJid);
export const setAntiDeleteEnabled = (chatJid, enabled) => settingsStore.setEnabled(chatJid, enabled);
export const setAntiDeleteDelivery = value => settingsStore.setDelivery(value);
export const getAntiDeleteDelivery = () => settingsStore.getDelivery();

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

function getMedia(message) {
  if (hasViewOnceWrapper(message)) return null;
  const body = unwrapMessage(message);
  if (body.imageMessage) return { kind: "image", media: body.imageMessage };
  if (body.videoMessage) return { kind: "video", media: body.videoMessage };
  if (body.audioMessage) return { kind: "audio", media: body.audioMessage };
  if (body.documentMessage) return { kind: "document", media: body.documentMessage };
  if (body.stickerMessage) return { kind: "sticker", media: body.stickerMessage };
  return null;
}

function toNumber(value) {
  if (value && typeof value.toNumber === "function") return value.toNumber();
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cacheKey(key) {
  const jid = normalizeJid(key?.remoteJid || "");
  const id = String(key?.id || "");
  return jid && id ? jid + ":" + id : "";
}

function senderForKey(key, sock) {
  if (key?.fromMe) return normalizeJid(sock?.user?.id || sock?.user?.lid || "");
  return normalizeJid(key?.participantPn || key?.participant || key?.remoteJid || "");
}

function uniqueJids(values) {
  return [...new Set(values.map(normalizeJid).filter(value => value.includes("@")))];
}

function makeRestorePayload(record) {
  const body = unwrapMessage(record.message);
  const media = getMedia(record.message);
  if (media && Buffer.isBuffer(record.mediaBuffer) && record.mediaBuffer.length) {
    const caption = String(media.media.caption || "").slice(0, 1500);
    if (media.kind === "image" || media.kind === "video") {
      return {
        [media.kind]: record.mediaBuffer,
        ...(caption ? { caption } : {}),
        ...(media.media.mimetype ? { mimetype: media.media.mimetype } : {})
      };
    }
    if (media.kind === "audio") {
      return {
        audio: record.mediaBuffer,
        mimetype: media.media.mimetype || "audio/ogg; codecs=opus",
        ptt: Boolean(media.media.ptt)
      };
    }
    if (media.kind === "document") {
      return {
        document: record.mediaBuffer,
        mimetype: media.media.mimetype || "application/octet-stream",
        fileName: String(media.media.fileName || "recovered-file").slice(0, 180),
        ...(caption ? { caption } : {})
      };
    }
    return { sticker: record.mediaBuffer };
  }

  const text = messageText(record.message);
  if (text) return { text: text.slice(0, 6000) };
  return null;
}

function describeMessage(record) {
  const media = getMedia(record.message);
  if (media) return media.kind + (media.kind === "document" ? " attachment" : "");
  return "message";
}

export function createAntiDeleteRuntime({
  settings = settingsStore,
  now = () => Date.now()
} = {}) {
  const cached = new Map();
  let pendingMediaDownloads = 0;

  function prune() {
    const timestamp = now();
    for (const [key, record] of cached) {
      if (timestamp - record.cachedAt > CACHE_TTL_MS) cached.delete(key);
    }
    while (cached.size > MAX_CACHE_ENTRIES) {
      cached.delete(cached.keys().next().value);
    }

    let totalMediaBytes = 0;
    for (const record of cached.values()) {
      totalMediaBytes += record.mediaBuffer?.length || 0;
    }
    if (totalMediaBytes > MAX_TOTAL_MEDIA_BYTES) {
      for (const [key, record] of cached) {
        if (!record.mediaBuffer) continue;
        totalMediaBytes -= record.mediaBuffer.length;
        record.mediaBuffer = null;
        if (totalMediaBytes <= MAX_TOTAL_MEDIA_BYTES) break;
      }
    }
  }

  async function cacheIncomingMessage(sock, msg) {
    const jid = String(msg?.key?.remoteJid || "");
    const key = cacheKey(msg?.key);
    if (!jid.includes("@") || !key || !msg?.message) return false;
    if (msg.message.protocolMessage || hasViewOnceWrapper(msg.message)) return false;

    let active;
    try {
      active = await settings.getSettings(jid);
    } catch {
      return false;
    }
    if (!active.enabled) return false;

    const record = {
      key: { ...msg.key },
      message: msg.message,
      cachedAt: now(),
      mediaBuffer: null,
      mediaPromise: null
    };
    cached.delete(key);
    cached.set(key, record);
    prune();

    const media = getMedia(msg.message);
    const expectedSize = toNumber(media?.media?.fileLength);
    if (media && (!expectedSize || expectedSize <= MAX_MEDIA_BYTES) &&
        pendingMediaDownloads < MAX_PARALLEL_MEDIA_DOWNLOADS) {
      pendingMediaDownloads += 1;
      record.mediaPromise = downloadMediaMessage(
        msg,
        "buffer",
        {},
        { reuploadRequest: sock.updateMediaMessage }
      ).then(buffer => {
        if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_MEDIA_BYTES) return null;
        if (!cached.has(key)) return null;
        record.mediaBuffer = buffer;
        prune();
        return buffer;
      }).catch(error => {
        console.warn("FEI XMD anti-delete media cache failed:", error?.message || error);
        return null;
      }).finally(() => {
        pendingMediaDownloads = Math.max(0, pendingMediaDownloads - 1);
      });
    }

    return true;
  }

  async function handleDeleteUpdate(sock, event) {
    prune();
    const revokeType = proto?.WebMessageInfo?.StubType?.REVOKE ?? 1;
    if (event?.update?.messageStubType !== revokeType) return false;

    const originalKey = event.key;
    const lookupKey = cacheKey(originalKey);
    if (!lookupKey) return false;

    let active;
    try {
      active = await settings.getSettings(originalKey.remoteJid);
    } catch {
      return false;
    }
    if (!active.enabled) return false;

    const record = cached.get(lookupKey);
    if (!record) {
      const delivery = active.delivery;
      const targets = uniqueJids([
        delivery === "chat" || delivery === "both" ? originalKey.remoteJid : "",
        delivery === "dm" || delivery === "both" ? sock?.user?.id || sock?.user?.lid : ""
      ]);
      for (const target of targets) {
        await sock.sendMessage(target, {
          text: "🗑️ A message was deleted for everyone, but it was not in FEI XMD's temporary cache."
        }).catch(() => {});
      }
      return false;
    }

    if (record.mediaPromise && !record.mediaBuffer) {
      await Promise.race([
        record.mediaPromise,
        new Promise(resolve => setTimeout(resolve, 7000))
      ]);
    }

    const actorKey = event.update?.key || {};
    const actorJid = senderForKey(actorKey, sock);
    const originalSenderJid = senderForKey(record.key, sock);
    const mentions = uniqueJids([actorJid, originalSenderJid]);
    const actorNumber = numberFromJid(actorJid);
    const originalNumber = numberFromJid(originalSenderJid);
    const delivery = active.delivery;
    const targets = uniqueJids([
      delivery === "chat" || delivery === "both" ? originalKey.remoteJid : "",
      delivery === "dm" || delivery === "both" ? sock?.user?.id || sock?.user?.lid : ""
    ]);

    const header = "🗑️ *MESSAGE DELETED FOR EVERYONE*\n" +
      "Deleted by: " + (actorNumber ? "@" + actorNumber : "unknown") + "\n" +
      "Original sender: " + (originalNumber ? "@" + originalNumber : "unknown") + "\n" +
      "Content: " + describeMessage(record) +
      (record.mediaBuffer || !getMedia(record.message)
        ? ""
        : "\n_Media could not be cached before deletion._");

    const payload = makeRestorePayload(record);
    for (const target of targets) {
      await sock.sendMessage(target, {
        text: header,
        mentions
      }).catch(error => {
        console.warn("FEI XMD anti-delete notification failed:", error?.message || error);
      });
      if (payload) {
        await sock.sendMessage(target, payload).catch(error => {
          console.warn("FEI XMD anti-delete restore failed:", error?.message || error);
        });
      }
    }

    cached.delete(lookupKey);
    return true;
  }

  return {
    cacheIncomingMessage,
    handleDeleteUpdate,
    clear: () => cached.clear(),
    get size() { return cached.size; }
  };
}
