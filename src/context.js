import { numberFromJid } from "./utils.js";
import { isOwnerNumber } from "./config.js";

export function createContext({ sock, msg, config, store, memory }) {
  const key = msg.key;
  const jid = String(key.remoteJid || "");
  const isGroup = jid.endsWith("@g.us");
  const sender = key.participant
    ? String(key.participant)
    : key.fromMe
      ? String(sock?.user?.id || jid)
      : jid;
  const senderNumber = numberFromJid(sender);
  const ownNumber = numberFromJid(sock?.user?.id || "");
  const isOwner = isOwnerNumber(senderNumber) || (ownNumber && senderNumber === ownNumber) || Boolean(key.fromMe && !isGroup);

  let usedTyping = false;

  const ctx = {
    sock,
    msg,
    config,
    store,
    memory,
    jid,
    isGroup,
    sender,
    senderNumber,
    isOwner,
    key,
    fromMe: Boolean(key.fromMe),
    pushName: String(msg.pushName || "").slice(0, 60),

    async reply(text, extra = {}) {
      const payload = { text: String(text).slice(0, 4000), ...extra };
      return sock.sendMessage(jid, payload);
    },

    async send(content) {
      return sock.sendMessage(jid, content);
    },

    async typing(ms = 1200) {
      try {
        await sock.sendPresenceUpdate("composing", jid);
        usedTyping = true;
      } catch {
        /* presence is cosmetic */
      }
      await new Promise(resolve => setTimeout(resolve, ms));
    },

    async react(emoji) {
      try {
        await sock.sendMessage(jid, { react: { text: emoji, key } });
      } catch {
        /* reactions are cosmetic */
      }
    },

    async groupMetadataSafe() {
      if (!isGroup) return null;
      try {
        return await sock.groupMetadata(jid);
      } catch {
        return null;
      }
    },

    async isAdmin(numberToCheck) {
      const meta = await ctx.groupMetadataSafe();
      if (!meta) return false;
      const target = numberToCheck || senderNumber;
      return (meta.participants || []).some(participant =>
        numberFromJid(participant.id) === target &&
        ["admin", "superadmin"].includes(String(participant.admin || ""))
      );
    },

    async isBotAdmin() {
      const meta = await ctx.groupMetadataSafe();
      if (!meta) return false;
      return (meta.participants || []).some(participant =>
        numberFromJid(participant.id) === ownNumber &&
        ["admin", "superadmin"].includes(String(participant.admin || ""))
      );
    },

    async deleteMessage() {
      try {
        await sock.sendMessage(jid, { delete: key });
        return true;
      } catch {
        return false;
      }
    }
  };

  return ctx;
}
