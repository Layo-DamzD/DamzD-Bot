const digits = value => String(value || "").replace(/\D/g, "");

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
  version: String(process.env.BOT_VERSION || "2.0.0").trim() || "1.0.0",
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
  imageUrl: String(
    process.env.BOT_IMAGE_URL ||
    "https://res.cloudinary.com/dqqyvozdw/image/upload/v1792848652/arbeimjfqkkfpn9zvfhf.png"
  ).trim(),
  botUrl: String(process.env.BOT_URL || "").trim()
});
