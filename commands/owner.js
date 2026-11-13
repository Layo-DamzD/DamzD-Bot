import { config as appConfig, setAccessMode } from "../src/config.js";

export default [
  {
    name: "mode",
    hidden: true,
    category: "Owner",
    description: "switch between self (only you) and public (everyone)",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const wanted = String(ctx.args || "").trim().toLowerCase();
      if (wanted === "public" || wanted === "self") {
        const now = setAccessMode(wanted);
        await ctx.reply("Done — I will now respond to " + (now === "self" ? "you only." : "everyone."));
        return;
      }
      await ctx.reply(
        "Current access: *" + appConfig.accessMode + "*.\n" +
        "Use " + ctx.config.prefix + "mode self (only you) or " + ctx.config.prefix + "mode public (everyone)."
      );
    }
  },
  {
    name: "public",
    hidden: true,
    category: "Owner",
    description: "let everyone use commands",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      setAccessMode("public");
      await ctx.reply("Public mode on — everyone can use my commands now.");
    }
  },
  {
    name: "private",
    hidden: true,
    category: "Owner",
    description: "restrict commands to you",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      setAccessMode("self");
      await ctx.reply("Private mode on — only you can use my commands now.");
    }
  },
  {
    name: "forget",
    hidden: true,
    category: "Owner",
    description: "wipe the conversation memory for this chat",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      ctx.memory.forget(ctx.jid);
      await ctx.reply("Cleared. Fresh start for this chat. 🧽");
    }
  },
  {
    name: "broadcast",
    hidden: true,
    category: "Owner",
    description: "send a message to every chat the bot has talked in",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("what should I pass along?");
      const chats = ctx.memory.knownChats();
      let sent = 0;
      for (const jid of chats) {
        try {
          await ctx.sock.sendMessage(jid, { text: "📩 " + text });
          sent += 1;
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch {
          /* skip unreachable chats */
        }
      }
      await ctx.reply("Delivered to " + sent + " chat" + (sent === 1 ? "" : "s") + ".");
    }
  },
  {
    name: "settings",
    hidden: true,
    category: "Owner",
    description: "show the current settings",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      await ctx.reply(
        "⚙️ *Settings*\n" +
        "Name: " + appConfig.name + "\n" +
        "Owner: " + appConfig.ownerName + "\n" +
        "Access: " + appConfig.accessMode + "\n" +
        "Prefix: `" + appConfig.prefix + "`\n" +
        "Auto-download links: " + (appConfig.autoDownloadLinks ? "on" : "off") + "\n" +
        "Anti-delete: " + (ctx.store.get("antidelOn", false) ? "on" : "off") + "\n" +
        "Anti-edit: " + (ctx.store.get("antieditOn", false) ? "on" : "off") + "\n" +
        "Auto status view: " + (ctx.store.get("autostatusOn", false) ? "on" : "off") + "\n" +
        "Anti-call: " + (ctx.store.get("anticallOn", false) ? "on" : "off")
      );
    }
  },
  {
    name: "ownerinfo",
    aliases: ["botinfo"],
    hidden: true,
    category: "Owner",
    description: "owner-only bot information",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      await ctx.reply(
        "🤖 *" + appConfig.name + "* internals\n" +
        "Uptime: " + Math.floor(process.uptime() / 60) + " min\n" +
        "Memory: " + Math.round(process.memoryUsage().heapUsed / 1048576) + " MB\n" +
        "Node: " + process.version + "\n" +
        "Paired as: " + (ctx.sock?.user?.id || "unknown") + "\n" +
        "AI brain: " + (appConfig.childMode
          ? (appConfig.groq.apiKey ? "Groq (child bot)" : "Groq — no key set (child bot)")
          : (appConfig.puterTokens.length
            ? "Puter flagships (" + appConfig.puterTokens.length + (appConfig.puterTokens.length === 1 ? " account" : " accounts") + ")"
            : "no Puter token — keyless services only")) + "\n" +
        "OpenRouter key: " + (appConfig.openrouter.apiKey ? "set" : "not set")
      );
    }
  },
  {
    name: "ban",
    hidden: true,
    category: "Owner",
    description: "block a user from using me (a connected friend's whole bot gets stopped)",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
      const number = info?.participant
        ? String(info.participant).split("@")[0]
        : String(ctx.args || "").replace(/[^0-9]/g, "");
      if (!number) throw new Error("mention the person or send their number");
      // A number that connected their own WhatsApp to this server runs its own
      // bot process — banning it stops that whole bot until .unban, which is
      // stronger than any per-chat ban.
      if (ctx.sessions?.has(number)) {
        const result = ctx.sessions.ban(number);
        if (!result.ok) throw new Error(result.error);
        await ctx.reply("🚫 +" + result.number + " is banned — their connected bot is stopped and will not start again until you send .unban " + result.number);
        return;
      }
      const banned = ctx.store.get("banned", []);
      if (!banned.includes(number)) banned.push(number);
      ctx.store.set("banned", banned);
      await ctx.reply("+" + number + " is banned from using me.");
    }
  },
  {
    name: "unban",
    hidden: true,
    category: "Owner",
    description: "unblock a banned user (revives a banned friend's bot)",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const number = String(ctx.args || "").replace(/[^0-9]/g, "");
      if (!number) throw new Error("send the number to unban");
      if (ctx.sessions?.has(number)) {
        const result = ctx.sessions.unban(number);
        if (!result.ok) throw new Error(result.error);
        await ctx.reply("✅ +" + result.number + " is unbanned — their bot is starting again with the same WhatsApp link, no fresh pairing needed.");
        return;
      }
      const banned = ctx.store.get("banned", []).filter(item => item !== number);
      ctx.store.set("banned", banned);
      await ctx.reply("+" + number + " can use me again.");
    }
  },
  {
    name: "setprefix",
    hidden: true,
    category: "Owner",
    description: "choose a new command prefix",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const wanted = String(ctx.args || "").trim().slice(0, 3);
      if (!wanted) throw new Error("give me the new prefix, e.g. ! or #");
      Object.defineProperty(appConfig, "prefix", { value: wanted, configurable: false });
      await ctx.reply("Prefix is now `" + wanted + "`.");
    }
  },
  {
    name: "privacy",
    hidden: true,
    category: "Owner",
    description: "explain the current privacy mode",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      await ctx.reply(
        appConfig.accessMode === "self"
          ? "I am in private mode — only you can run commands and get replies."
          : "I am in public mode — everyone who messages me can use commands."
      );
    }
  },
  {
    name: "pause",
    hidden: true,
    category: "Owner",
    description: "go completely silent until you send .resume",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      ctx.store.set("pausedOn", true);
      await ctx.reply(
        "💤 Paused — I stay linked but I will not read, react or answer anything until you send " +
        ctx.config.prefix + "resume."
      );
    }
  },
  {
    name: "resume",
    aliases: ["unpause"],
    hidden: true,
    category: "Owner",
    description: "wake me up after .pause",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      if (!ctx.store.get("pausedOn", false)) {
        await ctx.reply("I am not paused — I am right here. 😊");
        return;
      }
      ctx.store.set("pausedOn", false);
      await ctx.reply("☀️ Back online — I can hear you again.");
    }
  },
  {
    name: "restart",
    hidden: true,
    category: "Owner",
    description: "restart the bot process",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      await ctx.reply("Restarting — back in a few seconds. 🔄");
      setTimeout(() => process.exit(0), 1200);
    }
  },
  {
    name: "autoreact",
    hidden: true,
    category: "Owner",
    description: "toggle auto-reactions in this chat",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) throw new Error("use " + ctx.config.prefix + "autoreact on or off");
      const current = ctx.store.get("autoreact:" + ctx.jid, { on: false, emoji: "✨", keys: [] });
      ctx.store.set("autoreact:" + ctx.jid, { ...current, on: arg === "on" });
      await ctx.reply("Auto-reactions for this chat are now *" + arg + "*.");
    }
  },
  {
    name: "reactmode",
    hidden: true,
    category: "Owner",
    description: "choose the auto-reaction emoji",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const emoji = String(ctx.args || "").trim().split(/\s+/)[0];
      if (!emoji) throw new Error("give me the emoji, e.g. " + ctx.config.prefix + "reactmode 🔥");
      const current = ctx.store.get("autoreact:" + ctx.jid, { on: false, emoji: "✨", keys: [] });
      ctx.store.set("autoreact:" + ctx.jid, { ...current, emoji });
      await ctx.reply("Auto-reactions in this chat will use " + emoji + ".");
    }
  },
  {
    name: "reactkeys",
    hidden: true,
    category: "Owner",
    description: "auto-react only to messages containing these words",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const words = String(ctx.args || "").split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
      if (!words.length) throw new Error("list the trigger words, or send 'off' to clear them");
      if (words[0].toLowerCase() === "off") {
        const current = ctx.store.get("autoreact:" + ctx.jid, { on: false, emoji: "✨", keys: [] });
        ctx.store.set("autoreact:" + ctx.jid, { ...current, keys: [] });
        await ctx.reply("Auto-reactions now apply to every message in this chat.");
        return;
      }
      const current = ctx.store.get("autoreact:" + ctx.jid, { on: false, emoji: "✨", keys: [] });
      ctx.store.set("autoreact:" + ctx.jid, { ...current, keys: words });
      await ctx.reply("Auto-reactions trigger on: " + words.join(", "));
    }
  },
  {
    name: "anticall",
    hidden: true,
    category: "Owner",
    description: "auto-reject incoming WhatsApp calls",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) throw new Error("use " + ctx.config.prefix + "anticall on or off");
      ctx.store.set("anticallOn", arg === "on");
      await ctx.reply("Anti-call is now *" + arg + "*.");
    }
  },
  {
    name: "readreceipt",
    hidden: true,
    category: "Owner",
    description: "read receipt preference",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      const arg = String(ctx.args || "").trim().toLowerCase();
      if (!/^(on|off)$/.test(arg)) throw new Error("use " + ctx.config.prefix + "readreceipt on or off");
      ctx.store.set("readreceiptOn", arg === "on");
      await ctx.reply(
        arg === "on"
          ? "Read receipts stay on (the WhatsApp default for linked devices)."
          : "Noted. WhatsApp applies the blue-tick preference from your phone's privacy settings — linked devices follow the account, so change it there: Settings → Privacy → Read receipts."
      );
    }
  },
  {
    name: "prvset",
    hidden: true,
    category: "Owner",
    description: "show the account's privacy settings",
    run: async ctx => {
      if (!ctx.isOwner) throw new Error("this is an owner command");
      try {
        const settings = await ctx.sock.fetchPrivacySettings?.();
        const pretty = settings ? Object.entries(settings)
          .filter(([key]) => !["__typename"].includes(key))
          .map(([key, value]) => key + ": " + (typeof value === "object" ? JSON.stringify(value) : value))
          .join("\n") : "";
        await ctx.reply("🔒 Privacy settings:\n" + pretty);
      } catch {
        throw new Error("WhatsApp did not share the privacy settings with me");
      }
    }
  }
];
