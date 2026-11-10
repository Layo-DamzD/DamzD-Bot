import { askAIAboutText } from "../src/ai.js";
import { translateText, resolveLanguageCode } from "../src/apis.js";

async function askStyled(ctx, style) {
  const prompt = String(ctx.args || "").trim();
  if (!prompt) {
    throw new Error("tell me what you would like to know");
  }
  if (prompt.length > 3500) {
    throw new Error("trim that to under 3500 characters and I am all yours");
  }
  const history = ctx.memory.history(ctx.jid).map(item => ({
    role: item.role === "bot" ? "assistant" : item.role,
    content: item.content
  }));
  await ctx.typing(Math.min(4000, 600 + prompt.length * 12));
  const answer = await askAIAboutText({
    prompt,
    history,
    ownerName: ctx.config.ownerName,
    style
  });
  await ctx.reply(answer);
  ctx.memory.remember(ctx.jid, "user", prompt);
  ctx.memory.remember(ctx.jid, "assistant", answer);
}

function styleCommand(name, aliases, description, style) {
  return {
    name,
    aliases,
    category: "AI & Chat",
    description,
    run: async ctx => askStyled(ctx, style)
  };
}

export default [
  {
    name: "ai",
    aliases: ["ask"],
    category: "AI & Chat",
    description: "ask me anything directly",
    run: async ctx => askStyled(ctx, "")
  },
  styleCommand("gpt", ["chatgpt"], "answers in a clear, structured way",
    "Answer like a knowledgeable general-purpose model: clear, structured, concise."),
  styleCommand("claude", [], "answers with thoughtful nuance",
    "Answer like a thoughtful reasoning model: careful, nuanced, balanced."),
  styleCommand("gemini", ["gemini2"], "answers with extra creativity",
    "Answer like a creative model: imaginative, vivid, open to playful angles."),
  styleCommand("deepseek", ["deepseek2", "deepseek3"], "answers with technical precision",
    "Answer like a technical model: precise, structured, detail-oriented."),
  styleCommand("qwen", [], "answers with multilingual strength",
    "Answer like a multilingual model: strong across languages, precise translations and phrasing."),
  styleCommand("fable5", [], "answers like a storyteller",
    "Answer like a storyteller: warm narrative tone, light metaphor, but still accurate."),
  styleCommand("wormgpt", [], "a mischievous hacker persona (harmless fun)",
    "Adopt a playful hacker-movie persona: witty, a little dramatic, cyber slang here and there — but strictly helpful, legal and safe. Never provide real harmful instructions."),
  styleCommand("mathgpt", [], "solves maths step by step",
    "You are a patient maths tutor: solve the problem and show the steps in short numbered lines, then the final answer."),
  {
    name: "aidetect",
    category: "AI & Chat",
    description: "estimate if a text looks AI-generated",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (text.length < 40) {
        throw new Error("send the text to analyse — at least a sentence or two");
      }
      await ctx.typing(1500);
      const answer = await askAIAboutText({
        prompt:
          "Analyse the following text and estimate whether it was written by AI. " +
          "Reply with: a probability percentage, two short reasons, and one tip.\n\nText:\n" + text.slice(0, 2500),
        ownerName: ctx.config.ownerName,
        style: "You are an AI-content detector. Be honest about uncertainty."
      });
      await ctx.reply(answer);
    }
  },
  {
    name: "translate",
    category: "AI & Chat",
    description: "translate text, e.g. .translate fr | good morning",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (!raw) throw new Error("use the format " + ctx.config.prefix + "translate fr | good morning");
      let target = "en";
      let text = raw;
      const pipeSplit = raw.split("|");
      if (pipeSplit.length >= 2) {
        target = resolveLanguageCode(pipeSplit[0].trim()) || "";
        if (!target) throw new Error("I did not recognise that language — try a code like fr, es, yo or ha");
        text = pipeSplit.slice(1).join("|").trim();
      } else {
        const first = raw.split(/\s+/)[0].toLowerCase().replace(/^:/, "");
        const code = resolveLanguageCode(first);
        if (code && first !== raw.slice(first.length).trim().slice(0, 3).toLowerCase()) {
          target = code;
          text = raw.slice(first.length).trim();
        }
      }
      if (!text) throw new Error("give me the text to translate");
      await ctx.typing(900);
      const result = await translateText(text, target);
      await ctx.reply("*" + result + "*");
    }
  }
];
