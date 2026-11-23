// Per-chat presence automation (autotype / autorec) and the continuous
// online-presence flag. In-memory by design: a restart resets them.
const autoPresence = new Map(); // chatJid -> { typing: bool, recording: bool }
let publishOnline = false;

export function setAutoPresence(chatJid, kind, enabled) {
  const chat = String(chatJid || "");
  if (!chat.includes("@")) throw new Error("A valid WhatsApp chat is required.");
  if (!["typing", "recording"].includes(kind)) {
    throw new Error("Presence kind must be typing or recording.");
  }
  const state = autoPresence.get(chat) || { typing: false, recording: false };
  state[kind] = Boolean(enabled);
  if (!state.typing && !state.recording) autoPresence.delete(chat);
  else autoPresence.set(chat, state);
  return { ...state };
}

export function getAutoPresence(chatJid) {
  return { ...(autoPresence.get(String(chatJid || "")) || { typing: false, recording: false }) };
}

export function setPublishOnline(enabled) {
  publishOnline = Boolean(enabled);
  return publishOnline;
}

export function shouldPublishOnline() {
  return publishOnline;
}
