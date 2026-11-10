// Background behaviours wired to socket events: activity tracking, anti-delete,
// anti-edit, auto status view, auto reactions, auto typing/recording and
// anti-call. Everything here respects the owner's toggles in the store.

import { messageText, numberFromJid } from "./utils.js";
import { cacheMessage, getCached, bumpActivity, pushChatLog } from "./cache.js";

function ownerChatOf(sock) {
  const number = numberFromJid(sock?.user?.id || "");
  return number ? number + "@s.whatsapp.net" : null;
}

export function registerCallHook(sock, store) {
  sock.ev.on("call", async calls => {
    if (!store.get("anticallOn", false)) return;
    const call = Array.isArray(calls) ? calls[0] : null;
    if (!call?.id || !call?.from) return;
    try {
      await sock.rejectCall(call.id, call.from);
    } catch {
      /* rejection is best-effort */
    }
    const owner = ownerChatOf(sock);
    if (owner) {
      const who = "+" + numberFromJid(call.from);
      sock.sendMessage(owner, { text: "📵 I declined a call from " + who + " (anti-call is on)." }).catch(() => {});
    }
  });
}

export async function runSideEffects(sock, deps, msg) {
  const key = msg?.key;
  if (!key || !key.id) return;
  const jid = String(key.remoteJid || "");
  const store = deps.store;

  // ---- protocol messages: deletions and edits ----
  const proto = msg.message?.protocolMessage;
  if (proto) {
    const owner = ownerChatOf(sock);
    if (proto.type === 0 && proto.key?.id && owner && store.get("antidelOn", false)) {
      const original = getCached(proto.key.id);
      if (original && !original.isStatus && original.text) {
        const who = original.sender ? "+" + numberFromJid(original.sender) : "someone";
        const where = original.jid === owner ? "your chat" : original.jid?.endsWith("@g.us") ? "a group chat" : "a private chat";
        sock.sendMessage(owner, {
          text: "🧹 " + who + " deleted a message in " + where + ":\n\n" + String(original.text).slice(0, 600)
        }).catch(() => {});
      }
    }
    if (proto.editedMessage && owner && store.get("antieditOn", false)) {
      const original = getCached(key.id);
      const editedText = messageText(proto.editedMessage);
      if (original && editedText && !original.isStatus) {
        const who = original.sender ? "+" + numberFromJid(original.sender) : "someone";
        sock.sendMessage(owner, {
          text: "✏️ " + who + " edited a message.\n\nBefore: " + String(original.text || "(media)").slice(0, 300) +
            "\nAfter: " + editedText.slice(0, 300)
        }).catch(() => {});
      }
    }
    return;
  }

  // ---- status broadcasts ----
  if (jid === "status@broadcast") {
    if (key.fromMe) return;
    cacheMessage(key.id, {
      jid,
      sender: key.participant,
      text: messageText(msg.message),
      isStatus: true
    });
    if (store.get("autostatusOn", false)) {
      try { await sock.readMessages([key]); } catch { /* cosmetic */ }
      if (store.get("statusreactOn", false)) {
        const keys = store.get("statusreactKeys", []);
        const text = messageText(msg.message).toLowerCase();
        const emoji = store.get("statusreactEmoji", "💚");
        if (!keys.length || keys.some(word => text.includes(String(word).toLowerCase()))) {
          sock.sendMessage("status@broadcast", { react: { key, text: emoji } }).catch(() => {});
        }
      }
    }
    return;
  }

  if (!msg.message) return;

  // ---- cache + activity + chat log ----
  const text = messageText(msg.message);
  const sender = key.participant ? String(key.participant) : (key.fromMe ? String(sock?.user?.id || jid) : jid);
  cacheMessage(key.id, { jid, sender, text });
  const senderNumber = numberFromJid(sender);
  if (senderNumber) bumpActivity(jid, senderNumber);
  if (text && jid.endsWith("@g.us") && !key.fromMe) {
    pushChatLog(jid, sender, text, msg.pushName);
  }

  // ---- auto typing / recording indicators ----
  if (store.get("autotype:" + jid, false)) {
    sock.sendPresenceUpdate("composing", jid).catch(() => {});
  } else if (store.get("autorec:" + jid, false)) {
    sock.sendPresenceUpdate("recording", jid).catch(() => {});
  }

  // ---- auto reactions ----
  const reactCfg = store.get("autoreact:" + jid, null);
  if (reactCfg?.on && text) {
    const keys = reactCfg.keys || [];
    if (!keys.length || keys.some(word => text.toLowerCase().includes(String(word).toLowerCase()))) {
      sock.sendMessage(jid, { react: { key, text: reactCfg.emoji || "✨" } }).catch(() => {});
    }
  }
}
