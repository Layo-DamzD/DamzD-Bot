// View-once recovery for everyone, not just the owner's own quotes.
//
// The hiding of a view-once photo or video is purely client-side: the raw
// message the bot receives still carries the full media metadata (URL,
// directPath, mediaKey). But a *quoted* copy of a view-once travels through
// WhatsApp's contextInfo without those fields — the server strips them — so
// downloading straight from the quote fails with Baileys' "No valid media URL
// or directPath present in message". That is why recovery worked when the
// owner quoted a view-once that had been sent to the bot itself (the quote
// still carried the metadata) and failed for normal users quoting anything
// else. The fix: remember every view-once stanza the bot can legitimately see
// (its own chats and the groups it is in), and when someone quotes one, match
// the quote back to the remembered original by the stanza id in contextInfo.
import { unwrapMessage, normalizeJid } from "./utils.js";
import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 400;
const TTL_MS = 72 * 60 * 60 * 1000;
// Capture-on-arrival: the bytes come home the moment the view-once lands,
// BEFORE anyone opens it. WhatsApp serves view-once media under a
// one-serving policy — once the recipient opens it, the media-retry protocol
// refuses to re-serve it and the CDN URL ages out — so a metadata-only stash
// loses to anyone who glanced at the photo before reacting. With the bytes
// already on disk, recovery works no matter when the reaction comes and no
// matter which phone sent it.
const MEDIA_DIR_NAME = "viewonce-media";
const MAX_MEDIA_BYTES = 80 * 1024 * 1024;
const MAX_SINGLE_MEDIA_BYTES = 50 * 1024 * 1024;

// chatJid|stanzaId -> { node, kind, at, sender, file?, size? }
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

// Call for every incoming message, before any gating: the cache is passive
// metadata and must exist for every chat the bot can see, whatever mode it is in.
export function stashViewOnce(msg) {
  try {
    const message = msg?.message;
    if (!message) return false;
    // The view-once wrapper rarely travels naked — it hides under
    // ephemeralMessage in disappearing-mode chats and under
    // deviceSentMessage for the owner's own sends. Walk every level.
    let carrier = findViewOnceCarrier(message);
    if (!carrier) {
      // Safety net for shapes the walker does not know: a media node can
      // carry the view-once flag directly, whatever wrapper surrounds it.
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
      const chat = normalizeJid(String(msg?.key?.remoteJid || ""));
      const stanzaId = String(msg?.key?.id || "");
      if (!chat || !stanzaId) return false;
      const key = chat + "|" + stanzaId;
      const entry = {
        node,
        kind,
        at: Date.now(),
        sender: normalizeJid(String(msg?.key?.participant || ""))
      };
      stash.set(key, entry);
      prune();
      persistSoon();
      schedulePrefetch(key, entry);
      return true;
    }
    return false;
  } catch {
    return false; // caching must never break message processing
  }
}

// Walk any wrapper nesting (ephemeral → view-once, device-sent → view-once,
// view-once inside view-once…) and return the message INSIDE the outermost
// view-once wrapper, or null when there is none.
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
  setTimeout(() => {
    prefetching.delete(key);
    prefetchMedia(key, entry);
  }, 2500);
}

async function prefetchMedia(key, entry) {
  try {
    if (!mediaPath || entry.file) return;
    const { downloadContentFromMessage } = await import("baileys");
    const stream = await downloadContentFromMessage(entry.node, entry.kind === "sticker" ? "sticker" : entry.kind);
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > MAX_SINGLE_MEDIA_BYTES) return; // oversized — the live ladder stays the fallback
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 1024) return; // a broken transfer is not a capture
    fs.mkdirSync(mediaPath, { recursive: true });
    enforceBudget();
    const safe = key.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    const file = path.join(mediaPath, safe + ".bin");
    fs.writeFileSync(file, buffer);
    entry.file = file;
    entry.size = buffer.length;
    dirty = true;
  } catch { /* capture is best-effort — the live download ladder still exists */ }
}

// The captured bytes for a stash entry, or null when there are none.
export function readCachedMedia(entry) {
  try {
    if (!entry?.file || !mediaPath) return null;
    const buffer = fs.readFileSync(entry.file);
    return buffer.length ? buffer : null;
  } catch { return null; }
}

// ---- the stash survives restarts: viewonce.json beside the activity store ----
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
  // Captured bytes whose entry died with an earlier run are orphans — sweep.
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
        JSON.stringify(entry); // refuses unserializable entries (buffers etc.)
        out[key] = entry;
      } catch { /* that one entry stays memory-only */ }
    }
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(out));
    dirty = false;
  } catch { /* retried on the next tick */ }
}

function persistSoon() {
  dirty = true;
}

export function findCachedViewOnce(chatJid, stanzaId) {
  const id = String(stanzaId || "");
  if (!id) return null;
  const chat = normalizeJid(String(chatJid || ""));
  if (chat) {
    const entry = stash.get(chat + "|" + id);
    if (entry) {
      if (Date.now() - entry.at > TTL_MS) {
        stash.delete(chat + "|" + id);
        return null;
      }
      return { node: entry.node, kind: entry.kind, sender: entry.sender, file: entry.file, size: entry.size };
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
        return { node: entry.node, kind: entry.kind, sender: entry.sender, file: entry.file, size: entry.size };
      }
    }
  return null;
}

export function viewOnceCacheSize() {
  prune();
  return stash.size;
}
