import { askAIAboutText } from "../src/ai.js";

export default [
  {
    name: "ai",
    aliases: ["ask"],
    category: "AI & Chat",
    description: "ask me anything directly",
    run: async ctx => {
      const prompt = String(ctx.args || "").trim();
      if (!prompt) {
        await ctx.reply("Tell me what you would like to know and I will think it through.");
        return;
      }
      if (prompt.length > 3500) {
        await ctx.reply("That is a lot — could you trim it to under 3500 characters?");
        return;
      }
      const history = ctx.memory.history(ctx.jid).map(item => ({
        role: item.role === "bot" ? "assistant" : item.role,
        content: item.content
      }));
      await ctx.typing(Math.min(3000, 600 + prompt.length * 12));
      const answer = await askAIAboutText({
        prompt,
        history,
        ownerName: ctx.config.ownerName
      });
      await ctx.reply(answer);
      ctx.memory.remember(ctx.jid, "user", prompt);
      ctx.memory.remember(ctx.jid, "assistant", answer);
    }
  }
];
