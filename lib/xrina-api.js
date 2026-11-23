import { Buffer } from "node:buffer";
import { extractImageUrls, validateHttpsUrl } from "./api-client.js";

const API_ROOT = "https://apiii-xrina.my.id/";
const TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function buildUrl(route, params = {}) {
  const path = String(route || "").replace(/^\/+/, "");
  if (!/^(?:canvas|download)\/[a-z0-9-]+$/i.test(path)) {
    throw new Error("Unsupported Xrina API route.");
  }

  const url = new URL(path, API_ROOT);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function failureMessage(payload, fallback) {
  const nested = payload && payload.data && payload.data.data
    ? payload.data.data
    : payload && payload.data;
  const failed = payload && (
    payload.status === false ||
    payload.success === false ||
    payload.error === true ||
    nested && (nested.status === false || nested.success === false || nested.error === true)
  );
  if (!failed) return "";
  const message = payload.errorMessage || payload.message || payload.error ||
    nested && (nested.message || nested.error);
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 220)
    : fallback;
}

async function fetchResponse(url, accept) {
  try {
    return await fetch(url, {
      headers: {
        accept,
        "user-agent": "FEI-XMD/1.0 (+https://github.com/Benfeitech/FEI-XMD)"
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow"
    });
  } catch (error) {
    if (error && error.name === "TimeoutError") {
      throw new Error("The Xrina API request timed out. Please try again.");
    }
    throw new Error("Could not reach the Xrina API. Please try again later.");
  }
}

export async function requestXrinaJson(route, params = {}) {
  const response = await fetchResponse(buildUrl(route, params), "application/json");
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The Xrina API returned unreadable data.");
  }

  if (!response.ok) {
    const message = failureMessage(payload, "");
    throw new Error(message || "The Xrina API returned HTTP " + response.status + ".");
  }
  const failure = failureMessage(payload, "The Xrina API could not complete the request.");
  if (failure) throw new Error(failure);
  return payload;
}

export async function requestXrinaImage(route, params = {}) {
  const response = await fetchResponse(buildUrl(route, params), "image/*, application/json");
  if (!response.ok) {
    let message = "The image request failed with HTTP " + response.status + ".";
    try {
      const payload = await response.json();
      message = failureMessage(payload, message) || message;
    } catch {}
    throw new Error(message);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("image/")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("The generated image is empty or larger than 12 MB.");
    }
    return bytes;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The image API returned neither an image nor readable JSON.");
  }

  const failure = failureMessage(payload, "The image request could not be completed.");
  if (failure) throw new Error(failure);

  const candidates = extractImageUrls(payload);
  let imageUrl = "";
  for (const candidate of candidates) {
    try {
      imageUrl = validateHttpsUrl(candidate, "canvas image");
      break;
    } catch {}
  }
  if (!imageUrl) throw new Error("The canvas API did not return a safe HTTPS image.");
  return { url: imageUrl };
}

export function validateDownloadUrl(value, label = "media") {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("The service did not return a valid " + label + " URL.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("The service returned an unsupported " + label + " URL.");
  }
  return parsed.toString();
}
