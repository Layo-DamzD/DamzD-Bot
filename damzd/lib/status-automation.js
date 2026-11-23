import path from "node:path";
import { createJsonStateStore } from "./state-store.js";
import { messageText, normalizeJid } from "./message-utils.js";

const dataDirectory = path.resolve(process.env.FEI_DATA_DIR || "./data");
const DEFAULT_SETTINGS = Object.freeze({
  autoview: false,
  statusreact: false,
  statusreactmode: "random",
  statusreactkeys: []
});
const DEFAULT_EMOJIS = Object.freeze([
  "❤️", "🔥", "💯", "😍", "🥰", "👏", "😂", "🤩", "💙", "💜", "✨", "🙌"
]);
const MAX_REACTION_CACHE = 1000;
const reactedStatusKeys = new Set();
let previousEmoji = "";

export function createStatusAutomationStore({
  filePath = path.join(dataDirectory, "status-automation.json")
} = {}) {
  const store = createJsonStateStore({
    filePath,
    defaults: { settings: { ...DEFAULT_SETTINGS } }
  });

  async function getSettings() {
    const state = await store.load();
    return { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  }

  async function setSetting(key, value) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) {
      throw new Error("Unknown status automation setting: " + key);
    }
    if (key === "autoview" || key === "statusreact") {
      if (typeof value !== "boolean") throw new TypeError(key + " must be a boolean.");
    } else if (key === "statusreactmode") {
      const valid = value === "random" ||
        (Array.isArray(value) && value.length >= 1 && value.length <= 12 &&
          value.every(emoji => typeof emoji === "string" && emoji.length > 0 && [...emoji].length <= 8));
      if (!valid) throw new TypeError("Provide random or a list of 1–12 short emojis.");
    } else if (key === "statusreactkeys") {
      if (!Array.isArray(value) || value.length > 20 ||
          value.some(word => typeof word !== "string" || !word.trim() || word.length > 60)) {
        throw new TypeError("Provide up to 20 non-empty status keyword filters.");
      }
    }

    await store.update(state => {
      state.settings ||= { ...DEFAULT_SETTINGS };
      state.settings[key] = value;
    });
    return getSettings();
  }

  return { getSettings, setSetting, flush: () => store.flush() };
}

const store = createStatusAutomationStore();

export async function getStatusAutomationSettings() {
  return store.getSettings();
}

export async function setStatusAutomationSetting(key, value) {
  return store.setSetting(key, value);
}

export function getRandomStatusEmoji(pool = DEFAULT_EMOJIS, previous = previousEmoji) {
  const values = [...new Set((Array.isArray(pool) ? pool : []).filter(value =>
    typeof value === "string" && value.trim() && [...value].length <= 8
  ))];
  const candidates = values.length > 1 ? values.filter(value => value !== previous) : values;
  const choices = candidates.length ? candidates : values;
  if (!choices.length) return DEFAULT_EMOJIS[0];
  const selected = choices[Math.floor(Math.random() * choices.length)];
  previousEmoji = selected;
  return selected;
}

function statusCacheKey(key) {
  const author = normalizeJid(key?.participantPn || key?.participant || "");
  return author + ":" + String(key?.id || "");
}

function matchesStatusKeywords(text, keywords) {
  const list = Array.isArray(keywords) ? keywords.map(value => String(value).trim().toLowerCase()).filter(Boolean) : [];
  if (!list.length) return true;
  const value = String(text || "").toLowerCase();
  return list.some(keyword => value.includes(keyword));
}

async function resolvePhoneJid(sock, value) {
  const primary = normalizeJid(String(value || ""));
  if (primary.endsWith("@s.whatsapp.net")) return primary;
  const mapping = sock?.signalRepository?.lidMapping;
  if (primary.endsWith("@lid") && mapping && typeof mapping.getPNForLID === "function") {
    try {
      const resolved = normalizeJid(await mapping.getPNForLID(primary));
      if (resolved.endsWith("@s.whatsapp.net")) return resolved;
    } catch {}
  }
  return "";
}

