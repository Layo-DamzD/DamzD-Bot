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

const MAX_ENTRIES = 200;
const TTL_MS = 24 * 60 * 60 * 1000;

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
    const hasViewOnceWrapper = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]
      .some(key => message[key] && message[key].message);
    if (!hasViewOnceWrapper) return false;
    const inner = unwrapMessage(message);
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
      return true;
    }
    return false;
  } catch {
    return false; // caching must never break message processing
  }
}

export function findCachedViewOnce(chatJid, stanzaId) {
  const id = String(stanzaId || "");
  if (!id) return null;
  const chat = normalizeJid(String(chatJid || ""));
  if (!chat) return null;
  const entry = stash.get(chat + "|" + id);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    stash.delete(chat + "|" + id);
    return null;
  }
  return { node: entry.node, kind: entry.kind, sender: entry.sender };
}

export function viewOnceCacheSize() {
  prune();
  return stash.size;
}
