import {
  extractApiText,
  requestApiJson,
  requestExternalJson,
  unicodeBox,
  withPoweredFooter
} from "../lib/api-client.js";
import { askPuterFamily } from "../lib/puter-ai.js";

const MAX_PROMPT = 3500;
const OMEGATECH = "https://api.omegatech.app/api";

// The owner's Puter-powered brains. Model ladders verified live:
// gemini-4-argon answers; grok only exists on Puter under its
// provider-prefixed names (infron:x-ai/grok-4.6 and friends).
function createPuterCommand({ name, aliases = [], family, title, description }) {
  return {
    name,
    aliases,
    category: "AI & Chat",
    description,
    run: async ctx => {
      const prompt = requirePrompt(ctx);
      const { text, model } = await askPuterFamily({
        prompt,
        family,
        system: "You are a helpful, direct assistant inside a WhatsApp bot. Answer in clean plain text; use *asterisks* for bold sparingly; no markdown headers, no bullet lists unless asked."
      });
      const via = model === "pollinations" ? " (free tier)" : "";
      await sendAnswer(ctx, title + via, text);
    }
  };
}

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
    endpoint: "/ai/Secret",
    params: message => ({ action: "chat", message }),
    paths: ["result", "answer", "data.answer", "reply", "data.reply"],
    description: "Claude Opus 5.5 — careful, nuanced reasoning."
  }),
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
      const endpoint = wantsMaths ? "/ai/Deepseek" : "/ai/Secret";
      const title = wantsMaths ? "🧠 SMART ROUTE → DEEPSEEK (MATHS)"
        : wantsCode ? "🧠 SMART ROUTE → CLAUDE (CODE)"
        : wantsCreative ? "🧠 SMART ROUTE → CLAUDE (CREATIVE)"
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
      const payload = await requestExternalJson(OMEGATECH + "/ai/Secret", {
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
  {
    name: "fable",
    aliases: ["fable5"],
    category: "AI & Chat",
    description: "Claude smart router — picks the best brain: Claude for stories/code/reasoning, Deepseek for maths, Gemini for wild ideas.",
    run: async ctx => {
      const prompt = requirePrompt(ctx);
      const lower = prompt.toLowerCase();
      const wantsMaths = /\d\s*[-+*/^%]\s*\d|\bsolve|equation|integral|derivative|percentage|fraction\b/.test(lower);
      const wantsCode = /\bcode|function|bug|error|javascript|python|css|html|sql|api|regex|compile|debug\b/.test(lower);
      const wantsCreative = /\bstory|poem|poetry|lyrics|creative|imagine|caption|slogan|name ideas|essay|fable|tale|novel|plot\b/.test(lower);
      // Endpoint reality (verified live): /ai/Claude, /ai/Gemini, /ai/Grok and
      // /ai/Qwen-Claude-Haiku are dead (404/500). /ai/Deepseek and /ai/Secret
      // (the Claude-backed fable brain) answer. The router stays smart but
      // only picks between providers that actually work.
      const endpoint = wantsMaths ? "/ai/Deepseek" : "/ai/Secret";
      const title = wantsMaths ? "🧠 FABLE ROUTE → DEEPSEEK (MATHS)"
        : wantsCode ? "🧠 FABLE ROUTE → CLAUDE (CODE)"
        : wantsCreative ? "🧠 FABLE ROUTE → CLAUDE (CREATIVE)"
        : "🧠 FABLE ROUTE → CLAUDE";
      const payload = await requestExternalJson(OMEGATECH + endpoint, {
        action: "chat",
        message: prompt
      });
      const answer = valueAt(payload, ["result", "answer", "data.answer", "reply", "data.reply"]) ||
        extractApiText(payload);
      await sendAnswer(ctx, title, answer);
    }
  },
  createPuterCommand({
    name: "gemini",
    title: "💎 GEMINI 4 ARGON",
    family: "gemini",
    description: "Google Gemini 4 Argon on the owner's Puter accounts — fast, broad-knowledge answers."
  }),
  createPuterCommand({
    name: "grok",
    title: "⚡ GROK 4.6",
    family: "grok",
    description: "xAI Grok 4.6 on the owner's Puter accounts — witty, direct takes."
  })
];
