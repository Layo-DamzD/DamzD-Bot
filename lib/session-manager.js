import path from "node:path";
import { createWhatsAppRuntime } from "./whatsapp-runtime.js";

function normalizeSessionId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Session ID must contain 1–64 letters, numbers, underscores or hyphens.");
  }
  return id;
}

export function createSessionManager({
  config,
  theme,
  commands = [],
  lookup = new Map(),
  dataDirectory = config?.dataDirectory || "./data",
  maxSessions = 0,
  runtimeFactory = createWhatsAppRuntime
} = {}) {
  if (!config) throw new TypeError("Bot configuration is required.");

  const sessions = new Map();
  const root = path.resolve(String(dataDirectory));

  async function createSession(sessionId, options = {}) {
    const id = normalizeSessionId(sessionId);
    if (sessions.has(id)) return sessions.get(id);
    if (Number(maxSessions) > 0 && sessions.size >= Number(maxSessions)) {
      throw new Error("The configured session limit has been reached.");
    }

    const sessionDirectory = path.resolve(
      options.sessionDirectory || path.join(root, "sessions", id, "auth_info_baileys")
    );
    const runtime = runtimeFactory({
      config,
      theme,
      commands,
      lookup,
      sessionDirectory,
      sessionId: id
    });
    sessions.set(id, runtime);

    try {
      await runtime.start();
      return runtime;
    } catch (error) {
      sessions.delete(id);
      await runtime.stop().catch(() => {});
      throw error;
    }
  }

  async function stopSession(sessionId) {
    const id = normalizeSessionId(sessionId);
    const runtime = sessions.get(id);
    if (!runtime) return false;
    sessions.delete(id);
    await runtime.stop();
    return true;
  }

  async function stop() {
    const active = [...sessions.entries()];
    sessions.clear();
    await Promise.allSettled(active.map(([, runtime]) => runtime.stop()));
  }

  function getSession(sessionId) {
    return sessions.get(normalizeSessionId(sessionId)) || null;
  }

  function getStatus() {
    return [...sessions.entries()].map(([id, runtime]) => ({
      id,
      ...runtime.getStatus()
    }));
  }

  return {
    createSession,
    stopSession,
    getSession,
    getStatus,
    stop,
    get size() {
      return sessions.size;
    }
  };
}
