// DamzD triggers on the FEI runtime — the parts of the old DamzD behavior
// that run WITHOUT a prefix:
//   • any reaction with text on a remembered view-once recovers it silently
//     to the owner's own chat (the old 🔓 flow — no trace in the chat),
//   • bare words answer without the dot: the personal set (song, menu,
//     help, lyrics, onlineusers, ghost, top) and every group tool — the
//     whole message must be exactly the command word, so ordinary
//     sentences ("kick him please") never fire; the commands themselves
//     still enforce their own admin/owner checks.
// Everything here is a no-op when nothing matches, so normal chats are
// never disturbed.
import { findCachedViewOnce, readCachedMedia } from "./viewonce.js";

const DOTLESS_PERSONAL = new Set([
  "song", "menu", "help", "lyrics", "onlineusers", "ghost", "top"
]);

// Only these dotless commands make sense with trailing words — e.g.
// "song Blinding Lights". For any other command a bare multi-word message
// ("help me please") is just someone talking, not a trigger.
const DOTLESS_WITH_ARGS = new Set(["song", "lyrics"]);

// A bare word may run when it is in the personal set or is a group tool.
// Group tools only make sense in a group; in a DM they politely error.
function dotlessAllowed(name, definition) {
  return DOTLESS_PERSONAL.has(name) || definition?.category === "Group";
}

// The official Baileys retry download (father-repo proven): works from a
// stripped quote or an aged URL while the sender's phone is online. The
// original timestamp rides along — the media-retry IQ validates message age.
async function retryDownload(sock, key, message, messageTimestamp = 0) {
  try {
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
    const buffer = await downloadMediaMessage(
      {
        key: {
          remoteJid: String(key.remoteJid || ""),
          id: String(key.id || ""),
          fromMe: Boolean(key.fromMe),
          ...(key.participant ? { participant: String(key.participant) } : {})
        },
        message,
        ...(Number(messageTimestamp) > 0 ? { messageTimestamp: Number(messageTimestamp) } : {})
      },
      "buffer",
      {},
      { reuploadRequest: sock.updateMediaMessage }
    );
    return Buffer.isBuffer(buffer) && buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

// The media-retry protocol: returns a FRESH node (Baileys' updateMediaMessage
// returns the updated message — it does not mutate the input node).
async function refreshMediaLocation(sock, key, node) {
  try {
    const nodeKey = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"]
      .find(k => node?.[k]);
    if (!nodeKey || !key?.id || !node.mediaKey) return null;
    const updated = await sock.updateMediaMessage({
      key: {
        remoteJid: String(key.remoteJid || ""),
        id: String(key.id),
        fromMe: Boolean(key.fromMe),
        ...(key.participant ? { participant: String(key.participant) } : {})
      },
      message: { [nodeKey]: node }
    });
    const fresh = updated?.message?.[nodeKey] || updated?.[nodeKey];
    return (fresh?.url || fresh?.directPath) ? fresh : null;
  } catch {
    return null;
  }
}

async function downloadNode(sock, node, kind) {
  const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
  const stream = await downloadContentFromMessage(node, kind === "sticker" ? "sticker" : kind);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function recoverViewOnceBytes(sock, cached, key) {
  const captured = readCachedMedia(cached);
  if (captured) return captured;
  if (cached.node) {
    try {
      const buffer = await downloadNode(sock, cached.node, cached.kind);
      if (buffer.length) return buffer;
    } catch { /* the retry protocol is next */ }
    const fresh = await refreshMediaLocation(sock, key, cached.node);
    if (fresh) {
      try {
        const buffer = await downloadNode(sock, fresh, cached.kind);
        if (buffer.length) return buffer;
      } catch { /* official path is next */ }
    }
    const nodeKind = cached.kind === "sticker" ? "stickerMessage" : cached.kind + "Message";
    const official = await retryDownload(sock, key, { [nodeKind]: cached.node }, Number(cached.ts || 0));
    if (official) return official;
  }
  return null;
}

function originOf(jid) {
  return String(jid || "").endsWith("@g.us")
    ? "a group"
    : "+" + String(jid || "").split("@")[0].replace(/\D/g, "");
}

async function sendRecovered(sock, config, cached, buffer, origin) {
  const number = String(config?.ownerNumber || "").replace(/\D/g, "");
  if (!number) return;
  const target = number + "@s.whatsapp.net";
  const caption = "👀 Recovered view-once\nFrom: " + origin;
  if (cached.kind === "image") {
    await sock.sendMessage(target, { image: buffer, caption });
  } else if (cached.kind === "video") {
    await sock.sendMessage(target, { video: buffer, mimetype: cached.node?.mimetype || "video/mp4", caption });
  } else if (cached.kind === "audio") {
    await sock.sendMessage(target, { audio: buffer, mimetype: cached.node?.mimetype || "audio/mpeg", ptt: cached.node?.ptt === true });
    await sock.sendMessage(target, { text: "👀 Recovered voice note\nFrom: " + origin });
  } else {
    await sock.sendMessage(target, { sticker: buffer });
    await sock.sendMessage(target, { text: "👀 Recovered sticker\nFrom: " + origin });
  }
}

// A reaction with text on a remembered media message = an explicit recovery
// request. Silent no-op when the id matches nothing the bot saw.
async function handleUnlockReaction({ sock, jid, reaction, config }) {
  const target = reaction.key;
  if (!target?.id) return;
  const cached = findCachedViewOnce(target.remoteJid || jid, target.id) ||
    findCachedViewOnce("", target.id);
  if (!cached?.node) return;
  const key = {
    remoteJid: target.remoteJid || jid,
    id: target.id,
    fromMe: Boolean(target.fromMe),
    ...(cached.sender ? { participant: cached.sender } : {})
  };
  const buffer = await recoverViewOnceBytes(sock, cached, key);
  if (!buffer) return;
  await sendRecovered(sock, config, cached, buffer, originOf(target.remoteJid || jid));
}

export async function handleDamzDTriggers({ sock, msg, jid, text, lookup, config, runParsed }) {
  try {
    const reaction = msg?.message?.reactionMessage;
    if (reaction?.text?.trim() && reaction?.key?.id) {
      await handleUnlockReaction({ sock, jid, reaction, config });
      return true;
    }
    const raw = String(text || "").trim();
    if (raw && lookup instanceof Map) {
      // The FIRST word names the command; any remaining words are its args.
      const words = raw.split(/\s+/);
      const head = (words[0] || "").toLowerCase();
      const hasArgs = words.length > 1;
      if (lookup.has(head) && dotlessAllowed(head, lookup.get(head)) &&
          (!hasArgs || DOTLESS_WITH_ARGS.has(head))) {
        await runParsed({
          commandName: head,
          args: words.slice(1).join(" "),
          definition: lookup.get(head)
        });
        return true;
      }
    }
  } catch {
    /* triggers are conveniences — a failure must never break the runtime */
  }
  return false;
}