export async function processIncomingStatus({ sock, msg, settings = DEFAULT_SETTINGS } = {}) {
  const key = msg?.key;
  const authors = [key?.participantPn, key?.participant].map(normalizeJid).filter(Boolean);
  const selfIds = [sock?.user?.id, sock?.user?.lid].map(normalizeJid).filter(Boolean);
  const isOwnStatus = Boolean(key?.fromMe) || authors.some(author => selfIds.includes(author));
  if (!key?.id || key.remoteJid !== "status@broadcast" || isOwnStatus) {
    return { viewed: false, reacted: false, skipped: true };
  }
  rememberSeenStatus({ sock, msg });

  let viewed = false;
  let reacted = false;

  if (settings.autoview && typeof sock?.readMessages === "function") {
    try {
      await sock.readMessages([key]);
      viewed = true;
    } catch (error) {
      console.warn("DamzD auto status view failed:", error?.message || error);
    }
  }

  if (!settings.statusreact) return { viewed, reacted, skipped: false };

  const cacheKey = statusCacheKey(key);
  if (!cacheKey || reactedStatusKeys.has(cacheKey)) return { viewed, reacted, skipped: true };

  const text = messageText(msg.message);
  if (!matchesStatusKeywords(text, settings.statusreactkeys)) {
    return { viewed, reacted, skipped: true };
  }

  const author = await resolvePhoneJid(sock, key.participantPn || key.participant);
  const bot = await resolvePhoneJid(sock, sock?.user?.id || sock?.user?.lid);
  const statusJidList = [...new Set([author, bot].filter(Boolean))];
  if (!author || !statusJidList.length || typeof sock?.sendMessage !== "function") {
    return { viewed, reacted, skipped: true };
  }

  const emojiPool = settings.statusreactmode === "random"
    ? DEFAULT_EMOJIS
    : Array.isArray(settings.statusreactmode) ? settings.statusreactmode : [String(settings.statusreactmode || "❤️")];
  const emoji = getRandomStatusEmoji(emojiPool);

  try {
    await sock.sendMessage("status@broadcast", {
      react: { text: emoji, key }
    }, { statusJidList });
    reactedStatusKeys.add(cacheKey);
    if (reactedStatusKeys.size > MAX_REACTION_CACHE) {
      reactedStatusKeys.delete(reactedStatusKeys.values().next().value);
    }
    reacted = true;
  } catch (error) {
    console.warn("DamzD auto status reaction failed:", error?.message || error);
  }

  return { viewed, reacted, skipped: false };
}

// Manual status reactions (.statusreact) and metadata (.statusinfo) work
// against a short memory of statuses this account actually saw. Memory is
// in-memory only and capped at 25 entries.
const MAX_SEEN_STATUSES = 25;
const seenStatuses = [];

export function rememberSeenStatus({ sock, msg }) {
  try {
    const key = msg?.key;
    if (!key?.id || key.remoteJid !== "status@broadcast") return false;
    const author = normalizeJid(key.participantPn || key.participant || "");
    const entry = {
      key: {
        remoteJid: "status@broadcast",
        id: String(key.id),
        fromMe: Boolean(key.fromMe),
        ...(author ? { participant: author } : {})
      },
      author,
      text: messageText(msg.message).slice(0, 200),
      kind: unwrapMessage(msg.message)?.imageMessage ? "image"
        : unwrapMessage(msg.message)?.videoMessage ? "video"
        : "text",
      at: Date.now()
    };
    seenStatuses.unshift(entry);
    if (seenStatuses.length > MAX_SEEN_STATUSES) seenStatuses.pop();
    return true;
  } catch {
    return false;
  }
}

export function getSeenStatuses(limit = 10) {
  return seenStatuses.slice(0, Math.max(1, limit));
}

// Resolve the status a manual command targets: an author filter, or the
// most recent status seen.
export function findSeenStatus(authorFilter = "") {
  const wanted = String(authorFilter || "").replace(/\D/g, "");
  if (wanted) {
    return seenStatuses.find(entry => entry.author.split("@")[0].includes(wanted)) ||
      seenStatuses.find(entry => entry.author.includes(wanted)) || null;
  }
  return seenStatuses[0] || null;
}

export async function reactToSeenStatus(sock, entry, emoji) {
  const author = await resolvePhoneJid(sock, entry.author);
  const bot = await resolvePhoneJid(sock, sock?.user?.id || sock?.user?.lid);
  const statusJidList = [...new Set([author, bot].filter(Boolean))];
  await sock.sendMessage("status@broadcast", {
    react: { text: emoji, key: entry.key }
  }, { statusJidList });
}

export { DEFAULT_EMOJIS, DEFAULT_SETTINGS };
