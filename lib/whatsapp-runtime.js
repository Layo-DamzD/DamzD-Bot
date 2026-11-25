import path from "node:path";
import { EventEmitter } from "node:events";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";

import { resolveCommandInput } from "../handlers/command-loader.js";
import { getMessageSender, messageText, numberFromJid } from "./message-utils.js";
import { isOwnerNumber } from "./owner-utils.js";
import { buildMenu } from "./menu.js";
import { getGroupGreetingSettings } from "./group-greetings.js";
import { handleGroupLinkMessage } from "./group-moderation.js";
import { getStatusAutomationSettings, processIncomingStatus } from "./status-automation.js";
import { createAntiDeleteRuntime, handleEditMessage } from "./anti-delete.js";
import { stashViewOnce, stashRememberMedia, stashWithheldStub } from "../src/damzd/viewonce.js";
import { maybeHumanReply } from "../src/damzd/human.js";
import { bumpActivity } from "../src/damzd/activity.js";
import { handleDamzDTriggers } from "../src/damzd/triggers.js";
import { recordChatMessage } from "../src/damzd/chat-log.js";
import { getActivePrefix } from "../src/damzd/prefix-store.js";
import { getAutoPresence } from "../src/damzd/presence.js";

const MAX_PROCESSED_IDS = 2000;
const VERSION_LOOKUP_TIMEOUT_MS = 8000;
const QR_READY_TIMEOUT_MS = 25000;

function isPaired(creds) {
  return Boolean(creds && (creds.registered || creds.account));
}

function statusCodeFrom(error) {
  return Number(error?.output?.statusCode || error?.data?.statusCode || error?.statusCode || 0);
}

// A content-withheld arrival (WhatsApp's view-once / offline media fanout):
// Baileys upserts a CIPHERTEXT stub — messageStubType set, "Message absent
// from node" as the first stub parameter — and asks the primary phone to
// re-serve. The re-served copy arrives under the SAME message id, so the
// stub must never claim the dedup slot: if it does, the real message is
// dropped by rememberProcessed before the view-once stash ever sees it,
// and every recovery path dies with nothing cached.
export function isContentWithheldStub(msg) {
  return Boolean(msg?.messageStubType) &&
    String(msg?.messageStubParameters?.[0] || "") === "Message absent from node";
}

function createDeferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

