import { Buffer } from "node:buffer";

const API_ROOT = "https://api-rebix.vercel.app/api";
const EXTERNAL_HOSTS = new Set([
  "eliteprotech-apis.zone.id",
  "api.omegatech.app",
  "apis.nabeestech.com",
  "api.ikyyxd.my.id"
]);

export const POWERED_FOOTER = "✦ *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ*";

function appendParams(url, params) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function readJsonResponse(response, label) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(label + " returned an unreadable response.");
  }
  if (!response.ok || payload?.status === false || payload?.success === false || payload?.error) {
    const detail = payload?.error?.message || payload?.error || payload?.message;
    throw new Error(typeof detail === "string" ? detail.slice(0, 220) : label + " request failed.");
  }
  return payload;
}

async function fetchJson(url, timeoutMs, label) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(5000, Number(timeoutMs) || 45000))
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long. Please try again.");
    }
    throw new Error("Could not reach " + label + ". Please try again later.");
  }
  return readJsonResponse(response, label);
}

export async function requestApiJson(endpoint, params = {}, timeoutMs = 45000) {
  const path = String(endpoint || "").replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("://")) {
    throw new Error("Invalid FEI API endpoint.");
  }
  const url = appendParams(new URL(API_ROOT + "/" + path), params);
  return fetchJson(url, timeoutMs, "FEI API");
}

export async function requestExternalJson(endpoint, params = {}, timeoutMs = 45000) {
  let url;
  try {
    url = new URL(String(endpoint || ""));
  } catch {
    throw new Error("The external API endpoint is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      !EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Unsupported external API endpoint.");
  }
  return fetchJson(appendParams(url, params), timeoutMs, "external AI service");
}

export function extractApiText(payload) {
  const candidates = [
    payload?.response,
    payload?.text,
    payload?.answer,
    payload?.reply,
    payload?.message,
    payload?.result,
    payload?.data?.response,
    payload?.data?.text,
    payload?.data?.answer,
    payload?.data?.reply,
    payload?.data?.result
  ];
  const result = candidates.find(value => typeof value === "string" && value.trim());
  if (!result) throw new Error("The service did not return a text response.");
  return result.trim();
}

export function extractImageUrls(payload) {
  const urls = [];
  function visit(value, depth = 0) {
    if (value == null || depth > 7) return;
    if (typeof value === "string") {
      const candidate = value.trim();
      if (/^https:\/\//i.test(candidate) && !urls.includes(candidate)) urls.push(candidate);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).sort((a, b) => {
        const priority = key => /image|photo|picture|url|src|link|result|data/i.test(key) ? 0 : 1;
        return priority(a) - priority(b);
      });
      for (const key of keys) visit(value[key], depth + 1);
    }
  }
  visit(payload);
  return urls;
}

export function unicodeBox(title, body, options = {}) {
  const lines = String(body || "").trim().split(/\r?\n/);
  const framed = lines.map(line => line ? "┃ ✧ " + line : "┃");
  const result = [
    "╭━━〔 " + String(title || "DamzD") + " 〕━━┈⊷",
    "┃",
    ...framed,
    "┃",
    "╰━━━━━━━━━━━━┈⊷"
  ];
  if (options.footer) result.push("", POWERED_FOOTER);
  return result.join("\n");
}

export function withPoweredFooter(value, maxLength = 3800) {
  const footer = POWERED_FOOTER;
  const text = String(value || "").trim();
  const available = Math.max(0, maxLength - footer.length - 2);
  const body = text.length > available
    ? text.slice(0, Math.max(0, available - 1)) + "…"
    : text;
  return body ? body + "\n\n" + footer : footer;
}

export function normalizeImageBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  throw new TypeError("An image buffer is required.");
}


export function validateHttpsUrl(value, serviceLabel = "download") {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Provide a valid public HTTPS " + serviceLabel + " URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("The service returned an unsupported " + serviceLabel + " URL.");
  }
  const safe = validateHttpUrl(parsed.toString(), serviceLabel);
  return safe;
}

export function validateHttpUrl(value, serviceLabel = "website") {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Provide a valid " + serviceLabel + " URL.");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host === "0.0.0.0" || host === "::1" || host === "::" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!["http:", "https:"].includes(parsed.protocol) || privateHost ||
      parsed.username || parsed.password) {
    throw new Error("Provide a public HTTP or HTTPS " + serviceLabel + " URL.");
  }
  return parsed.toString();
}

export function safeFileName(value, fallback = "FEI-XMD-download") {
  const name = String(value || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return name || fallback;
}
