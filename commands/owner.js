import { config as appConfig } from "../src/config.js";

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
        process.env.ACCESS_MODE = wanted;
        Object.defineProperty(appConfig, "accessMode", { value: wanted, configurable: false });
        await ctx.reply("Done — I will now respond to " + (wanted === "self" ? "you only." : "everyone."));
        return;
      }
      await ctx.reply(
        "Current access: *" + appConfig.accessMode + "*.\n" +
        "Use " + ctx.config.prefix + "mode self (only you) or " + ctx.config.prefix + "mode public (everyone)."
      );
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
  }
];
