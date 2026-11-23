// Rolling per-group log of recent chat text. Feeds .tldr, .lore and .roast.
// In-memory only: nothing here is written to disk or sent anywhere.
const MAX_CHATS = 60;
const MAX_PER_CHAT = 60;
const ENTRY_TTL_MS = 3 * 60 * 60 * 1000; // three hours of context

const chats = new Map(); // chatJid -> [{ sender, text, at }]

function prune(chatJid, now) {
  const entries = chats.get(chatJid);
  if (!entries) return;
  while (entries.length && now - entries[0].at > ENTRY_TTL_MS) entries.shift();
  while (entries.length > MAX_PER_CHAT) entries.shift();
}

function pruneChats(now) {
  while (chats.size > MAX_CHATS) {
    const oldest = chats.keys().next().value;
    chats.delete(oldest);
  }
}

export function recordChatMessage(chatJid, senderNumber, text, at = Date.now()) {
  const chat = String(chatJid || "");
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!chat.endsWith("@g.us") || !body || body.length < 2) return false;
  if (!chats.has(chat)) chats.set(chat, []);
  chats.get(chat).push({
    sender: String(senderNumber || "").replace(/\D/g, "").slice(-15),
    text: body.slice(0, 400),
    at
  });
  prune(chat, at);
  pruneChats(at);
  return true;
}

export function recentChatMessages(chatJid, limit = 40) {
  const entries = chats.get(String(chatJid || ""));
  if (!entries) return [];
  prune(String(chatJid), Date.now());
  return entries.slice(-Math.max(1, limit));
}

export function chatLogSize(chatJid) {
  return (chats.get(String(chatJid || "")) || []).length;
}

export function clearChatLog(chatJid) {
  chats.delete(String(chatJid || ""));
}
