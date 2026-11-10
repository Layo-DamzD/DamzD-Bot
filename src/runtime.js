import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState
} from "baileys";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import pino from "pino";
import QRCode from "qrcode";

import { createContext } from "./context.js";
import { resolveCommandInput } from "./loader.js";
import { askAI, hasAIBrain } from "./ai.js";
import { detectPlatform, resolveAllInOne, mediaKind, cleanTitle } from "./downloads.js";
import { messageText, mentionedJids, quotedParticipant, numberFromJid, sleep } from "./utils.js";
import { config as appConfig, isOwnerNumber, addRuntimeOwner } from "./config.js";
import { WELCOME_ON, GOODBYE_ON, ANTILINK_ON } from "./store.js";
import { registerCallHook, runSideEffects } from "./hooks.js";

const MAX_PROCESSED_IDS = 2000;
const AI_COOLDOWN_MS = 2500;
// Pairing codes expire in roughly a minute, and every new request kills the
// previous one. A fixed code string hid that rotation — the dashboard always
// showed the same 8 characters, so a person could keep typing a code that was
// already dead and get "check if the code is correct". Every request now
// returns a fresh random 8-digit code (WhatsApp's own format), so a changed
// code is always visible. PAIRING_CODE env still forces a fixed string.
const PAIRING_CODE = String(process.env.PAIRING_CODE || "").trim().toUpperCase();
const CUSTOM_PAIRING = /^[A-Z0-9]{8}$/.test(PAIRING_CODE) ? PAIRING_CODE : null;
const MIN_PAIRING_INTERVAL_MS = 30000;

// A number typed in local format (e.g. Nigeria 0708...) used to be sent to
// WhatsApp as-is, producing a pairing request for a nonsense international
// number (+070...). The code then could never match the phone that typed it —
// every login showed "Logging in…" and cancelled. Convert local formats to
// international using the owner's country code as the default.
const DEFAULT_COUNTRY_CODE = (() => {
  const owner = String(appConfig.ownerNumbers[0] || "").replace(/\D/g, "");
  return owner && !owner.startsWith("0") ? owner.slice(0, 3) : "234";
})();

function normalizePairingNumber(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 12) {
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  }
  return digits;
}

// Version markers exposed on /status — they prove which build (and which
// Baileys fork) is actually running, which matters when debugging remotes.
const here = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(here, "../package.json"), "utf8")).version); }
  catch { return "dev"; }
})();
const LIB_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(here, "../node_modules/baileys/package.json"), "utf8")).version); }
  catch { return "unknown"; }
})();
const lastAIByChat = new Map();
let aiQueue = Promise.resolve();

function canUseAI(jid) {
  const last = lastAIByChat.get(jid) || 0;
  return Date.now() - last >= AI_COOLDOWN_MS;
}

function markAIUsed(jid) {
  lastAIByChat.set(jid, Date.now());
}

function enqueueAI(task) {
  const run = aiQueue.then(task, task);
  aiQueue = run.catch(() => {});
  return run;
}

function allowedSender(ctx) {
  if (ctx.isOwner) return true;
  if (appConfig.accessMode === "self") return false;
  return true;
}

export function isBotMention(ctx, msg) { // exported so tests can cover the mention forms
  const ownJid = ctx.sock?.user?.id;
  const ownLid = ctx.sock?.user?.lid;
  const mentions = mentionedJids(msg.message);
  if (ownJid && mentions.includes(String(ownJid).split(":")[0].split("@")[0] + "@s.whatsapp.net")) return true;
  if (ownJid && mentions.includes(ownJid)) return true;
  if (ownLid && mentions.includes(String(ownLid).split(":")[0].split("@")[0] + "@lid")) return true;
  const quoted = quotedParticipant(msg.message);
  if (ownJid && quoted && String(ownJid).includes(quoted.split("@")[0])) return true;
  if (ownLid && quoted && String(ownLid).includes(quoted.split("@")[0])) return true;
  return false;
}

function formatAIError(error) {
  const message = String(error?.message || "Something went wrong.");
  if (message.includes("No AI key")) return message;
  return "Sorry, my mind went blank for a second — " + message.charAt(0).toLowerCase() + message.slice(1);
}

