// DamzD human mode — the engine behind .human. When enabled, plain DM
// chatter (no command prefix, nothing a trigger wanted) gets a short,
// natural, human-style reply: lowercase, casual, no branding, no lists,
// a believable typing pause before the send. The goal is that people
// chatting with this number cannot tell a bot is answering.
// Groups are deliberately excluded — uninvited "human" answers inside a
// group chat spook people more than they charm them.
import path from "node:path";
import { createJsonStateStore } from "../../lib/state-store.js";
import { askPuterFamily } from "../../lib/puter-ai.js";

const dataDirectory = path.resolve(process.env.FEI_DATA_DIR || "./data");
const store = createJsonStateStore({
  filePath: path.join(dataDirectory, "human-mode.json"),
  defaults: { enabled: false }
});

// The persona rules are strict on purpose: any formatting, emoji spam or
// AI-speak ("As an AI...") breaks the illusion instantly.
const HUMAN_SYSTEM = [
  "You are a real person texting on WhatsApp — the owner of this phone.",
  "Reply like a human friend, never like an assistant:",
  "1-2 short sentences at most, lowercase, casual grammar, contractions.",
  "No emojis unless the other person used one first. No lists, no markdown,",
  "no capital-letter shouting, no asterisk bold.",
  "Never say or hint that you are an AI, a bot, an assistant or a program,",
  "and never mention commands, features or menus.",
  "If someone asks a question, answer it naturally the way a friend would.",
  "If the message is just chat, chat back briefly.",
  "If you truly cannot help, say something a person would say (\"no idea sorry\")."
].join(" ");

const COOLDOWN_MS = 4000;          // never answer two messages in a burst
const MAX_INPUT_CHARS = 700;       // essays get ignored, humans skim
const MAX_REPLY_CHARS = 500;
const DAILY_CAP_PER_CHAT = 40;     // runaway-proofing for the AI quota

const lastReplyAt = new Map();
const dailyCount = new Map();
let dayKey = new Date().toISOString().slice(0, 10);

function underDailyCap(chat) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dailyCount.clear();
  }
  return (dailyCount.get(chat) || 0) < DAILY_CAP_PER_CHAT;
}

function bumpDailyCount(chat) {
  dailyCount.set(chat, (dailyCount.get(chat) || 0) + 1);
}

export async function isHumanModeEnabled() {
  try {
    return Boolean((await store.load()).enabled);
  } catch {
    return false;
  }
}

export async function setHumanMode(enabled) {
  await store.update(state => {
    state.enabled = Boolean(enabled);
  });
  return Boolean(enabled);
}

// The gate the runtime calls for every non-command text message. Returns
// true when a human-style reply was sent. The cooldown/cap claims happen
// BEFORE any await, so two rapid messages can never double-fire.
export async function maybeHumanReply({ sock, jid, text, msg }) {
  try {
    if (!sock || !jid || !text) return false;
    if (msg?.key?.fromMe) return false;              // never answer myself
    if (jid.endsWith("@g.us")) return false;         // groups stay bot-free
    if (jid.endsWith("@broadcast")) return false;
    const trimmed = String(text).trim();
    if (!trimmed || trimmed.length > MAX_INPUT_CHARS) return false;
    // A leading mark is a command for some bot — leave it alone.
    if ([".", "!", "/", "#", "?", "*"].includes(trimmed[0])) return false;

    if (!(await isHumanModeEnabled())) return false;
    const now = Date.now();
    if (now - (lastReplyAt.get(jid) || 0) < COOLDOWN_MS) return false;
    if (!underDailyCap(jid)) return false;
    lastReplyAt.set(jid, now);
    bumpDailyCount(jid);

    const { text: answer } = await askPuterFamily({
      prompt: trimmed,
      family: "gemini",
      system: HUMAN_SYSTEM
    });
    const reply = String(answer || "").trim().slice(0, MAX_REPLY_CHARS);
    if (!reply) return false;

    // The human pause: a person reads, thinks, then types.
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, 900 + reply.length * 12)));
    await sock.sendMessage(jid, { text: reply });
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    return true;
  } catch {
    return false; // human mode is cosmetic — never break message flow
  }
}
