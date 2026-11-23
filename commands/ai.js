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

function createOmegaCommand({ name, title, endpoint, params, paths, description }) {
  return {
    name,
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
  try {
    const payload = await requestApiJson("gptlogic", { q: source, prompt: style });
    return extractApiText(payload);
  } catch {
    const payload = await requestExternalJson(OMEGATECH + "/ai/Qwen-Claude-Haiku", {
      message: source + "\n\n" + style,
      model: "qwen"
    });
    return valueAt(payload, ["answer", "data.answer", "reply", "data.reply", "response"]) || extractApiText(payload);
  }
}

export default [
  createSimpleCommand({
    name: "ai",
    aliases: ["claude"],
    title: "🧠 AI ASSISTANT",
    endpoint: "claude-haiku",
    params: prompt => ({ q: prompt }),
    description: "Ask the default Claude-powered AI assistant."
  }),
  createSimpleCommand({
    name: "ask",
    aliases: ["gemini"],
    title: "✨ GEMINI",
    endpoint: "gemini",
    params: prompt => ({ q: prompt }),
    description: "Ask the alternate Gemini AI assistant."
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
      const payload = await requestApiJson("gptlogic", { q: question, prompt: style });
      await sendAnswer(ctx, "🧠 GPT", extractApiText(payload));
    }
  },
  createSimpleCommand({
    name: "chatgpt",
    title: "💬 CHATGPT",
    endpoint: "https://eliteprotech-apis.zone.id/ai/chatgpt",
    params: prompt => ({ prompt }),
    external: true,
    description: "Ask the ChatGPT endpoint a question."
  }),
  createSimpleCommand({
    name: "mathgpt",
    title: "➗ MATHGPT",
    endpoint: "https://eliteprotech-apis.zone.id/ai/mathgpt",
    params: prompt => ({ q: prompt }),
    external: true,
    description: "Solve a maths problem with step-by-step guidance."
  }),
  createSimpleCommand({
    name: "deepseek",
    title: "🧠 DEEPSEEK",
    endpoint: "https://eliteprotech-apis.zone.id/ai/deepseekai",
    params: prompt => ({ prompt }),
    external: true,
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
      const payload = await requestApiJson("claude-haiku", { q: query });
      await sendAnswer(ctx, "🌍 TRANSLATION · " + language.toUpperCase(), extractApiText(payload));
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
    name: "fable5",
    title: "🧠 CLAUDE FABLE 5",
    endpoint: "/ai/Secret",
    params: message => ({ action: "chat", message }),
    paths: ["data.reply", "reply", "data.response"],
    description: "Ask the Claude Fable 5 model a question."
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
