// Background behaviours wired to socket events: activity tracking, anti-delete,
// anti-edit, auto status view, auto reactions, auto typing/recording and
// anti-call. Everything here respects the owner's toggles in the store.

import { downloadContentFromMessage } from "baileys";
import { messageText, numberFromJid, unwrapMessage } from "./utils.js";
import { lidToPhone } from "./lidmap.js";
import { cacheMessage, getCached, bumpActivity, pushChatLog } from "./cache.js";

function ownerChatOf(sock) {
  const number = numberFromJid(sock?.user?.id || "");
  return number ? number + "@s.whatsapp.net" : null;
}

// Re-download a cached message's media from WhatsApp's CDN, the same way .save
// recovers view-once. Returns { payload, caption, captionable } or null when
// the message carried no media (or the blob has already expired).
async function recoverDeletedMedia(node) {
  const inner = node ? unwrapMessage(node) : null;
  if (!inner) return null;
  async function pull(part, kind) {
    try {
      const stream = await downloadContentFromMessage(part, kind);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  if (inner.imageMessage) {
    const buffer = await pull(inner.imageMessage, "image");
    return buffer ? { payload: { image: buffer }, caption: inner.imageMessage.caption || "", captionable: true } : null;
  }
  if (inner.videoMessage) {
    const buffer = await pull(inner.videoMessage, "video");
    return buffer ? { payload: { video: buffer, mimetype: "video/mp4" }, caption: inner.videoMessage.caption || "", captionable: true } : null;
  }
  if (inner.audioMessage) {
    const buffer = await pull(inner.audioMessage, "audio");
    return buffer ? { payload: { audio: buffer, mimetype: inner.audioMessage.mimetype || "audio/mpeg", ptt: inner.audioMessage.ptt === true } } : null;
  }
  if (inner.stickerMessage) {
    const buffer = await pull(inner.stickerMessage, "sticker");
    return buffer ? { payload: { sticker: buffer } } : null;
  }
  return null;
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

// Silent bookkeeping only: safe to run even while the bot is paused, because
// it sends nothing — it just keeps the group statistics honest.
export async function recordActivity(sock, msg, jidArg) {
  const key = msg?.key;
  if (!key || !key.id) return;
  const jid = String(jidArg || key.remoteJid || "");
  if (!msg.message || jid === "status@broadcast") return;
  const text = messageText(msg.message);
  const sender = key.participant ? String(key.participant) : (key.fromMe ? String(sock?.user?.id || jid) : jid);
  // The raw node stays in the cache so a later delete can still recover the
  // media itself — anti-delete forwards photos, videos, voice notes and
  // stickers exactly like .save does for view-once, not just the caption.
  cacheMessage(key.id, { jid, sender, text, node: msg.message });

  // Record BOTH identity forms: in LID-mode groups key.participant is a
  // privacy LID, so the phone number is recovered through the library's
  // mapping store (cached, best-effort — the row still records the LID when
  // the mapping is unknown).
  let pn = "";
  let lid = "";
  try {
    if (key.participant && String(key.participant).endsWith("@lid")) {
      lid = numberFromJid(key.participant);
      pn = (await lidToPhone(sock, key.participant))?.number || "";
    } else if (key.participant) {
      pn = numberFromJid(key.participant);
    } else if (key.fromMe) {
      pn = numberFromJid(sock?.user?.id || "");
      lid = numberFromJid(sock?.user?.lid || "");
    } else {
      pn = numberFromJid(jid);
    }
  } catch {
    /* identity gaps are fine — the row just keeps whichever form is known */
  }
  if (pn || lid) bumpActivity(jid, pn, lid);
  // The chat log stores the phone JID when it is known, so .roast/.tldr can
  // match senders by real numbers even in LID-mode groups.
  if (text && jid.endsWith("@g.us") && !key.fromMe) {
    pushChatLog(jid, pn ? pn + "@s.whatsapp.net" : sender, text, msg.pushName);
  }
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
      if (original && !original.isStatus) {
        const who = original.sender ? "+" + numberFromJid(original.sender) : "someone";
        const where = original.jid === owner ? "your chat" : original.jid?.endsWith("@g.us") ? "a group chat" : "a private chat";
        const note = "🧹 " + who + " deleted a message in " + where + ":" +
          (original.text ? "\n\n" + String(original.text).slice(0, 600) : "");
        // Media comes back too: the cached node is re-downloaded from the CDN,
        // the same way .save recovers view-once. Nothing is ever sent back to
        // the chat the message came from — only the owner sees this.
        const media = await recoverDeletedMedia(original.node);
        if (media) {
          if (media.captionable) {
            sock.sendMessage(owner, { ...media.payload, caption: note + (media.caption ? "\n" + media.caption : "") }).catch(() => {});
          } else {
            sock.sendMessage(owner, media.payload).catch(() => {});
            sock.sendMessage(owner, { text: note }).catch(() => {});
          }
        } else if (original.text) {
          sock.sendMessage(owner, { text: note }).catch(() => {});
        }
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
  await recordActivity(sock, msg, jid);

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
