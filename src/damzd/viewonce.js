// DamzD view-once engine — ported from the DamzD v1.4.x codebase onto the
// FEI runtime. The hiding of a view-once photo or video is purely
// client-side: the raw message the bot receives still carries the full
// media metadata. But a *quoted* copy travels through WhatsApp's contextInfo
// without those fields — the server strips them — so recovery relies on two
// things: remember every view-once stanza the bot legitimately sees, and
// capture the BYTES on arrival (WhatsApp serves view-once media under a
// one-serving policy — once opened, the retry protocol refuses to re-serve
// and the CDN URL ages out). With bytes on disk, recovery works no matter
// when the reaction comes and no matter which phone sent it.
import { unwrapMessage, normalizeJid } from "../../lib/message-utils.js";
import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 400;
const TTL_MS = 72 * 60 * 60 * 1000;
const MEDIA_DIR_NAME = "viewonce-media";
const MAX_MEDIA_BYTES = 80 * 1024 * 1024;
const MAX_SINGLE_MEDIA_BYTES = 50 * 1024 * 1024;

// chatJid|stanzaId -> { node, kind, at, sender, file?, size?, wasViewOnce }
const stash = new Map();
let mediaPath = null;
const prefetching = new Set();

const KINDS = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["stickerMessage", "sticker"],
  ["audioMessage", "audio"]
];

function prune() {
  const now = Date.now();
  for (const [key, entry] of stash) {
    if (now - entry.at > TTL_MS) {
      deleteMediaFile(entry);
      stash.delete(key);
    }
  }
  while (stash.size > MAX_ENTRIES) {
    const oldest = stash.keys().next().value;
    deleteMediaFile(stash.get(oldest));
    stash.delete(oldest);
  }
}

function stashMediaNode(msg, node, kind, wasViewOnce) {
  const chat = normalizeJid(String(msg?.key?.remoteJid || ""));
  const stanzaId = String(msg?.key?.id || "");
  if (!chat || !stanzaId) return false;
  const key = chat + "|" + stanzaId;
  const previous = stash.get(key);
  const entry = {
    node,
    kind,
    at: Date.now(),
    sender: normalizeJid(String(msg?.key?.participant || "")),
    wasViewOnce: Boolean(wasViewOnce),
    // The retry protocol needs the ORIGINAL key: which chat it lives in and
    // whether the bot itself sent it (fromMe decides who is asked to re-serve).
    chat,
    fromMe: Boolean(msg?.key?.fromMe),
    // Capture diagnostics for .vvinfo: how many prefetch attempts ran and
    // what the last one said. NOT persisted (dropped in saveStash).
    captureAttempts: previous?.captureAttempts || 0,
    captureError: ""
  };
  stash.set(key, entry);
  prune();
  dirty = true;
  schedulePrefetch(key, entry);
  return true;
}

// Call for every incoming message, before any gating: the cache is passive
// metadata and must exist for every chat the bot can see.
export function stashViewOnce(msg) {
  try {
    const message = msg?.message;
    if (!message) return false;
    // The view-once wrapper rarely travels naked — it hides under
    // ephemeralMessage in disappearing-mode chats and under
    // deviceSentMessage for the owner's own sends. Walk every level.
    let carrier = findViewOnceCarrier(message);
    if (!carrier) {
      const direct = unwrapMessage(message);
      for (const [nodeKey] of KINDS) {
        if (direct?.[nodeKey]?.viewOnce === true) { carrier = direct; break; }
      }
      if (!carrier) return false;
    }
    const inner = unwrapMessage(carrier);
    for (const [nodeKey, kind] of KINDS) {
      const node = inner[nodeKey];
      if (!node) continue;
      return stashMediaNode(msg, node, kind, true);
    }
    return false;
  } catch {
    return false; // caching must never break message processing
  }
}