export function createWhatsAppRuntime({
  config,
  theme,
  commands = [],
  lookup = new Map(),
  sessionDirectory: requestedSessionDirectory,
  sessionId = "primary",
  socketFactory = makeWASocket
} = {}) {
  if (!config) throw new TypeError("Bot configuration is required.");

  const events = new EventEmitter();
  const sessionDirectory = path.resolve(String(
    requestedSessionDirectory || config.sessionDirectory || "./auth_info_baileys"
  ));
  const logger = pino({ level: config.logLevel || process.env.LOG_LEVEL || "info" });
  const processedIds = new Set();
  const antiDelete = createAntiDeleteRuntime();

  let authState = null;
  let saveCreds = null;
  let socket = null;
  let status = "idle";
  let connected = false;
  let stopped = false;
  let startPromise = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let lastError = "";
  let qrSeen = false;
  let qrReady = createDeferred();
  let messageQueue = Promise.resolve();

  function getStatus() {
    const self = socket?.user?.id || socket?.user?.lid || authState?.creds?.me?.id || "";
    return {
      id: String(sessionId),
      status,
      paired: isPaired(authState?.creds),
      connected,
      phoneNumber: numberFromJid(self),
      reconnectAttempts,
      lastError
    };
  }

  function rememberProcessed(id) {
    if (!id) return false;
    if (processedIds.has(id)) return true;
    processedIds.add(id);
    if (processedIds.size > MAX_PROCESSED_IDS) {
      const oldest = processedIds.values().next().value;
      processedIds.delete(oldest);
    }
    return false;
  }

  function scheduleReconnect(error) {
    if (stopped || reconnectTimer) return;
    lastError = String(error?.message || error || "Connection closed");
    connected = false;
    status = "reconnecting";
    const delayMs = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempts, 5)));
    reconnectAttempts += 1;
    events.emit("reconnecting", { delayMs, attempts: reconnectAttempts, error: lastError });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch(connectError => {
        lastError = String(connectError?.message || connectError);
        events.emit("runtimeError", connectError);
        scheduleReconnect(connectError);
      });
    }, delayMs);
  }

  async function dispatchMessage(msg, activeSocket) {
    if (!msg?.message || !msg?.key?.remoteJid) return;
    const jid = String(msg.key.remoteJid);
    if (jid === "status@broadcast") {
      try {
        const settings = await getStatusAutomationSettings();
        await processIncomingStatus({ sock: activeSocket, msg, settings });
      } catch (error) {
        logger.warn({ err: error }, "Incoming status automation failed");
      }
      return;
    }
    if (jid === "newsletter") return;
    const messageId = String(msg.key.id || "");
    if (messageId && isContentWithheldStub(msg)) {
      logger.info({ msgId: messageId, chat: jid },
        "view-once arrival withheld by WhatsApp — re-serve requested, waiting for the real copy");
      // The marker lets a .ggs fired during the re-serve window say "the
      // bytes are expected, hold on" instead of "nothing was ever seen".
      try { stashWithheldStub(msg); } catch { /* passive tracking */ }
      return; // nothing processable yet; the re-served copy carries the content
    }
    if (messageId && rememberProcessed(jid + ":" + messageId)) return;

    await antiDelete.cacheIncomingMessage(activeSocket, msg);
    // Edit alerts (antiedit) watch protocol edits before anything else.
    try {
      await handleEditMessage(activeSocket, msg);
    } catch (error) {
      logger.warn({ err: error, chat: jid }, "Edit alert handling failed");
    }

    // DamzD: the view-once stash sees every arrival before any gating (the
    // capture-on-arrival bytes make 🔓 reactions and Ggs work hours later),
    // and the group activity rows are how .onlineusers/.top/.ghost stay honest.
    try {
      if (stashViewOnce(msg)) {
        logger.info({ msgId: messageId, chat: jid },
          "view-once arrived in full — stashed and capture started");
      }
      stashRememberMedia(msg);
      if (jid.endsWith("@g.us") && msg.key.participant) {
        const participant = String(msg.key.participant);
        const digits = participant.split("@")[0].split(":")[0].replace(/\D/g, "");
        if (participant.endsWith("@lid")) bumpActivity(jid, "", digits);
        else bumpActivity(jid, digits, "");
      }
    } catch { /* passive tracking must never break the runtime */ }

    const text = messageText(msg.message);
    const prefix = await getActivePrefix(config);
    // Presence automation (autotype/autorec) fires when a real chat message
    // arrives, and the chat log feeds .tldr/.lore/.roast.
    try {
      const auto = getAutoPresence(jid);
      if (auto.typing) void activeSocket.sendPresenceUpdate("composing", jid).catch(() => {});
      if (auto.recording) void activeSocket.sendPresenceUpdate("recording", jid).catch(() => {});
      if (text && jid.endsWith("@g.us")) {
        const senderDigits = String(msg.key.participant || "").split("@")[0].split(":")[0].replace(/\D/g, "");
        recordChatMessage(jid, senderDigits, text.startsWith(prefix) ? text.slice(prefix.length) : text);
      }
    } catch { /* passive features must never break the runtime */ }
    const moderateLinks = async () => {
      try {
        await handleGroupLinkMessage({ sock: activeSocket, msg, text, config });
      } catch (error) {
        logger.warn({ err: error, group: jid }, "Group link moderation failed");
      }
    };

    const runParsed = async parsed => {
      const senderJid = getMessageSender(msg, activeSocket);
      const context = {
        sock: activeSocket,
        msg,
        jid,
        senderJid,
        text: text.slice(prefix.length).trim(),
        commandName: parsed.commandName,
        args: parsed.args,
        config,
        theme,
        sessionId,
        commands,
        connectionOpen: connected,
        mode: config.defaultMode || "public",
        command: parsed.commandName,
        owner: isOwnerNumber(config, senderJid),
        buildMenu: () => buildMenu({ commands, config, theme }),
        send: (content, options = {}) => activeSocket.sendMessage(jid, content, options === false ? {} : options),
        reply: async (content, options = {}) => {
          const payload = typeof content === "string" ? { text: content } : content;
          if (!payload || typeof payload !== "object") {
            throw new TypeError("A reply must be text or a WhatsApp message payload.");
          }
          const replyOptions = options === false ? { quoted: false } : options;
          const { quoted, ...sendOptions } = replyOptions;
          return activeSocket.sendMessage(jid, payload, {
            ...sendOptions,
            ...(quoted === false ? {} : { quoted: quoted || msg })
          });
        }
      };

      try {
        await parsed.definition.run(context);
      } catch (error) {
        logger.error({ err: error, command: parsed.commandName, chat: jid }, "Command execution failed");
        events.emit("runtimeError", error);
        await context.reply("The command could not be completed. Please try again.").catch(() => {});
      }
    };

    if (!text || !prefix || !text.startsWith(prefix)) {
      // DamzD dotless triggers: 🔓 reactions recover a remembered view-once
      // silently to the owner's own chat, and bare "onlineusers"/"ghost"
      // answer without the prefix.
      const handled = await handleDamzDTriggers({
        sock: activeSocket,
        msg,
        jid,
        text,
        prefix,
        lookup,
        config,
        runParsed
      });
      await moderateLinks();
      // DamzD human mode: plain DM chatter gets a natural, human-style
      // reply (no branding, a typing pause) — only when nothing else
      // handled the message. Fire-and-forget: a slow AI answer must never
      // stall the incoming message queue.
      if (!handled && text) {
        void maybeHumanReply({ sock: activeSocket, jid, text, msg })
          .catch(() => { /* human mode must never break the runtime */ });
      }
      return;
    }

    const parsed = resolveCommandInput(text.slice(prefix.length).trim(), lookup);
    if (!parsed) {
      await moderateLinks();
      return;
    }
    await runParsed(parsed);
  }

  function queueMessages(upsert, activeSocket) {
    if (!upsert || upsert.type !== "notify" || !Array.isArray(upsert.messages)) return;
    messageQueue = messageQueue.then(async () => {
      for (const msg of upsert.messages) {
        if (stopped || socket !== activeSocket) break;
        await dispatchMessage(msg, activeSocket);
      }
    }).catch(error => {
      logger.error({ err: error }, "Incoming message queue failed");
      events.emit("runtimeError", error);
    });
  }

  async function connect() {
    if (stopped) return null;
    if (!authState || !saveCreds) throw new Error("Baileys authentication state has not been initialized.");

    status = "connecting";
    // Each fresh connection gets its own pairing-ready state, so a code
    // request always waits for THIS socket's QR, never a stale one.
    qrSeen = false;
    qrReady = createDeferred();
    let version;
    try {
      const versionInfo = await fetchLatestWaWebVersion({
        signal: AbortSignal.timeout(VERSION_LOOKUP_TIMEOUT_MS)
      });
      if (Array.isArray(versionInfo?.version)) version = versionInfo.version;
      if (versionInfo?.isLatest === false) {
        logger.warn({ error: versionInfo.error?.message }, "Using the Baileys bundled WhatsApp Web version");
      }
    } catch (error) {
      logger.warn({ err: error }, "WhatsApp Web version lookup failed; using the Baileys default version");
    }

    if (stopped) return null;

    const nextSocket = socketFactory({
      ...(version ? { version } : {}),
      auth: authState,
      logger,
      browser: Browsers.windows(String(config.browser || "Chrome")),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
      defaultQueryTimeoutMs: 60000
    });

    socket = nextSocket;
    nextSocket.ev.on("creds.update", saveCreds);
    nextSocket.ev.on("messages.upsert", update => queueMessages(update, nextSocket));
    nextSocket.ev.on("messages.update", updates => {
      void (async () => {
        if (!Array.isArray(updates)) return;
        for (const update of updates) {
          await antiDelete.handleDeleteUpdate(nextSocket, update);
        }
      })().catch(error => {
        logger.warn({ err: error }, "Anti-delete update handling failed");
      });
    });
    nextSocket.ev.on("group-participants.update", update => {
      void (async () => {
        if (!update?.id || !Array.isArray(update.participants)) return;
        if (update.action !== "add" && update.action !== "remove") return;
        const settings = await getGroupGreetingSettings(update.id);
        const type = update.action === "add" ? "welcome" : "goodbye";
        const greeting = settings[type];
        if (!greeting?.enabled || !greeting.message) return;

        let groupName = "this group";
        try {
          const metadata = await nextSocket.groupMetadata(update.id);
          groupName = String(metadata?.subject || groupName);
        } catch {}

        for (const participant of update.participants) {
          const candidateIds = [
            participant?.pn,
            participant?.phoneNumber,
            participant?.id,
            participant?.jid,
            participant?.lid,
            participant
          ].map(value => String(value || "").trim()).filter(value => value.includes("@"));
          const participantId = candidateIds.find(value => value.endsWith("@s.whatsapp.net")) ||
            candidateIds[0] || "";
          if (!participantId) continue;

          const numberSource = String(
            participant?.phoneNumber || participant?.pn || participantId
          );
          const number = numberSource.split("@")[0].split(":")[0].replace(/\D/g, "");
          const user = number ? "@" + number : "a group member";
          const text = String(greeting.message)
            .replace(/\{user\}/g, user)
            .replace(/\{number\}/g, number || "unknown")
            .replace(/\{group\}/g, groupName.slice(0, 100))
            .slice(0, 900);

          try {
            await nextSocket.sendMessage(update.id, {
              text,
              mentions: number ? [participantId] : []
            });
          } catch (error) {
            logger.warn({ err: error, group: update.id }, "Could not send group greeting");
          }
        }
      })().catch(error => {
        logger.warn({ err: error }, "Group greeting event failed");
      });
    });

    nextSocket.ev.on("connection.update", update => {
      if (socket !== nextSocket || stopped) return;

      if (update.qr) {
        qrSeen = true;
        qrReady.resolve(update.qr);
        events.emit("qr", update.qr);
      }

      if (update.connection === "connecting") status = "connecting";

      if (update.connection === "open") {
        connected = true;
        status = "connected";
        reconnectAttempts = 0;
        lastError = "";
        events.emit("connected", getStatus());
      }

      if (update.connection === "close") {
        connected = false;
        const error = update.lastDisconnect?.error;
        const code = statusCodeFrom(error);
        lastError = String(error?.message || "WhatsApp connection closed");

        if (code === DisconnectReason.loggedOut) {
          status = "logged_out";
          events.emit("loggedOut", { status: getStatus(), error });
          return;
        }

        status = "reconnecting";
        scheduleReconnect(error || "WhatsApp connection closed");
      }
    });

    events.emit("socketCreated", { sessionId, socket: nextSocket });
    return nextSocket;
  }

  async function start() {
    if (startPromise) return startPromise;
    stopped = false;
    startPromise = (async () => {
      status = "starting";
      const auth = await useMultiFileAuthState(sessionDirectory);
      authState = auth.state;
      saveCreds = auth.saveCreds;
      await connect();
      return getStatus();
    })().catch(error => {
      startPromise = null;
      status = "error";
      lastError = String(error?.message || error);
      throw error;
    });
    return startPromise;
  }

  async function requestPairingCode(phoneNumber) {
    const phone = String(phoneNumber || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(phone)) {
      throw new Error("Enter a valid WhatsApp number with country code (8–15 digits).");
    }
    if (!socket) {
      // The socket vanishes on stop() (e.g. the dashboard's full reset).
      // start() is idempotent: it reconnects here, or no-ops while a start
      // is already in flight.
      await start();
    }
    if (!socket) throw new Error("The WhatsApp socket is not ready yet — try again in a few seconds.");
    if (isPaired(authState?.creds)) throw new Error("This session is already paired.");

    if (!qrSeen) {
      let timeout;
      try {
        await Promise.race([
          qrReady.promise,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(
              "WhatsApp did not prepare a pairing request in time. Check the connection and try again."
            )), QR_READY_TIMEOUT_MS);
          })
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    if (!socket || stopped) throw new Error("The WhatsApp connection stopped before pairing.");
    const code = await socket.requestPairingCode(phone);
    return { code: String(code), phoneNumber: phone };
  }

  async function stop() {
    stopped = true;
    connected = false;
    status = "stopped";
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    // Drop the cached start promise — otherwise the next start() would
    // return the old resolved promise and never reconnect the socket.
    startPromise = null;

    antiDelete.clear();
    const activeSocket = socket;
    socket = null;
    if (activeSocket) {
      try {
        activeSocket.end(new Error("DamzD runtime stopped"));
      } catch (error) {
        logger.debug({ err: error }, "Socket shutdown completed with a warning");
      }
    }
    await messageQueue.catch(() => {});
    events.emit("stopped", getStatus());
  }

  return {
    start,
    stop,
    getStatus,
    requestPairingCode,
    on: (event, listener) => {
      events.on(event, listener);
      return () => events.off(event, listener);
    },
    get socket() {
      return socket;
    },
    get sessionDirectory() {
      return sessionDirectory;
    }
  };
}
