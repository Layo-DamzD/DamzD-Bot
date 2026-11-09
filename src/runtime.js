import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import path from "node:path";
import readline from "node:readline/promises";
import pino from "pino";

import { createContext } from "./context.js";
import { resolveCommandInput } from "./loader.js";
import { askAI, hasAIBrain } from "./ai.js";
import { detectPlatform, resolveAllInOne, mediaKind, cleanTitle } from "./downloads.js";
import { messageText, mentionedJids, quotedParticipant, numberFromJid, sleep } from "./utils.js";
import { config as appConfig, isOwnerNumber } from "./config.js";
import { WELCOME_ON, GOODBYE_ON, ANTILINK_ON } from "./store.js";

const MAX_PROCESSED_IDS = 2000;
const AI_COOLDOWN_MS = 2500;
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

function isBotMention(ctx, msg) {
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

async function sendAIReply(ctx, userText) {
  if (!hasAIBrain()) {
    await ctx.reply(
      "I can chat properly once my owner adds an AI key to my settings. " +
      "Meanwhile, " + ctx.config.prefix + "menu shows what I can still do."
    );
    return;
  }
  if (!canUseAI(ctx.jid)) {
    await ctx.reply("Give me a second to catch up first. 😊");
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
    if (isBotMention(ctx, msg)) {
      const cleaned = text.replace(/@\S+/g, " ").replace(appConfig.prefix + "\\S+", "").trim() || "Hello!";
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedContent = quoted ? messageText(quoted) : "";
      const composed = quotedContent ? quotedContent + "\n\n" + cleaned : cleaned;
      await sendAIReply(ctx, composed.slice(0, 3000));
      return;
    }

    if (ctx.isOwner && matchLink(text)) {
      await handleLink(ctx, text);
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
    this.startedAt = Date.now();
    this.stopped = false;
    this.logger = pino({ level: appConfig.logLevel });
  }

  status() {
    return {
      name: appConfig.name,
      connected: this.connected,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      commands: this.commands.length,
      accessMode: appConfig.accessMode
    };
  }

  async start() {
    const sessionDirectory = path.resolve(appConfig.sessionDirectory);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDirectory);
    let version;
    try {
      const fetched = await fetchLatestWaWebVersion();
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

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", update => {
      const { connection, lastDisconnect } = update;
      if (connection === "open") {
        this.connected = true;
        console.log("[" + appConfig.name + "] connected as " + (sock.user?.id || "unknown"));
      } else if (connection === "close") {
        this.connected = false;
        const code = Number(
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.data?.statusCode ||
          0
        );
        if (this.stopped) return;
        if (code === DisconnectReason.loggedOut || code === 401) {
          console.error("[" + appConfig.name + "] session logged out. Delete the auth folder and pair again.");
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
          await processMessage({
            processed: this.processed,
            store: this.store,
            memory: this.memory,
            lookup: this.lookup
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

    if (!state.creds?.registered) {
      await this.requestPairing();
    }
    return sock;
  }

  async requestPairing() {
    const target = appConfig.ownerNumbers[0] || "";
    let phoneNumber = target;
    if (!phoneNumber) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("Enter the WhatsApp number to pair (international format): ");
      rl.close();
      phoneNumber = numberFromJid(answer);
    }
    if (!phoneNumber) {
      console.error("[" + appConfig.name + "] no phone number available for pairing.");
      return;
    }
    await sleep(1500);
    try {
      const code = await this.sock.requestPairingCode(phoneNumber);
      console.log("┌─────────────────────────────┐");
      console.log("│  Pair this code in WhatsApp │");
      console.log("│                             │");
      console.log("│        " + code + "          │");
      console.log("│                             │");
      console.log("│  WhatsApp → Linked devices  │");
      console.log("│  → Link with phone number   │");
      console.log("└─────────────────────────────┘");
    } catch (error) {
      console.error("[" + appConfig.name + "] pairing failed:", error?.message);
    }
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
