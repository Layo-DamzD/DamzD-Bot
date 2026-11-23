const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "deviceSentMessage"
];

export function normalizeJid(value) {
  if (typeof value !== "string" || !value.includes("@")) return "";
  const [name, ...domain] = value.trim().toLowerCase().split("@");
  return name.split(":")[0] + "@" + domain.join("@");
}

export function numberFromJid(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

export function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth += 1) {
    const wrapper = WRAPPER_KEYS.find(key => current[key] && current[key].message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current || {};
}

export function messageText(message) {
  const value = unwrapMessage(message);
  return String(
    value.conversation ||
    value.extendedTextMessage?.text ||
    value.imageMessage?.caption ||
    value.videoMessage?.caption ||
    value.documentMessage?.caption ||
    value.buttonsResponseMessage?.selectedDisplayText ||
    value.listResponseMessage?.title ||
    value.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  ).trim();
}

export function getContextInfo(message) {
  const value = unwrapMessage(message);
  const keys = [
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
    "buttonsResponseMessage",
    "listResponseMessage",
    "templateButtonReplyMessage"
  ];
  for (const key of keys) {
    if (value[key]?.contextInfo) return value[key].contextInfo;
  }
  return null;
}

export function getMessageSender(msg, sock) {
  const key = msg?.key || {};
  if (key.participant) return normalizeJid(key.participant);
  if (key.fromMe) return normalizeJid(sock?.user?.id || sock?.user?.lid || key.remoteJid);
  return normalizeJid(key.remoteJid);
}