async function sendAIReply(ctx, userText, { silentOnCooldown = false } = {}) {
  if (!hasAIBrain()) {
    await ctx.reply(
      "I can chat properly once my owner adds an AI key to my settings. " +
      "Meanwhile, " + ctx.config.prefix + "menu shows what I can still do."
    );
    return;
  }
  if (!canUseAI(ctx.jid)) {
    // In groups a cooldown nudge would be noise — stay quiet there.
    if (!silentOnCooldown) await ctx.reply("Give me a second to catch up first. 😊");
    return;
  }
  markAIUsed(ctx.jid);
  ctx.memory.remember(ctx.jid, "user", userText);
  const history = ctx.memory.history(ctx.jid).map(item => ({
    role: item.role === "bot" ? "assistant" : item.role,
    content: item.content
  }));
  const thinking = ctx.typing(Math.min(3000, 600 + userText.length * 15));
  const answer = await enqueueAI(() => askAI({ messages: history, ownerName: appConfig.ownerName }));
  await thinking;
  await ctx.typing(Math.min(2500, 400 + (answer?.length || 0)));
  await ctx.reply(answer);
  ctx.memory.remember(ctx.jid, "assistant", answer);
}

async function autoDownload(ctx, sourceUrl, platform) {
  await ctx.typing(900);
  const resolved = await resolveAllInOne(sourceUrl);
  const info = mediaKind(resolved.item, resolved.url);
  const kind = info?.kind || "video";
  const extension = info?.extension || "mp4";
  const fileName = cleanTitle(resolved.title) + "." + extension;
  try {
    if (kind === "audio") {
      await ctx.send({ audio: { url: resolved.url }, mimetype: "audio/mpeg", fileName, ptt: false });
    } else if (kind === "image") {
      await ctx.send({ image: { url: resolved.url }, caption: "Here you go. 📎" });
    } else if (kind === "video") {
      await ctx.send({ video: { url: resolved.url }, mimetype: "video/mp4", caption: "Here you go. 📎" });
    } else {
      await ctx.send({ document: { url: resolved.url }, fileName, mimetype: "application/octet-stream" });
    }
  } catch {
    await ctx.reply("I could not attach the file directly, so here is the direct link:\n" + resolved.url);
  }
  ctx.memory.remember(ctx.jid, "user", "sent a " + platform + " link");
  ctx.memory.remember(ctx.jid, "assistant", "sent the downloaded " + kind);
}

function matchLink(text) {
  const candidates = String(text || "").match(/https?:\/\/\S+/g) || [];
  for (const candidate of candidates) {
    const detected = detectPlatform(candidate);
    if (detected) return detected;
  }
  return null;
}

async function handleLink(ctx, text) {
  const detected = matchLink(text);
  if (!detected) return false;
  try {
    await autoDownload(ctx, detected.url, detected.platform);
    return true;
  } catch (error) {
    await ctx.reply("That link gave me trouble — " + String(error?.message || "please try again."));
    return true;
  }
}

