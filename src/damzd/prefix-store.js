// Runtime command-prefix override, persisted so it survives restarts.
// The dashboard and pairing flow keep using config.prefix as the default.
import path from "node:path";
import { createJsonStateStore } from "../../lib/state-store.js";

const dataDirectory = path.resolve(process.env.FEI_DATA_DIR || "./data");
const store = createJsonStateStore({
  filePath: path.join(dataDirectory, "prefix-settings.json"),
  defaults: { prefix: "" }
});

export function isValidPrefix(value) {
  const candidate = String(value || "").trim();
  return candidate.length >= 1 && candidate.length <= 3 && !/\s/.test(candidate);
}

export async function getActivePrefix(config = {}) {
  const fallback = String(config.prefix || ".");
  try {
    const state = await store.load();
    return state.prefix || fallback;
  } catch {
    return fallback;
  }
}

export async function setActivePrefix(value) {
  const candidate = String(value || "").trim();
  if (!isValidPrefix(candidate)) {
    throw new Error("Use one short command mark (1–3 characters, no spaces), e.g. . ! #");
  }
  await store.update(state => {
    state.prefix = candidate;
  });
  return candidate;
}

export async function resetActivePrefix(config = {}) {
  await store.update(state => {
    state.prefix = "";
  });
  return String(config.prefix || ".");
}
