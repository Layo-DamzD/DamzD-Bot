import "dotenv/config";

import path from "node:path";
import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import config from "./config/bot.config.js";
import theme from "./config/theme.config.js";
import { loadCommands } from "./handlers/command-loader.js";
import { createWhatsAppRuntime } from "./lib/whatsapp-runtime.js";
import { initViewOnceStore } from "./src/damzd/viewonce.js";
import { initActivityStore } from "./src/damzd/activity.js";

// The DamzD connect note: picture first, then the status card, into the
// owner's own chat on every real connect — throttled to one a minute so a
// flapping link never spams.
function lagosTime() {
  try {
    return new Intl.DateTimeFormat("en-NG", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}

function uptimeText() {
  const seconds = Math.floor(process.uptime());
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? hours + "h " + minutes + "m" : minutes + "m " + (seconds % 60) + "s";
}

function connectCard() {
  const line = "┃ ◇ ";
  return [
    "╭━━〔 ⚡ " + config.name + " 〕━━┈⊷",
    line + "STATUS: connected and online ✅",
    line + "VERSION: " + config.version,
    line + "OWNER: " + (config.ownerName || "the owner"),
    line + "MODE: " + String(config.defaultMode || "public").toUpperCase(),
    line + "UPTIME: " + uptimeText(),
    line + "PREFIX: " + config.prefix,
    line + "MY TIME: " + lagosTime() + " (WAT)",
    "│",
    "╰━━━━━━━━━━━━┈⊷",
    "",
    "I am online and linked to this account. Talk to me in normal words, or send " + config.prefix + "menu to see everything I can do.",
    "",
    "✦ POWERED BY GREAT DAMZD"
  ].join("\n");
}

let lastIntroAt = 0;
async function sendConnectNote(runtime) {
  const now = Date.now();
  if (now - lastIntroAt < 60000) return;
  lastIntroAt = now;
  try {
    const sock = runtime.socket;
    if (!sock) return;
    const number = String(config.ownerNumber || "").replace(/\D/g, "");
    if (!number) return;
    const own = number + "@s.whatsapp.net";
    let imageBuffer = null;
    try { imageBuffer = fs.readFileSync(path.resolve(process.cwd(), "assets", "bot-image.png")); } catch { /* fall back to the configured URL */ }
    if (imageBuffer) {
      await sock.sendMessage(own, { image: imageBuffer, caption: "🤖 " + config.name + " is online" });
    } else if (config.imageUrl) {
      await sock.sendMessage(own, { image: { url: config.imageUrl }, caption: "🤖 " + config.name + " is online" });
    }
    await sock.sendMessage(own, { text: connectCard() });
  } catch { /* the note is cosmetic — never block the runtime */ }
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidPhone(value) {
  return /^\d{8,15}$/.test(normalizePhone(value));
}

export async function runLocalTerminal(options = {}) {
  const { commands, lookup } = await loadCommands();
  const sessionDirectory = path.resolve(String(
    options.sessionDirectory ||
    process.env.FEI_SESSION_DIR ||
    config.sessionDirectory
  ));
  const dataDirectory = path.resolve(String(
    options.dataDirectory ||
    process.env.FEI_DATA_DIR ||
    config.dataDirectory
  ));
  initViewOnceStore(dataDirectory);
  initActivityStore(dataDirectory);

  const runtime = createWhatsAppRuntime({
    config,
    theme,
    commands,
    lookup,
    sessionDirectory
  });

  let shuttingDown = false;
  let rl = null;

  async function shutdown(signal = "") {
    if (shuttingDown) return;
    shuttingDown = true;
    if (signal) console.log("\nStopping DamzD (" + signal + ")...");
    if (rl) {
      rl.close();
      rl = null;
    }
    await runtime.stop().catch(error => {
      console.warn("Could not stop FEI XMD cleanly:", error && error.message || error);
    });
  }

  const onSigint = () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  };
  const onSigterm = () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  runtime.on("connected", status => {
    console.log("\nDamzD connected" + (status.phoneNumber ? " as " + status.phoneNumber : "") + ".");
    void sendConnectNote(runtime);
  });
  runtime.on("reconnecting", info => {
    console.warn("WhatsApp connection closed. Reconnecting in " + info.delayMs + " ms...");
  });
  runtime.on("loggedOut", () => {
    console.error("This WhatsApp session was logged out. Remove the local auth folder and pair again.");
  });
  runtime.on("runtimeError", error => {
    console.error("DamzD runtime error:", error && error.message || error);
  });

  try {
    console.log("\n╭━━〔 DamzD · LOCAL RUNTIME 〕━━┈⊷");
    console.log("Baileys: @whiskeysockets/baileys (official npm package)");
    console.log("Session directory: " + sessionDirectory);
    console.log("Loaded " + commands.length + " command module(s).");
    console.log("Press Ctrl+C to stop the runtime.\n");

    await runtime.start();
    const status = runtime.getStatus();

    if (!status.paired && !status.connected) {
      let phoneNumber = normalizePhone(process.env.PAIRING_NUMBER || "");

      while (!shuttingDown && !phoneNumber) {
        rl = createInterface({ input: stdin, output: stdout });
        const answer = await rl.question(
          "Enter your WhatsApp number with country code (digits only, e.g. 2348012345678), or Q to cancel: "
        );
        rl.close();
        rl = null;

        if (String(answer || "").trim().toLowerCase() === "q") {
          await shutdown();
          return runtime;
        }

        if (!isValidPhone(answer)) {
          console.log("Invalid number. Include the country code and enter 8–15 digits.\n");
          continue;
        }
        phoneNumber = normalizePhone(answer);
      }

      if (!shuttingDown && phoneNumber) {
        const pairing = await runtime.requestPairingCode(phoneNumber);
        console.log("\n╭━━〔 YOUR WHATSAPP PAIRING CODE 〕━━┈⊷");
        console.log("                 " + pairing.code);
        console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷");
        console.log("On your phone: WhatsApp → Linked devices → Link a device → Link with phone number instead.");
        console.log("Enter this code on WhatsApp. Keep it private.\n");
      }
    } else {
      console.log("An existing local WhatsApp session was found. Reconnecting without requesting another code...");
    }

    console.log("DamzD is running. Keep this process active while the WhatsApp session is connected.");
    return runtime;
  } catch (error) {
    await shutdown();
    throw error;
  }
}