export async function processMessage(deps, sock, msg) {
  if (!msg?.message || !msg?.key?.remoteJid) return;
  const jid = String(msg.key.remoteJid);
  if (jid === "status@broadcast" || jid.endsWith("@newsletter")) return;

  const id = String(msg.key.id || "");
  if (id) {
    if (deps.processed.has(id)) return;
    deps.processed.add(id);
    if (deps.processed.size > MAX_PROCESSED_IDS) {
      const oldest = deps.processed.values().next().value;
      deps.processed.delete(oldest);
    }
  }

  const text = messageText(msg.message);
  if (!text) return;

  const ctx = createContext({ sock, msg, config: appConfig, store: deps.store, memory: deps.memory });
  ctx.commands = deps.commands || [];
  if (!ctx.isOwner && deps.store.get("banned", []).includes(ctx.senderNumber)) return;
  const restricted = !allowedSender(ctx);

  if (ctx.isGroup) {
    const antilink = deps.store.get(ANTILINK_ON + ":" + jid, false);
    if (antilink && matchLink(text) && !ctx.isOwner && !(await ctx.isAdmin())) {
      const deleted = await ctx.deleteMessage();
      const warnings = deps.store.get("warns:" + jid, {});
      const list = warnings[ctx.senderNumber] || [];
      list.push({ at: Date.now(), reason: "posted a link" });
      warnings[ctx.senderNumber] = list;
      deps.store.set("warns:" + jid, warnings);
      const count = list.length;
      await ctx.reply(
        (deleted ? "Removed that message — " : "") +
        ctx.pushName + ", links are not allowed here. That is warning " + count + " of 3." +
        (count >= 3 ? "\nThat is enough — next step is a removal." : "")
      );
      if (count >= 3 && (await ctx.isBotAdmin())) {
        try {
          await ctx.sock.groupParticipantsUpdate(ctx.jid, [ctx.sender], "remove");
          deps.store.set("warns:" + jid, {});
        } catch {
          /* removal requires the bot to be admin */
        }
      }
      return;
    }
  }

  if (restricted) return;

  const parsed = resolveCommandInput(text, appConfig.prefix);
  if (parsed) {
    const command = deps.lookup.get(parsed.name);
    if (command) {
      ctx.commandName = command.name;
      ctx.args = parsed.args;
      await ctx.react("⚡"); // quick visible ack that the command was received
      try {
        await command.run(ctx);
      } catch (error) {
        const message = String(error?.message || "Something went wrong.");
        await ctx.reply("Hmm, that did not work — " + message.charAt(0).toLowerCase() + message.slice(1));
      }
      return;
    }
    if (!ctx.isGroup) {
      await ctx.reply(
        "I do not know that command yet. " + appConfig.prefix + "menu shows everything I understand."
      );
      return;
    }
    return;
  }

  if (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")) {
    if (await handleLink(ctx, text)) return;
    await sendAIReply(ctx, text);
    return;
  }

  if (ctx.isGroup) {
    // The owner's own links are fetched even when she would not chat here.
    if (ctx.isOwner && matchLink(text)) {
      const handled = await handleLink(ctx, text);
      if (handled) return;
    }
    // She answers when mentioned — and in self mode the owner never needs to
    // mention her at all: anything he writes in a group is for her too.
    if (isBotMention(ctx, msg) || ctx.isOwner) {
      const cleaned = text.replace(/@\S+/g, " ").replace(appConfig.prefix + "\\S+", "").trim() || "Hello!";
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedContent = quoted ? messageText(quoted) : "";
      const composed = quotedContent ? quotedContent + "\n\n" + cleaned : cleaned;
      await sendAIReply(ctx, composed.slice(0, 3000), { silentOnCooldown: true });
      return;
    }
  }
}

export class DamzDBot {
  constructor({ commands, lookup, memory, store }) {
    this.commands = commands;
    this.lookup = lookup;
    this.memory = memory;
    this.store = store;
    this.processed = new Set();
    this.sock = null;
    this.connected = false;
    this.pairingCode = null;
    this.pairingCodeAt = null;
    this.startedAt = Date.now();
    this.stopped = false;
    this.introSent = false;
    this.pairingWasFresh = false;
    this.pairingTarget = null;   // the number the current code is for (manual input can change it)
    this.qrString = null;
    this.qrDataUrl = null;
    this.qrAt = null;
    this.lastManualPairingAt = 0;
    this.qrMode = false;      // "scan the QR" mode pauses background pairing codes
    this.resetting = false;   // a full reset from the dashboard is in progress
    this.authState = null;    // saved so mode switches can re-trigger pairing
    this.pairingLog = [];
    this.logger = pino({ level: appConfig.logLevel });
  }

  // Rolling diagnostics window shown on the dashboard — the owner sees exactly
  // what WhatsApp answered (code issued, refused, socket cycled) without logs.
  logPairing(event) {
    this.pairingLog.push({ at: Date.now(), event: String(event).slice(0, 140) });
    if (this.pairingLog.length > 8) this.pairingLog.shift();
  }

