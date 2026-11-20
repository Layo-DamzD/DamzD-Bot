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

// chatJid|stanzaId -> { node, kind, at, sender }
const stash = new Map();

const KINDS = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["stickerMessage", "sticker"],
  ["audioMessage", "audio"]
];

function prune() {
  const now = Date.now();
  for (const [key, entry] of stash) {
    if (now - entry.at > TTL_MS) stash.delete(key);
  }
  while (stash.size > MAX_ENTRIES) {
    const oldest = stash.keys().next().value;
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
    const carrier = findViewOnceCarrier(message);
    if (!carrier) return false;
    const inner = unwrapMessage(carrier);
    for (const [nodeKey, kind] of KINDS) {
      const node = inner[nodeKey];
      if (!node) continue;
      const chat = normalizeJid(String(msg?.key?.remoteJid || ""));
      const stanzaId = String(msg?.key?.id || "");
      if (!chat || !stanzaId) return false;
      stash.set(chat + "|" + stanzaId, {
        node,
        kind,
        at: Date.now(),
        sender: normalizeJid(String(msg?.key?.participant || ""))
      });
      prune();
      persistSoon();
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

// ---- the stash survives restarts: viewonce.json beside the activity store ----
let storePath = null;
let dirty = false;
let saveTimer = null;

export function initViewOnceStore(dataDirectory) {
  storePath = path.join(path.resolve(dataDirectory), "viewonce.json");
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
      return { node: entry.node, kind: entry.kind, sender: entry.sender };
    }
  }
  // Fallback: WhatsApp can deliver the same chat under two jid forms (the
  // phone-number form and the LID form), so the original view-once and the
  // quote may not agree on the chat key. Stanza ids are unique within the
  // cache window, so matching on the id alone is safe there.
  for (const [key, entry] of stash) {
    if (key.endsWith("|" + id)) {
      if (Date.now() - entry.at > TTL_MS) {
        stash.delete(key);
        continue;
      }
      return { node: entry.node, kind: entry.kind, sender: entry.sender };
    }
  }
  return null;
}

export function viewOnceCacheSize() {
  prune();
  return stash.size;
}
