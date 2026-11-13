import "dotenv/config";

const digits = value => String(value || "").replace(/\D/g, "");

function parseList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map(item => digits(item))
    .filter(Boolean);
}

const ownerNumbers = parseList(process.env.OWNER_NUMBER);

// Numbers adopted at runtime (e.g. the number that paired first when
// OWNER_NUMBER was not configured in .env).
const runtimeOwners = [];

export function addRuntimeOwner(number) {
  const digitsOnly = String(number || "").replace(/\D/g, "");
  if (digitsOnly && !ownerNumbers.includes(digitsOnly) && !runtimeOwners.includes(digitsOnly)) {
    runtimeOwners.push(digitsOnly);
  }
}

// Access mode lives in a plain mutable binding: the .mode / .public /
// .private owner commands flip it at runtime through setAccessMode(). It used
// to sit frozen inside the config object and every attempt to redefine it
// threw "Cannot redefine property" — the commands looked like they worked but
// always answered with an error.
let accessMode = String(process.env.ACCESS_MODE || "self").trim().toLowerCase() === "public"
  ? "public"
  : "self";

export function setAccessMode(mode) {
  accessMode = mode === "public" ? "public" : "self";
  process.env.ACCESS_MODE = accessMode;
  return accessMode;
}

// DAMZD_CHILD=1 marks a friend's connected session (spawned by the session
// manager). The AI split: children run on Groq only, so five friend bots can
// never burn the owner's quotas; the main bot's chat brain is Puter.
export const childMode = process.env.DAMZD_CHILD === "1";

// The owner's Puter accounts (comma-separated tokens). Empty on children by
// design — they never touch Puter.
export const puterTokens = childMode ? [] : [...new Set(
  String(process.env.PUTER_AUTH_TOKEN || "")
    .split(",")
    .map(token => token.trim())
    .filter(Boolean)
)];

export const config = Object.freeze({
  name: String(process.env.BOT_NAME || "DamzD").trim() || "DamzD",
  ownerName: String(process.env.OWNER_NAME || "Boss").trim() || "Boss",
  ownerNumbers: Object.freeze(ownerNumbers),
  get accessMode() { return accessMode; },
  prefix: String(process.env.PREFIX || ".").slice(0, 3) || ".",
  sessionDirectory: String(process.env.SESSION_DIR || "./auth").trim() || "./auth",
  dataDirectory: String(process.env.DATA_DIR || "./data").trim() || "./data",
  logLevel: String(process.env.LOG_LEVEL || "warn").trim().toLowerCase() || "warn",
  port: Number(process.env.PORT || 3000) || 3000,
  autoDownloadLinks: String(process.env.AUTO_DL || "true").trim().toLowerCase() !== "false",
  // Groq exists for the child bots only — the main bot's config carries an
  // empty key so nothing on the main bot can call Groq for chat, whatever the
  // environment says. (Groq Whisper for .vn2text reads the key directly and
  // stays available everywhere — there is no free alternative to it.)
  groq: childMode
    ? {
        apiKey: String(process.env.GROQ_API_KEY || "").trim(),
        model: String(process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim() || "llama-3.3-70b-versatile",
        url: "https://api.groq.com/openai/v1/chat/completions"
      }
    : { apiKey: "", model: "", url: "" },
  openrouter: {
    apiKey: String(process.env.OPENROUTER_API_KEY || "").trim(),
    model: String(process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free").trim()
      || "meta-llama/llama-3.3-70b-instruct:free",
    url: "https://openrouter.ai/api/v1/chat/completions"
  },
  get puterTokens() { return puterTokens; },
  get childMode() { return childMode; }
});

export function hasAIBrain() {
  return childMode
    ? Boolean(config.groq.apiKey)
    : puterTokens.length > 0 || Boolean(config.openrouter.apiKey);
}

export function isOwnerNumber(value) {
  const number = digits(value);
  if (!number) return false;
  return ownerNumbers.includes(number) || runtimeOwners.includes(number);
}

export function ownerDisplayNumber() {
  return ownerNumbers[0] || runtimeOwners[0] || "";
}
