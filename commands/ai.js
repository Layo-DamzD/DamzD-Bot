import {
  extractApiText,
  requestApiJson,
  requestExternalJson,
  unicodeBox,
  withPoweredFooter
} from "../lib/api-client.js";

const MAX_PROMPT = 3500;
const OMEGATECH = "https://api.omegatech.app/api";

function requirePrompt(ctx, example) {
  const query = String(ctx.args || "").trim();
  if (!query) throw new Error("Usage: " + ctx.config.prefix + ctx.commandName + " " + (example || "your question"));
  if (query.length > MAX_PROMPT) throw new Error("Please keep your input under " + MAX_PROMPT + " characters.");
  return query;
}

function valueAt(payload, paths) {
  for (const path of paths) {
    let value = payload;
    for (const key of path.split(".")) value = value && value[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function sendAnswer(ctx, title, answer) {
  const body = String(answer || "").trim();
  if (!body) throw new Error("The AI service did not return a readable answer.");
  const box = unicodeBox(title, body.slice(0, 3300), { footer: false });
  await ctx.reply(withPoweredFooter(box, 3800));
}

function createSimpleCommand({ name, aliases = [], title, endpoint, params, external = false, description }) {
  return {
    name,
    aliases,
    category: "AI & Chat",
    description,
    run: async ctx => {
      const prompt = requirePrompt(ctx);
      const payload = external
        ? await requestExternalJson(endpoint, params(prompt))
        : await requestApiJson(endpoint, params(prompt));
      await sendAnswer(ctx, title, extractApiText(payload));
    }
  };
}

function createOmegaCommand({ name, aliases = [], title, endpoint, params, paths, description }) {
  return {
    name,
    aliases,
    category: "AI & Chat",
    description,
    run: async ctx => {
      const prompt = requirePrompt(ctx);
      const payload = await requestExternalJson(OMEGATECH + endpoint, params(prompt));
      const answer = valueAt(payload, paths || []) || extractApiText(payload);
      await sendAnswer(ctx, title, answer);
    }
  };
}

export async function requestSummary(prompt) {
  const source = String(prompt || "").trim();
  if (!source) throw new Error("The summary prompt is empty.");
  const style = "Summarize clearly in about 180–300 words. Do not invent details. Use concise bullets and moderate spacing. Use single asterisks for WhatsApp bold.";
  const payload = await requestExternalJson(OMEGATECH + "/ai/Deepseek", {
    action: "chat",
    message: source + "\n\n" + style
  });
  return valueAt(payload, ["result", "answer", "data.answer", "reply", "data.reply", "response"]) ||
    extractApiText(payload);
}

export default [
  createOmegaCommand({
    name: "claude",
    aliases: ["ai"],
    title: "🧠 CLAUDE OPUS",
    endpoint: "/ai/Claude",
    params: message => ({ action: "chat", message }),
    paths: ["result", "answer", "data.answer", "reply", "data.reply"],
    description: "Claude Opus 5.5 — careful, nuanced reasoning."
  }),
  createOmegaCommand({
    name: "gemini",
    aliases: ["ask"],
    title: "✨ GEMINI",
    endpoint: "/ai/Gemini",
    params: message => ({ action: "chat", message }),
    paths: ["result", "answer", "data.answer", "reply", "data.reply"],
    description: "Gemini 4 Argon — creative, imaginative answers."
  }),
  createOmegaCommand({
    name: "grok",
    title: "🤖 GROK",
    endpoint: "/ai/Grok",
    params: message => ({ action: "chat", message }),
    paths: ["result", "answer", "data.answer", "reply", "data.reply"],
    description: "Witty, bold answers, Grok-style (my built-in brains)."
  }),
  {
    name: "gpt",
    category: "AI & Chat",
    description: "Ask a conversational AI with an optional response style.",
    run: async ctx => {
      const raw = requirePrompt(ctx, "your question | optional response style");
      const [questionPart, ...styleParts] = raw.split("|");
      const question = questionPart.trim();
      const style = styleParts.join("|").trim() || "be friendly and helpful";
      if (!question) throw new Error("Provide a question before the optional style.");
      if (style.length > 300) throw new Error("Keep the response style under 300 characters.");
    const payload = await requestExternalJson(OMEGATECH + "/ai/Claude", {
      action: "chat",
      message: question + "\n\n(Respond in this style: " + style + ")"
    });
    await sendAnswer(ctx, "🧠 GPT", valueAt(payload, ["result", "answer", "data.answer", "reply"]) ||
      extractApiText(payload));
    }
  },
  {
    name: "chatgpt",
    category: "AI & Chat",
    description: "Smart router — reads your question and picks the best brain for it: code, maths, creative or quick answers",
    run: async ctx => {
      const prompt = requirePrompt(ctx);
      const lower = prompt.toLowerCase();
      const wantsMaths = /\d\s*[-+*/^%]\s*\d|\bsolve|equation|integral|derivative|percentage|fraction\b/.test(lower);
      const wantsCode = /\bcode|function|bug|error|javascript|python|css|html|sql|api|regex|compile|debug\b/.test(lower);
      const wantsCreative = /\bstory|poem|poetry|lyrics|creative|imagine|caption|slogan|name ideas|essay\b/.test(lower);
      const endpoint = wantsMaths ? "/ai/Deepseek"
        : wantsCode ? "/ai/Claude"
        : wantsCreative ? "/ai/Gemini"
        : "/ai/Claude";
      const title = wantsMaths ? "🧠 SMART ROUTE → DEEPSEEK (MATHS)"
        : wantsCode ? "🧠 SMART ROUTE → CLAUDE (CODE)"
        : wantsCreative ? "🧠 SMART ROUTE → GEMINI (CREATIVE)"
        : "🧠 SMART ROUTE → CLAUDE";
      const payload = await requestExternalJson(OMEGATECH + endpoint, {
        action: "chat",
        message: prompt
      });
      const answer = valueAt(payload, ["result", "answer", "data.answer", "reply", "data.reply"]) ||
        extractApiText(payload);
      await sendAnswer(ctx, title, answer);
    }
  },
  {
    name: "mathgpt",
    category: "AI & Chat",
    description: "Solves maths step by step",
    run: async ctx => {
      const prompt = requirePrompt(ctx);
      const payload = await requestExternalJson(OMEGATECH + "/ai/Deepseek", {
        action: "chat",
        message: "Solve this step by step, showing every step clearly. End with the final answer on its own line.\n\n" + prompt
      });
      const answer = valueAt(payload, ["result", "answer", "data.answer", "reply", "data.reply"]) ||
        extractApiText(payload);
      await sendAnswer(ctx, "➗ MATHGPT", answer);
    }
  },
  createOmegaCommand({
    name: "deepseek",
    title: "🧠 DEEPSEEK",
    endpoint: "/ai/Deepseek",
    params: message => ({ action: "chat", message }),
    paths: ["result", "answer", "data.answer", "reply", "data.reply"],
    description: "Ask DeepSeek a question."
  }),
  {
    name: "translate",
    category: "AI & Chat",
    description: "Translate text into a requested language.",
    run: async ctx => {
      const raw = requirePrompt(ctx, "Spanish | Good morning, how are you?");
      const separator = raw.indexOf("|");
      if (separator < 1 || !raw.slice(separator + 1).trim()) {
        throw new Error("Usage: " + ctx.config.prefix + "translate Spanish | Good morning, how are you?");
      }
      const language = raw.slice(0, separator).trim().slice(0, 80);
      const source = raw.slice(separator + 1).trim();
      const query = "Translate the following text into " + language +
        ". Return only the translation, with no explanation:\n\n" + source;
      const payload = await requestExternalJson(OMEGATECH + "/ai/Claude", {
        action: "chat",
        message: query
      });
      await sendAnswer(ctx, "🌍 TRANSLATION · " + language.toUpperCase(),
        valueAt(payload, ["result", "answer", "data.answer", "reply"]) || extractApiText(payload));
    }
  },
  {
    name: "summarize",
    aliases: ["summary"],
    category: "AI & Chat",
    description: "Summarize text into clear, concise points.",
    run: async ctx => {
      const answer = await requestSummary(requirePrompt(ctx, "paste the text you want summarized"));
      await sendAnswer(ctx, "📚 SUMMARY", answer);
    }
  },
  createOmegaCommand({
    name: "fable",
    aliases: ["fable5"],
    title: "🧠 CLAUDE FABLE 5",
    endpoint: "/ai/Secret",
    params: message => ({ action: "chat", message }),
    paths: ["data.reply", "reply", "data.response", "result"],
    description: "Claude Fable 5.2 — the storyteller, best for stories & creative writing."
  }),
  createOmegaCommand({
    name: "qwen",
    title: "🧠 QWEN",
    endpoint: "/ai/Qwen-Claude-Haiku",
    params: message => ({ message, model: "qwen" }),
    paths: ["answer", "data.answer", "reply", "data.reply", "response"],
    description: "Ask the Qwen model a question."
  }),
  createOmegaCommand({
    name: "deepseek2",
    title: "🧠 DEEPSEEK V3.2",
    endpoint: "/ai/Deepseek",
    params: message => ({ message, model: "v32" }),
    paths: ["answer", "data.answer", "reply", "data.reply"],
    description: "Ask the DeepSeek V3.2 model."
  })
];
