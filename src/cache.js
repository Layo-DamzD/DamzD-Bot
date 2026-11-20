// Shared in-memory caches: message history for anti-delete / view-once
// recovery, plus PERSISTENT activity tracking for the group commands.
//
// The old activity tracker was a plain Map, so every restart (and every
// deploy — Render's disk is ephemeral) wiped it and .ghost immediately
// reported the whole group as quiet, including its chattiest members.
// Activity now lives in data/activity.json with a debounced writer, and each
// entry remembers BOTH forms of a member's identity (phone number and LID)
// so lists stay correct in WhatsApp's LID-mode groups.

import fs from "node:fs";
import path from "node:path";

const MAX_MESSAGES = 600;
const messages = new Map();

export function cacheMessage(key, record) {
  const id = String(key || "");
  if (!id) return;
  const entry = { ...record, at: Date.now() };
  messages.set(id, entry);
  if (nodeHasMedia(entry.node)) messagesDirty = true;
  if (messages.size > MAX_MESSAGES) {
    const oldest = messages.keys().next().value;
    messages.delete(oldest);
  }
}

export function getCached(key) {
  return messages.get(String(key || "")) || null;
}

export function dropCached(key) {
  messages.delete(String(key || ""));
}

// ---- persistent snapshot of media arrivals (anti-delete / reaction-save) ----
// Text messages die with the process without regret, but a media node is the
// ONLY copy of a view-once or a later-recoverable photo — so media arrivals
// survive restarts in messages.json. Status entries never carry a node and
// are skipped, and anything older than 72h is dead weight (media URLs have
// expired) so it is not reloaded.
let messagesPath = null;
let messagesDirty = false;
const MEDIA_TAG = /(imageMessage|videoMessage|audioMessage|stickerMessage|viewOnce|documentMessage)/;

function nodeHasMedia(node) {
  if (!node || typeof node !== "object") return false;
  try { return MEDIA_TAG.test(JSON.stringify(node)); } catch { return false; }
}

export function initMessageStore(dataDirectory) {
  messagesPath = path.join(path.resolve(dataDirectory), "messages.json");
  try {
    if (fs.existsSync(messagesPath)) {
      const parsed = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        for (const [id, record] of Object.entries(parsed)) {
          if (record?.node && record?.at && Date.now() - record.at <= 72 * 60 * 60 * 1000) {
            messages.set(id, record);
          }
        }
      }
    }
  } catch { /* a broken file costs nothing — the cache just starts empty */ }
}

export function flushMessages() {
  saveMessages();
}

function saveMessages() {
  if (!messagesPath || !messagesDirty) return;
  try {
    const out = {};
    for (const [id, record] of messages) {
      if (!record.node || !nodeHasMedia(record.node)) continue;
      try {
        JSON.stringify(record); // refuses unserializable nodes
        out[id] = record;
      } catch { /* that one entry stays memory-only */ }
    }
    fs.mkdirSync(path.dirname(messagesPath), { recursive: true });
    fs.writeFileSync(messagesPath, JSON.stringify(out));
    messagesDirty = false;
  } catch { /* retried on the next flush */ }
}

// ---- persistent group activity (used by .top, .ghost, .onlineusers, .roast) ----
const SAVE_EVERY_MS = 15000;
let storePath = null;
let db = { groups: {} };
let dirty = false;
let saveTimer = null;

export function initActivityStore(dataDirectory) {
  storePath = path.join(path.resolve(dataDirectory), "activity.json");
  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.groups && typeof parsed.groups === "object") {
        db = parsed;
      }
    }
  } catch {
    db = { groups: {} };
  }
  if (!db.groups || typeof db.groups !== "object") db.groups = {};
  if (!saveTimer) {
    saveTimer = setInterval(() => {
      if (dirty) saveNow();
      saveMessages();
    }, SAVE_EVERY_MS);
    if (saveTimer.unref) saveTimer.unref();
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    try {
      process.once(signal, () => {
        if (dirty) saveNow();
        saveMessages();
      });
    } catch {
      /* not all environments expose process signals */
    }
  }
}

function saveNow() {
  if (!storePath) return;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(db));
    dirty = false;
  } catch {
    /* a failed save is retried on the next tick */
  }
}

// Force a write now — used before a clean shutdown and by the tests.
export function flushActivity() {
  saveNow();
}

function groupDb(jid) {
  const key = String(jid || "");
  if (!key) return null;
  let group = db.groups[key];
  if (!group || typeof group !== "object") {
    group = { firstSeen: Date.now(), total: 0, rows: {} };
    db.groups[key] = group;
    dirty = true;
  }
  if (!group.rows || typeof group.rows !== "object") group.rows = {};
  if (!group.firstSeen) group.firstSeen = Date.now();
  if (typeof group.total !== "number") group.total = 0;
  return group;
}

// pn and lid are digit strings (either may be empty). The row is keyed by the
// phone number when it is known so the history is stable across LID rotation.
export function bumpActivity(jid, pn, lid) {
  const group = groupDb(jid);
  if (!group || (!pn && !lid)) return;
  const key = pn || "~" + lid;
  const row = group.rows[key] || { pn: pn || "", lid: lid || "", count: 0, last: 0 };
  if (pn) row.pn = pn;
  if (lid) row.lid = lid;
  row.count += 1;
  row.last = Date.now();
  group.rows[key] = row;
  group.total += 1;
  dirty = true;
}

// All recorded rows for a group: [{ pn, lid, count, last }]
export function activityFor(jid) {
  const group = db.groups[String(jid || "")];
  if (!group || !group.rows) return [];
  return Object.values(group.rows).map(row => ({
    pn: String(row.pn || ""),
    lid: String(row.lid || ""),
    count: Number(row.count || 0),
    last: Number(row.last || 0)
  }));
}

// How long the bot has been watching a group and how many messages it saw —
// the honest basis for "who never talks" claims.
export function activityWindow(jid) {
  const group = db.groups[String(jid || "")];
  const firstSeen = Number(group?.firstSeen || Date.now());
  const total = Number(group?.total || 0);
  return { firstSeen, total, watchedMs: Date.now() - firstSeen };
}

// ---- recent group chat log (used by .tldr, .lore, .roast) ----
const MAX_LOG_PER_CHAT = 80;
const chatLog = new Map();

export function pushChatLog(jid, sender, text, name) {
  if (!jid || !jid.endsWith("@g.us")) return;
  const list = chatLog.get(jid) || [];
  list.push({ sender, text: String(text || "").slice(0, 300), name: String(name || "").slice(0, 40), at: Date.now() });
  if (list.length > MAX_LOG_PER_CHAT) list.splice(0, list.length - MAX_LOG_PER_CHAT);
  chatLog.set(jid, list);
}

export function recentChat(jid, count = 60) {
  const list = chatLog.get(jid) || [];
  return list.slice(-count);
}
