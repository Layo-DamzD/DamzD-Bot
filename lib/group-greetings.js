import path from "node:path";
import { createJsonStateStore } from "./state-store.js";

const dataDirectory = path.resolve(process.env.FEI_DATA_DIR || "./data");
const store = createJsonStateStore({
  filePath: path.join(dataDirectory, "group-greetings.json"),
  defaults: { chats: {} }
});

const DEFAULTS = Object.freeze({
  welcome: {
    enabled: false,
    message: "🎉 Welcome {user} to *{group}*! Make yourself at home. ✨"
  },
  goodbye: {
    enabled: false,
    message: "👋 {user} has left *{group}*. Wishing them all the best."
  }
});

export async function getGroupGreetingSettings(jid) {
  const state = await store.load();
  const current = state.chats?.[String(jid)] || {};
  return {
    welcome: { ...DEFAULTS.welcome, ...(current.welcome || {}) },
    goodbye: { ...DEFAULTS.goodbye, ...(current.goodbye || {}) }
  };
}

export async function setGroupGreetingSetting(jid, type, patch) {
  if (!["welcome", "goodbye"].includes(type)) {
    throw new Error("Unsupported group greeting type.");
  }
  await store.update(state => {
    if (!state.chats || typeof state.chats !== "object") state.chats = {};
    if (!state.chats[String(jid)]) state.chats[String(jid)] = {};
    const current = state.chats[String(jid)][type] || { ...DEFAULTS[type] };
    state.chats[String(jid)][type] = { ...current, ...patch };
  });
  return getGroupGreetingSettings(jid);
}
