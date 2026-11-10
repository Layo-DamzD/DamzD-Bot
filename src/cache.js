// Shared in-memory caches: message history for anti-delete / view-once
// recovery, plus lightweight activity tracking for group commands.

const MAX_MESSAGES = 600;
const messages = new Map();

export function cacheMessage(key, record) {
  const id = String(key || "");
  if (!id) return;
  messages.set(id, { ...record, at: Date.now() });
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

// ---- group activity (used by .top, .ghost, .onlineusers) ----
const activity = new Map();

function activityKey(jid, sender) {
  return jid + "|" + sender;
}

export function bumpActivity(jid, sender) {
  if (!jid || !sender) return;
  const key = activityKey(jid, sender);
  const current = activity.get(key) || { count: 0, last: 0 };
  current.count += 1;
  current.last = Date.now();
  activity.set(key, current);
  if (activity.size > 2000) {
    for (const [k, value] of activity) {
      if (Date.now() - value.last > 86400000) activity.delete(k);
    }
  }
}

export function activityFor(jid) {
  const rows = [];
  for (const [key, value] of activity) {
    if (key.startsWith(jid + "|")) {
      rows.push({ sender: key.split("|")[1], count: value.count, last: value.last });
    }
  }
  return rows;
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
