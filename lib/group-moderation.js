import path from "node:path";
import { createJsonStateStore } from "./state-store.js";
import { isOwnerNumber } from "./owner-utils.js";
import { normalizeJid, numberFromJid } from "./message-utils.js";

const dataDirectory = path.resolve(process.env.FEI_DATA_DIR || "./data");
const defaultSettings = Object.freeze({ antilink: false, warnlinks: false });

export function createGroupModerationStore({ filePath = path.join(dataDirectory, "group-moderation.json") } = {}) {
  const store = createJsonStateStore({
    filePath,
    defaults: { groups: {}, warnings: {} }
  });

  async function getSettings(groupJid) {
    const state = await store.load();
    return { ...defaultSettings, ...(state.groups?.[String(groupJid)] || {}) };
  }

  async function setSetting(groupJid, key, enabled) {
    if (!["antilink", "warnlinks"].includes(key)) throw new Error("Unsupported group moderation setting.");
    const jid = String(groupJid || "");
    if (!jid.endsWith("@g.us")) throw new Error("A WhatsApp group JID is required.");
    await store.update(state => {
      state.groups ||= {};
      state.groups[jid] ||= {};
      state.groups[jid][key] = Boolean(enabled);
    });
    return getSettings(jid);
  }

  async function addWarning(groupJid, userJid) {
    const group = String(groupJid || "");
    const user = normalizeJid(userJid);
    if (!group.endsWith("@g.us") || !user) throw new Error("A valid group and member JID are required.");
    return store.update(state => {
      state.warnings ||= {};
      state.warnings[group] ||= {};
      const previous = state.warnings[group][user] || {};
      const count = Math.min(100, Math.max(0, Number(previous.count) || 0) + 1);
      state.warnings[group][user] = { count, updatedAt: Date.now() };
      return count;
    });
  }

  async function listWarnings(groupJid) {
    const state = await store.load();
    return Object.entries(state.warnings?.[String(groupJid)] || {})
      .map(([jid, value]) => ({ jid, count: Math.max(0, Number(value?.count) || 0), updatedAt: Number(value?.updatedAt) || 0 }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt);
  }

  return { getSettings, setSetting, addWarning, listWarnings, flush: () => store.flush() };
}

const moderationStore = createGroupModerationStore();

function participantJids(participant) {
  return [
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
    participant?.pn,
    participant?.phoneNumberJid
  ].map(normalizeJid).filter(Boolean);
}

function isAdmin(participant) {
  return Boolean(participant && (
    participant.admin === "admin" ||
    participant.admin === "superadmin" ||
    participant.isAdmin
  ));
}

function containsLink(text) {
  return /(?:chat\.whatsapp\.com\/[a-z0-9_-]+|https?:\/\/\S+|www\.\S+)/i.test(String(text || ""));
}

export async function handleGroupLinkMessage({ sock, msg, text, config, moderation = moderationStore } = {}) {
  const jid = String(msg?.key?.remoteJid || "");
  if (!jid.endsWith("@g.us") || msg?.key?.fromMe || !containsLink(text)) return false;

  const settings = await moderation.getSettings(jid);
  if (!settings.antilink && !settings.warnlinks) return false;

  let metadata;
  try {
    metadata = await sock.groupMetadata(jid);
  } catch (error) {
    console.warn("Could not load group metadata for link moderation:", error?.message || error);
    return false;
  }

  const sender = normalizeJid(msg.key.participantPn || msg.key.participant || "");
  if (!sender) return false;
  const senderNumber = numberFromJid(msg.key.participantPn || sender);
  const senderIds = new Set([
    msg.key.participant,
    msg.key.participantPn,
    sender
  ].map(normalizeJid).filter(Boolean));
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const senderEntry = participants.find(item =>
    participantJids(item).some(candidate => senderIds.has(candidate))
  );

  if (isAdmin(senderEntry) || isOwnerNumber(config || {}, senderNumber) || isOwnerNumber(config || {}, sender)) {
    return false;
  }

  const selfIds = new Set([sock.user?.id, sock.user?.lid].map(normalizeJid).filter(Boolean));
  const botEntry = participants.find(item =>
    participantJids(item).some(candidate => selfIds.has(candidate))
  );

  let deleted = false;
  try {
    await sock.sendMessage(jid, { delete: msg.key });
    deleted = true;
  } catch (error) {
    console.warn("Could not delete a prohibited group link:", error?.message || error);
  }

  if (!settings.warnlinks) {
    if (deleted) {
      await sock.sendMessage(jid, {
        text: "🔗 @" + senderNumber + ", links are disabled in this group.",
        mentions: [sender]
      }).catch(() => {});
    }
    return true;
  }

  const count = await moderation.addWarning(jid, sender);
  let removal = "";
  if (count === 3) {
    if (!isAdmin(botEntry)) {
      removal = " FEI XMD is not a group admin, so removal was not attempted.";
    } else {
      try {
        await sock.groupParticipantsUpdate(jid, [sender], "remove");
        removal = " The third-warning removal request was sent.";
      } catch (error) {
        removal = " Removal failed: " + String(error?.message || error).slice(0, 120);
      }
    }
  }

  let notice = "🔗 @" + senderNumber + ", links are not allowed in this group. Warning: *" + count + "/3*.";
  if (!deleted) notice += " I could not delete the link; please check FEI XMD's admin permissions.";
  if (count === 3) notice += "\n⛔ Third warning reached." + removal;
  else if (count > 3) notice += "\n⚠️ The three-warning threshold has already been reached.";
  else notice += "\nOne more violation at warning 3 may result in a removal request.";
  await sock.sendMessage(jid, { text: notice, mentions: [sender] }).catch(() => {});
  return true;
}

export const groupModeration = moderationStore;
