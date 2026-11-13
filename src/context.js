import { numberFromJid } from "./utils.js";
import { isOwnerNumber } from "./config.js";

export function createContext({ sock, msg, config, store, memory, sessions = null }) {
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
  // WhatsApp increasingly identifies people (including group senders) by a
  // privacy LID instead of the phone number — the owner must be recognized in
  // both forms or the bot goes quiet in groups. The bot itself runs as a
  // linked device on the owner's account, so everything the account sends is
  // the owner speaking, in DMs and groups alike.
  const ownLid = numberFromJid(sock?.user?.lid || "");
  const isOwner = Boolean(key.fromMe) ||
    isOwnerNumber(senderNumber) ||
    (ownNumber && senderNumber === ownNumber) ||
    (ownLid && senderNumber === ownLid);

  let usedTyping = false;

  const ctx = {
    sock,
    msg,
    config,
    store,
    memory,
    sessions, // the multi-connect manager (main bot only) — lets .ban stop a connected friend's whole bot
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
