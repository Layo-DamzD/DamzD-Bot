const digits = value => String(value || "").replace(/\D/g, "");

// The deployed package.json IS the running release — read the version from
// it directly (single source of truth) so the connect card and menu never
// show a stale BOT_VERSION from an env var nobody synced.
import { readFileSync } from "node:fs";
let packageVersion = "";
try {
  packageVersion = String(
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version || ""
  );
} catch { /* fall back to BOT_VERSION, then the historic default */ }

const configuredOwnerNumber = digits(process.env.OWNER_NUMBER);
const ownerNumber = configuredOwnerNumber || "2348000000000";
const configuredPrefix = process.env.PREFIX;
const prefix = configuredPrefix === undefined || configuredPrefix === "" ? "." : String(configuredPrefix);

const channel = Object.freeze({
  name: "ᴅᴀᴍᴢᴅ",
  jid: ""
});

export default Object.freeze({
  name: String(process.env.BOT_NAME || "DamzD").trim() || "DamzD",
  version: packageVersion || String(process.env.BOT_VERSION || "2.1.0").trim() || "1.0.0",
  prefix,
  ownerName: String(process.env.OWNER_NAME || "DamzD").trim() || "DamzD",
  ownerNumber,
  ownerNumbers: Object.freeze([ownerNumber]),
  defaultMode: String(process.env.BOT_MODE || "public").toLowerCase() === "private" ? "private" : "public",
  sessionDirectory: String(process.env.FEI_SESSION_DIR || "./auth_info_baileys").trim() || "./auth_info_baileys",
  dataDirectory: String(process.env.FEI_DATA_DIR || "./data").trim() || "./data",
  logLevel: String(process.env.LOG_LEVEL || "info").trim().toLowerCase(),
  browser: "Chrome",
  channel,
  botImage: String(process.env.BOT_IMAGE || "assets/bot-image.jpg").trim(),
  botUrl: String(process.env.BOT_URL || "").trim()
});