  // One canonical way to ask WhatsApp for a pairing code: the fixed env code
  // when configured, otherwise the stock random 8-digit one. Every caller goes
  // through here so the dashboard state (code, age, log) updates in one place.
  async issueCode(sock, number) {
    // Single choke point: whatever number comes in — env fallback, dashboard
    // box, refresh button — it goes out international, never local format.
    const target = normalizePairingNumber(number);
    const ask = async () => {
      if (CUSTOM_PAIRING) {
        try {
          const custom = await sock.requestPairingCode(target, CUSTOM_PAIRING);
          if (custom) return custom;
        } catch { /* some servers refuse custom codes — fall back */ }
      }
      return sock.requestPairingCode(target);
    };
    // A dying socket sometimes never answers — never leave the dashboard
    // button hanging on "Asking…" longer than 20 seconds.
    const code = await Promise.race([
      ask(),
      sleep(20000).then(() => { throw new Error("WhatsApp did not answer in time — try again"); })
    ]);
    this.pairingCode = code;
    this.pairingCodeAt = Date.now();
    this.lastPairingIssueAt = Date.now();
    this.logPairing("code " + code + " issued for +" + target + (CUSTOM_PAIRING ? " (fixed)" : ""));
    return code;
  }

  status() {
    return {
      name: appConfig.name,
      ownerName: appConfig.ownerName,
      connected: this.connected,
      pairingCode: this.pairingCode || null,
      pairingCodeAgeSeconds: this.pairingCode ? Math.floor((Date.now() - (this.pairingCodeAt || Date.now())) / 1000) : null,
      pairingNumber: this.connected ? null : (this.pairingTarget || appConfig.ownerNumbers[0] || null),
      number: this.connected ? numberFromJid(this.sock?.user?.id || "") || null : null,
      qr: (!this.connected && this.qrDataUrl && this.qrAt && Date.now() - this.qrAt <= 65000) ? this.qrDataUrl : null,
      qrAgeSeconds: (!this.connected && this.qrAt) ? Math.floor((Date.now() - this.qrAt) / 1000) : null,
      qrMode: !!this.qrMode,
      resetting: !!this.resetting,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      commands: this.commands.length,
      accessMode: appConfig.accessMode,
      aiBrain: hasAIBrain(),
      appVersion: APP_VERSION,
      lib: "baileys " + LIB_VERSION,
      pairingLog: this.pairingLog
    };
  }

  async start() {
    const sessionDirectory = path.resolve(appConfig.sessionDirectory);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDirectory);
    let version;
    try {
      // fetchLatestWaWebVersion is known to hang on some networks — never let
      // it block the boot for more than a few seconds.
      const fetched = await Promise.race([
        fetchLatestWaWebVersion().catch(() => null),
        sleep(6000).then(() => null)
      ]);
      if (Array.isArray(fetched?.version)) version = fetched.version;
    } catch {
      version = undefined;
    }

    const sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      logger: this.logger,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    this.sock = sock;
    this.authState = state;

