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
  const [name, ...rest] = value.trim().toLowerCase().split("@");
  return name.split(":")[0] + "@" + rest.join("@");
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
    "stickerMessage"
  ];
  for (const key of keys) {
    if (value[key]?.contextInfo) return value[key].contextInfo;
  }
  return null;
}

export function mentionedJids(message) {
  const info = getContextInfo(message);
  return (info?.mentionedJid || []).map(jid => normalizeJid(jid)).filter(Boolean);
}

export function quotedParticipant(message) {
  const info = getContextInfo(message);
  return normalizeJid(info?.participant || "");
}

export function quotedText(message) {
  const info = getContextInfo(message);
  const quoted = info?.quotedMessage;
  if (!quoted) return "";
  return messageText(quoted);
}

export function getMessageSender(msg, sock) {
  const key = msg?.key || {};
  if (key.participant) return normalizeJid(key.participant);
  if (key.fromMe) return normalizeJid(sock?.user?.id || sock?.user?.lid || key.remoteJid);
  return normalizeJid(key.remoteJid);
}

export async function fetchJson(url, { timeoutMs = 60000, label = "service", headers } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DamzD-Bot/1.1 (personal WhatsApp assistant)",
        ...(headers || {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long to respond. Try again in a moment.");
    }
    throw new Error("Could not reach the " + label + ". Please try again later.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The " + label + " returned something I could not read.");
  }
  if (!response.ok || payload?.success === false || payload?.status === false || payload?.error) {
    const detail = payload?.error?.message || payload?.error || payload?.message;
    throw new Error(typeof detail === "string" && detail.trim()
      ? detail.trim().slice(0, 200)
      : "The " + label + " could not handle that request.");
  }
  return payload;
}

export function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomInt(max) {
  return Math.floor(Math.random() * max);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