// Any media node anywhere in the message tree, whatever wrapper carries it.
// Plain media gets remembered too: reacting to any message the bot actually
// saw is explicit intent.
export function findAnyMediaNode(message, depth = 0) {
  if (!message || typeof message !== "object" || depth > 6) return null;
  for (const [nodeKey] of KINDS) {
    if (message[nodeKey]) return { node: message[nodeKey], key: nodeKey };
  }
  for (const value of Object.values(message)) {
    if (!value || typeof value !== "object") continue;
    const found = findAnyMediaNode(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export function stashRememberMedia(msg) {
  try {
    const message = msg?.message;
    if (!message) return false;
    const chat = normalizeJid(String(msg?.key?.remoteJid || ""));
    const stanzaId = String(msg?.key?.id || "");
    if (!chat || !stanzaId || stash.has(chat + "|" + stanzaId)) return false;
    const found = findAnyMediaNode(message);
    if (!found) return false;
    const kind = KINDS.find(([nodeKey]) => nodeKey === found.key)?.[1] || "image";
    return stashMediaNode(msg, found.node, kind, false);
  } catch {
    return false;
  }
}

export function findViewOnceCarrier(message, depth = 0) {
  if (!message || typeof message !== "object" || depth > 6) return null;
  for (const key of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
    if (message[key]?.message) return message[key].message;
  }
  for (const value of Object.values(message)) {
    const inner = value?.message;
    if (inner && typeof inner === "object") {
      const found = findViewOnceCarrier(inner, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ---- capture-on-arrival: the bytes are home before anyone opens it ----

function deleteMediaFile(entry) {
  try { if (entry?.file && mediaPath) fs.unlinkSync(entry.file); } catch { /* already gone */ }
}

function enforceBudget() {
  try {
    const files = fs.readdirSync(mediaPath).map(name => {
      const full = path.join(mediaPath, name);
      const stat = fs.statSync(full);
      return { full, size: stat.size, at: stat.mtimeMs };
    });
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= MAX_MEDIA_BYTES) break;
      fs.unlinkSync(f.full);
      total -= f.size;
    }
  } catch { /* the budget is best-effort */ }
}

function schedulePrefetch(key, entry) {
  if (!mediaPath || entry.file || prefetching.has(key)) return;
  prefetching.add(key);
  // Three passes: WhatsApp's CDN can be briefly unavailable for brand-new
  // media, and a single early failure used to permanently mark the entry
  // un-capturable. 1.2s / 6s / 20s after arrival.
  const delays = [1200, 6000, 20000];
  const runPass = pass => {
    setTimeout(() => {
      if (entry.file || !stash.has(key)) {
        prefetching.delete(key);
        return;
      }
      prefetchMedia(key, entry).then(captured => {
        if (captured || pass >= delays.length - 1) {
          prefetching.delete(key);
          return;
        }
        runPass(pass + 1);
      }).catch(() => {
        if (pass >= delays.length - 1) prefetching.delete(key);
        else runPass(pass + 1);
      });
    }, delays[pass]);
  };
  runPass(0);
}

async function prefetchMedia(key, entry) {
  try {
    if (!mediaPath || entry.file) return true;
    entry.captureAttempts = (entry.captureAttempts || 0) + 1;
    const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
    const stream = await downloadContentFromMessage(entry.node, entry.kind === "sticker" ? "sticker" : entry.kind);
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > MAX_SINGLE_MEDIA_BYTES) {
        entry.captureError = "oversized";
        return false; // the live ladder stays the fallback
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 1024) {
      entry.captureError = "short transfer (" + buffer.length + "B)";
      return false; // a broken transfer is not a capture
    }
    fs.mkdirSync(mediaPath, { recursive: true });
    enforceBudget();
    const safe = key.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    const file = path.join(mediaPath, safe + ".bin");
    fs.writeFileSync(file, buffer);
    entry.file = file;
    entry.size = buffer.length;
    entry.captureError = "";
    dirty = true;
    return true;
  } catch (error) {
    entry.captureError = String(error?.message || error).slice(0, 120);
    return false; // capture is best-effort — the live ladder still exists
  }
}

export function readCachedMedia(entry) {
  try {
    if (!entry?.file || !mediaPath) return null;
    const buffer = fs.readFileSync(entry.file);
    return buffer.length ? buffer : null;
  } catch { return null; }
}

// ---- the stash survives restarts: viewonce.json beside the data store ----
let storePath = null;
let dirty = false;
let saveTimer = null;

export function initViewOnceStore(dataDirectory) {
  storePath = path.join(path.resolve(dataDirectory), "viewonce.json");
  mediaPath = path.join(path.resolve(dataDirectory), MEDIA_DIR_NAME);
  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (parsed && typeof parsed === "object") {
        for (const [key, entry] of Object.entries(parsed)) {
          if (entry?.node && entry?.kind && entry?.at) stash.set(key, entry);
        }
      }
    }
  } catch { /* a broken file costs nothing — the stash just starts empty */ }
  try {
    fs.mkdirSync(mediaPath, { recursive: true });
    const live = new Set([...stash.values()].map(entry => entry.file).filter(Boolean));
    for (const name of fs.readdirSync(mediaPath)) {
      const full = path.join(mediaPath, name);
      if (!live.has(full)) { try { fs.unlinkSync(full); } catch { /* next boot */ } }
    }
  } catch { /* best-effort */ }
  if (!saveTimer) {
    saveTimer = setInterval(() => saveStash(), 20000);
    if (saveTimer.unref) saveTimer.unref();
  }
}

function saveStash() {
  if (!storePath || !dirty) return;
  try {
    const out = {};
    for (const [key, entry] of stash) {
      try {
        // Capture diagnostics are runtime-only (they describe THIS boot's
        // prefetch passes); chat/fromMe DO persist so a restart keeps a
        // working retry key.
        const { captureAttempts, captureError, ...persistable } = entry;
        JSON.stringify(persistable);
        out[key] = persistable;
      } catch { /* that one entry stays memory-only */ }
    }
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(out));
    dirty = false;
  } catch { /* retried on the next tick */ }
}

export function findCachedViewOnce(chatJid, stanzaId) {
  const id = String(stanzaId || "");
  if (!id) return null;
  const chat = normalizeJid(String(chatJid || ""));
  const view = entry => ({
    node: entry.node,
    kind: entry.kind,
    sender: entry.sender,
    file: entry.file,
    size: entry.size,
    wasViewOnce: entry.wasViewOnce,
    chat: entry.chat,
    fromMe: entry.fromMe,
    captureAttempts: entry.captureAttempts,
    captureError: entry.captureError
  });
  if (chat) {
    const entry = stash.get(chat + "|" + id);
    if (entry) {
      if (Date.now() - entry.at > TTL_MS) {
        stash.delete(chat + "|" + id);
        return null;
      }
      return view(entry);
    }
  }
  // Fallback: WhatsApp can deliver the same chat under two jid forms (the
  // phone-number form and the LID form), so the original view-once and the
  // quote may not agree on the chat key. Stanza ids are unique within the
  // cache window, so matching on the id alone is safe there.
  for (const [key, entry] of stash) {
    if (key.endsWith("|" + id)) {
      if (Date.now() - entry.at > TTL_MS) {
        deleteMediaFile(entry);
        stash.delete(key);
        continue;
      }
      return view(entry);
    }
  }
  return null;
}

export function viewOnceCacheSize() {
  prune();
  return stash.size;
}

export function recentStashIds(limit = 3) {
  try {
    prune();
    const entries = [...stash.entries()]
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, limit);
    return entries.map(([key]) => {
      const id = String(key.split("|")[1] || "");
      return id ? id.slice(-10) : "";
    }).filter(Boolean);
  } catch {
    return [];
  }
}
