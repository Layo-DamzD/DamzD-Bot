import { askAIAboutText } from "../src/ai.js";
import { translateText, resolveLanguageCode } from "../src/apis.js";

async function askStyled(ctx, style, brains) {
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
    style,
    brains
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

// A REAL model command: the question goes to that specific brain — a genuine
// model behind a free service — not a persona wearing a famous name. If that
// brain is asleep or its key is missing, the standard chain answers instead
// (optionally in that model's style), so the command never dead-ends.
function modelCommand(name, aliases, description, brains, fallbackStyle) {
  return {
    name,
    aliases,
    category: "AI & Chat",
    description,
    brains, // exposed so tests can assert the wiring
    run: async ctx => askStyled(ctx, fallbackStyle || "", brains)
  };
}

export default [
  modelCommand("chatgpt", ["gpt"],
    "smart router — reads your question and picks the best brain for it: code, maths, creative or quick answers", ["auto"]),
  modelCommand("deepseek", ["deepseek2", "deepseek3"],
    "DeepSeek V4 Flash — sharp reasoning at speed", ["nabees-deepseek"]),
  modelCommand("claude", [],
    "Claude Opus 5.5 — careful, nuanced reasoning", ["puter-model:claude-opus-5-5", "puter-model:claude-sonnet-5-5"],
    "Answer like a thoughtful reasoning model: careful, nuanced, balanced."),
  modelCommand("fable", [],
    "Claude Fable 5.2 — the storyteller, best for stories & creative writing", ["puter-model:claude-fable-5-2"]),
  modelCommand("gemini", ["gemini2"],
    "Gemini 4 Argon — creative, imaginative answers", ["puter-model:gemini-4-argon", "puter-model:gemini-3.8-flash"],
    "Answer like a creative model: imaginative, vivid, open to playful angles."),
  styleCommand("grok", [], "witty, bold answers, Grok-style (my built-in brains)",
    "Answer with wit and confidence: bold, playful, a little cheeky — but accurate, helpful and safe."),
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
      // The brains are the engine here — that is what the keys are for — and
      // the free translation endpoints are only a silent backup if the brains
      // are unreachable.
      const languageName = pipeSplit.length >= 2 ? String(pipeSplit[0]).trim() : target;
      let result = "";
      try {
        result = String(await askAIAboutText({
          prompt: "Translate this text to " + languageName + ". Reply with ONLY the translation — no quotes, no notes, no explanation:\n\n" + text.slice(0, 2500),
          history: [],
          ownerName: ctx.config.ownerName,
          style: ""
        })).trim();
      } catch {
        result = await translateText(text, target);
      }
      await ctx.reply("*" + result + "*");
    }
  }
];