    // The bot is a linked device on the owner's own account, so WhatsApp
    // re-delivers every message the account sends — including this bot's own
    // replies. Register everything we send as already-processed so an AI
    // reply can never trigger another reply (self-loop protection).
    const rawSend = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
      const sent = await rawSend(jid, content, options);
      const sentId = String(sent?.key?.id || "");
      if (sentId) this.processed.add(sentId);
      return sent;
    };

    sock.ev.on("creds.update", saveCreds);
    registerCallHook(sock, this.store);

    sock.ev.on("connection.update", update => {
      const { connection, lastDisconnect } = update;
      // Keep the latest QR for the dashboard's scan-to-link fallback — that is
      // the pairing path the patched library's fix was confirmed for.
      if (update.qr) {
        this.qrString = String(update.qr);
        this.qrAt = Date.now();
        QRCode.toDataURL(this.qrString, { margin: 2, width: 320 })
          .then(url => { if (this.qrString === String(update.qr)) this.qrDataUrl = url; })
          .catch(() => {});
      }
      // WhatsApp issues a fresh QR every ~20s while unregistered. Each QR is a
      // safe moment to ask for a pairing code: the handshake is complete then.
      // Requesting earlier (right after socket start) yields codes that
      // WhatsApp rejects with "check if the code is correct".
      // QR scan mode: while it is on, no pairing codes are requested in the
      // background. Every code request moves the WhatsApp linking session
      // forward and silently invalidates the QR currently on screen, so a
      // scan only succeeds when nothing else is touching the connection.
      if (update.qr && !state.creds?.registered && !this.qrMode) {
        const now = Date.now();
        // A number typed into the dashboard makes the next QR urgent: shorten
        // the throttle so the code lands on the fresh socket quickly.
        const manual = now - (this.lastManualPairingAt || 0) < 120000;
        const windowMs = manual ? 15000 : MIN_PAIRING_INTERVAL_MS;
        if (!this.lastPairingIssueAt || now - this.lastPairingIssueAt >= windowMs) {
          this.lastPairingIssueAt = now;
          this.pairingGeneration = (this.pairingGeneration || 0) + 1;
          const generation = this.pairingGeneration;
          // Fire and forget: a newer QR or socket supersedes stale requests
          // through the generation check, so retries never pile up.
          this.requestPairing(state, sock, generation).catch(() => {});
        }
      }
      if (connection === "open") {
        this.connected = true;
        this.pairingCode = null;
        this.pairingCodeAt = null;
        this.pairingTarget = null;
        this.qrString = null;
        this.qrDataUrl = null;
        this.qrAt = null;
        const ownNumber = numberFromJid(sock.user?.id || "");
        if (ownNumber) addRuntimeOwner(ownNumber);
        console.log("[" + appConfig.name + "] connected as " + (sock.user?.id || "unknown"));
        if (this.pairingWasFresh && !this.introSent) {
          this.introSent = true;
          const hello =
            "✅ Linked successfully. I am " + appConfig.name + " — " + appConfig.ownerName +
            "'s personal assistant. No ads, no footers, no promotions. Just me helping.\n\n" +
            "Talk to me in your own words, or send " + appConfig.prefix + "menu to see everything I can do.";
          if (ownNumber) {
            sock.sendMessage(ownNumber + "@s.whatsapp.net", { text: hello }).catch(() => {});
          }
        }
      } else if (connection === "close") {
        this.connected = false;
        // A closed socket invalidates the QR shown on the dashboard — never
        // let the owner scan a dead one.
        this.qrString = null;
        this.qrDataUrl = null;
        this.qrAt = null;
        const code = Number(
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.data?.statusCode ||
          0
        );
        // The raw message is included because it is how WhatsApp says things
        // like "rate-limit exceeded" — visible in the pairing log.
        const raw = String(lastDisconnect?.error?.message || "").slice(0, 60);
        // 428/515 recycles are normal while pairing — do not scare the owner.
        this.logPairing(
          code === DisconnectReason.loggedOut || code === 401
            ? "session rejected (" + code + ") " + raw
            : "socket recycled (" + code + ") " + raw
        );
        if (this.stopped || this.resetting) return;
        if (code === DisconnectReason.loggedOut || code === 401) {
          // Usually an expired pairing code was used — wipe and re-pair cleanly.
          this.pairRecoveries = (this.pairRecoveries || 0) + 1;
          if (this.pairRecoveries <= 5) {
            console.error("[" + appConfig.name + "] session was rejected (expired code?). Wiping it and issuing a fresh pairing code...");
            this.logPairing("session rejected — wiped, starting a clean pairing");
            try { fs.rmSync(path.resolve(appConfig.sessionDirectory), { recursive: true, force: true }); } catch { /* nothing to wipe */ }
            setTimeout(() => {
              if (!this.stopped) this.start().catch(error => console.error(error?.message));
            }, 4000);
          } else {
            console.error("[" + appConfig.name + "] too many rejected pairings — auto-pairing paused. The dashboard's 'Start completely over' button restarts it safely.");
            this.logPairing("auto-pairing paused after repeated rejections — tap Start completely over");
          }
          return;
        }
        const delay = Math.min(30000, 2000 * (1 + Math.random() * 2));
        console.log("[" + appConfig.name + "] reconnecting in " + Math.round(delay / 1000) + "s...");
        setTimeout(() => {
          if (!this.stopped) this.start().catch(error => console.error(error?.message));
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        try {
          await runSideEffects(sock, { store: this.store }, msg);
          await processMessage({
            processed: this.processed,
            store: this.store,
            memory: this.memory,
            lookup: this.lookup,
            commands: this.commands
          }, sock, msg);
        } catch (error) {
          console.error("[" + appConfig.name + "] message error:", error?.message);
        }
      }
    });

    sock.ev.on("group-participants.update", async ({ id, action, participants }) => {
      try {
        const jid = String(id || "");
        if (!jid.endsWith("@g.us")) return;
        if (action === "add" && this.store.get(WELCOME_ON + ":" + jid, false)) {
          const names = participants.map(p => "@" + numberFromJid(p)).join(" ");
          await sock.sendMessage(jid, {
            text: "Welcome " + names + ". Glad to have you here. 😊",
            mentions: participants
          });
        } else if (action === "remove" && this.store.get(GOODBYE_ON + ":" + jid, false)) {
          const names = participants.map(p => "@" + numberFromJid(p)).join(" ");
          await sock.sendMessage(jid, {
            text: "Take care, " + names + ". 👋",
            mentions: participants
          });
        }
      } catch (error) {
        console.error("[" + appConfig.name + "] greeting error:", error?.message);
      }
    });

    this.pairingWasFresh = !state.creds?.registered;
    return sock;
  }

  async requestPairing(state, sock, generation) {
    const fallbackNumber = appConfig.ownerNumbers[0] || "";
    const target = () => this.pairingTarget || fallbackNumber;
    if (!target()) {
      console.error("[" + appConfig.name + "] no OWNER_NUMBER set — type a number in the dashboard's number box to pair that phone.");
      return;
    }
    const alive = () => !this.stopped && !this.connected && !state.creds?.registered && this.pairingGeneration === generation && this.sock === sock;
    await sleep(1200);
    if (!alive()) return;
    try {
      await this.issueCode(sock, target());
    } catch (error) {
      this.logPairing("code request refused: " + String(error?.message || error).slice(0, 90));
      console.error("[" + appConfig.name + "] pairing request failed:", error?.message);
      return; // the QR cycle re-fires shortly and we try again
    }
    if (!alive()) return;
    console.log("┌─────────────────────────────┐");
    console.log("│  Pair this code in WhatsApp │");
    console.log("│                             │");
    console.log("│        " + this.pairingCode + "          │");
    console.log("│                             │");
    console.log("│  WhatsApp → Linked devices  │");
    console.log("│  → Link with phone number   │");
    console.log("└─────────────────────────────┘");
    // Deliberately NO background re-requests here. The code is valid for about
    // a minute; when WhatsApp recycles the socket, a fresh QR arrives and the
    // trigger above issues the next code. A refresh loop used to live here and
    // it was actively harmful: a re-request fired while the phone was showing
    // "Logging in…" kills the pending registration, so the phone gives up and
    // cancels the login. After issuing a code this coroutine simply ends — the
    // socket is left completely alone so the phone can finish linking.
  }

  // Dashboard number box: generate a pairing code for ANY phone number the
  // owner types. Private deploy — and a pairing code is useless to a stranger
  // without physical access to that phone, so no auth is needed here.
  async requestPairingForNumber(number) {
    const raw = String(number || "").replace(/\D/g, "");
    if (this.connected || this.stopped) return { ok: false, error: "already connected — no pairing needed" };
    const digits = normalizePairingNumber(raw);
    if (digits.length < 8 || digits.length > 15) return { ok: false, error: "type the full number, e.g. 2347087299884 (or local 07087299884)" };
    if (digits !== raw) this.logPairing("local number " + raw + " read as +" + digits);
    const now = Date.now();
    if (now - (this.lastManualPairingAt || 0) < 5000) return { ok: false, error: "one moment — try again in a few seconds" };
    this.lastManualPairingAt = now;
    if (this.qrMode) this.setQrMode(false, false); // asking for a code means code mode
    const sock = this.sock;
    if (!sock) return { ok: false, error: "still starting up — try again in a few seconds" };
    // Same number and the current code is still young? Hand it back instead of
    // requesting again — an extra request could interrupt a login in progress.
    if (digits === (this.pairingTarget || appConfig.ownerNumbers[0] || "") && this.pairingCode) {
      const age = Date.now() - (this.pairingCodeAt || 0);
      if (age < 45000) return { ok: true, code: this.pairingCode, number: digits };
    }
    this.pairingTarget = digits;
    this.logPairing("dashboard asked for a code for +" + digits);
    try {
      const code = await this.issueCode(sock, digits);
      console.log("[" + appConfig.name + "] pairing code for +" + digits + ": " + code);
      return { ok: true, code, number: digits };
    } catch (error) {
      // Unpaired sockets recycle about once a minute; a request landing late
      // in that window gets "Connection Closed". Cycle the socket now so
      // WhatsApp issues a fresh QR in seconds — the QR trigger then requests
      // a code for THIS number automatically (pairingTarget is already set).
      this.logPairing("socket recycled mid-request — a code for +" + digits + " lands in a few seconds");
      console.error("[" + appConfig.name + "] manual pairing request failed:", error?.message);
      try { sock.end(); } catch { /* already closing */ }
      return {
        ok: false,
        pending: true,
        error: "the socket was recycling — your code will appear in a few seconds, no need to click again"
      };
    }
  }

  // Used by the dashboard's "New code" button: forces an immediate fresh
  // code on the live pairing socket instead of waiting for the next cycle.
  async refreshPairingCode() {
    if (this.connected || this.stopped) return { ok: false, error: "already connected — no pairing needed" };
    if (this.qrMode) this.setQrMode(false, false);
    const sock = this.sock;
    const phoneNumber = this.pairingTarget || appConfig.ownerNumbers[0] || "";
    if (!sock || !phoneNumber) return { ok: false, error: "no active pairing socket" };
    // A code younger than 45s is still the best one — re-requesting could
    // interrupt a login that is mid-flight on the phone. Hand it back instead.
    if (this.pairingCode && Date.now() - (this.lastPairingIssueAt || 0) < 45000) {
      return { ok: true, code: this.pairingCode };
    }
    try {
      const code = await this.issueCode(sock, phoneNumber);
      console.log("[" + appConfig.name + "] manual pairing code refresh: " + code);
      return { ok: true, code };
    } catch (error) {
      this.logPairing("socket recycled mid-refresh — a fresh code lands in a few seconds");
      try { sock.end(); } catch { /* already closing */ }
      return { ok: false, pending: true, error: "the socket was recycling — a fresh code appears in a few seconds" };
    }
  }

  // Dashboard switch: pause background pairing codes so a QR stays valid
  // long enough to be scanned. Switching back re-arms the code flow.
  setQrMode(on, trigger = true) {
    this.qrMode = !!on;
    if (this.qrMode) {
      this.logPairing("QR scan mode on — background codes paused, the QR stays valid");
      return { ok: true, qrMode: true };
    }
    this.logPairing("back to code mode — a fresh code comes with the next QR");
    if (trigger && !this.connected && !this.stopped && !this.resetting) {
      // Make the very next QR carry a fresh code immediately.
      this.lastPairingIssueAt = 0;
      this.lastManualPairingAt = Date.now();
      this.pairingGeneration = (this.pairingGeneration || 0) + 1;
      const generation = this.pairingGeneration;
      if (this.sock && this.authState) {
        this.requestPairing(this.authState, this.sock, generation).catch(() => {});
      }
    }
    return { ok: true, qrMode: false };
  }

  // Nuclear option from the dashboard: wipe the half-registered session that
  // repeated cancelled logins leave behind, reset the pairing machinery, and
  // come back with a genuinely fresh QR. This is the way out of the
  // "auto-pairing paused" lockdown without touching the server.
  async fullReset() {
    if (this.resetting) return { ok: false, error: "already resetting — give it a few seconds" };
    this.resetting = true;
    this.logPairing("full reset — wiping the session and starting over");
    this.pairRecoveries = 0;
    this.pairingCode = null;
    this.pairingCodeAt = null;
    this.pairingTarget = null;
    this.qrString = null;
    this.qrDataUrl = null;
    this.qrAt = null;
    this.qrMode = false;
    try { fs.rmSync(path.resolve(appConfig.sessionDirectory), { recursive: true, force: true }); } catch { /* nothing to wipe */ }
    try { this.sock?.end(new Error("manual full reset")); } catch { /* already closed */ }
    setTimeout(() => {
      this.resetting = false;
      if (!this.stopped) this.start().catch(error => console.error(error?.message));
    }, 3000);
    return { ok: true };
  }

  stop() {
    this.stopped = true;
    try {
      this.sock?.end();
    } catch {
      /* already closed */
    }
  }
}

export { isOwnerNumber };
