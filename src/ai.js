import { config, hasAIBrain, childMode, puterTokens } from "./config.js";

export { hasAIBrain };

export function systemPrompt({ ownerName, style } = {}) {
  const base = [
    `You are ${config.name}, a calm, warm and well-mannered assistant chatting on WhatsApp.`,
    `You were set up by ${ownerName || config.ownerName}, and you help people with questions,`,
    "advice, explanations, quick tasks and friendly conversation.",

    "How you write:",
    "- Polite and composed. Proper, natural sentences — like a thoughtful person texting, not a call-centre script.",
    "- Keep it short: usually 1–4 sentences, unless the question truly needs more detail.",
    "- Plain WhatsApp text only. *Asterisks* make words bold on WhatsApp — use sparingly for emphasis.",
    "- At most one emoji per message, and only when it genuinely fits. Often none is better.",
    "- Never use robotic boilerplate: no stiff call-centre openers or closers, no 'Is there anything else', no sign-offs, no bullet lists unless the person asks for a list.",
    "- Never add signatures, footers, links or credits to your messages.",
    "- Never advertise anything. You are not here to promote any bot, service or channel.",

    "How you behave:",
    "- If asked whether you are a bot or an AI, answer honestly and lightly, then carry on with the conversation.",
    "- If you are unsure about something, say so plainly instead of inventing facts.",
    "- Match the language the person writes in.",
    "- You may be playful when the mood is playful, but you never lose your calm manners."
  ].join(" ");
  const flavour = String(style || "").trim();
  return flavour ? base + "\n\nSpecial mode for this request: " + flavour : base;
}

function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

async function callOpenAICompatible({ url, apiKey, model, messages, label, extraHeaders }) {
  if (!apiKey) throw new Error("no-key");
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey,
        ...(extraHeaders || {})
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: 900
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long to think. Try again in a moment.");
    }
    throw new Error("Could not reach the " + label + " right now. Please try again shortly.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The " + label + " reply was unreadable. Try again in a moment.");
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error || payload?.message;
    throw new Error(typeof detail === "string" && detail.trim()
      ? detail.trim().slice(0, 180)
      : "The " + label + " refused that request.");
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    throw new Error("The " + label + " had nothing to say. Try rephrasing that.");
  }
  return stripThinking(text);
}

async function callPollinations(messages) {
  let response;
  try {
    response = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai", messages }),
      signal: AbortSignal.timeout(90000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("the free AI service took too long. Try again in a moment.");
    }
    throw new Error("could not reach the free AI service right now.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("the free AI service returned something unreadable. Try again.");
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error || payload?.message;
    throw new Error(typeof detail === "string" && detail.trim()
      ? detail.trim().slice(0, 180)
      : "the free AI service refused that request.");
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    throw new Error("the free AI service had nothing to say. Try rephrasing.");
  }
  return stripThinking(text);
}

// NABEES free AI Studio models (GPT-5 Luna, DeepSeek) — the owner's one free
// key (same key that powers video downloads) unlocks these two real models.
// Kept last in the default chain so the daily quota stays for music.
async function callNabeesModel(chat, endpoint) {
  const apiKey = String(process.env.NABEES_API_KEY || "").trim();
  if (!apiKey) throw new Error("no-key");
  const system = chat.find(message => message.role === "system")?.content || "";
  const turns = chat
    .filter(message => message.role !== "system")
    .slice(-6)
    .map(message => (message.role === "assistant" ? "You said: " : "They said: ") + String(message.content || "").slice(0, 500));
  const prompt = (String(system).slice(0, 1200) + "\n\nConversation so far:\n" + turns.join("\n")).slice(0, 3500);
  const response = await fetch(
    "https://apis.nabeestech.com/api/v1/ai/" + endpoint + "?apikey=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: prompt }),
      signal: AbortSignal.timeout(90000)
    }
  );
  if (!response.ok) throw new Error("the NABEES studio refused that request.");
  const payload = await response.json().catch(() => null);
  const text = String(payload?.response || "").trim();
  if (!text) throw new Error("the NABEES studio had nothing to say.");
  return stripThinking(text);
}

async function callNabeesAI(chat) {
  for (const endpoint of ["gpt5-luna", "deepseek-v4-flash"]) {
    try {
      return await callNabeesModel(chat, endpoint);
    } catch {
      continue;
    }
  }
  throw new Error("the backup AI services had nothing to say. Try again in a moment.");
}

// Puter — the owner's free Puter accounts (PUTER_AUTH_TOKEN) unlock the REAL
// flagship models: Claude, GPT and Gemini, through puter.ai.chat. Several
// accounts can be supplied comma-separated; calls rotate through them
// round-robin and an account that fails (rate limit, asleep) is skipped for
// that request. The SDK is imported lazily so the bot still boots fine before
// the package or token exists — that brain simply sleeps and the standard
// chain answers instead.
// The owner's Puter tokens come from config (they are empty on child bots —
// children run on Groq only, the main bot on Puter flagships).
let puterCursor = 0;
const puterClients = new Map();
async function getPuterFor(token) {
  if (!puterClients.has(token)) {
    const { init } = await import("@heyputer/puter.js/src/init.cjs");
    puterClients.set(token, init(token));
  }
  return puterClients.get(token);
}

function puterText(result) {
  const content = result?.message?.content ?? result?.toString?.() ?? result;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
  }
  return String(content || "").trim();
}

async function callPuterModel(chat, model) {
  if (!puterTokens.length) throw new Error("no-key");
  let lastError = null;
  for (let attempt = 0; attempt < puterTokens.length; attempt++) {
    const token = puterTokens[(puterCursor + attempt) % puterTokens.length];
    try {
      const puter = await getPuterFor(token);
      const answer = await Promise.race([
        puter.ai.chat(chat, { model }),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("the Puter model took too long")), 90000))
      ]);
      const text = puterText(answer);
      if (!text) throw new Error("the Puter model had nothing to say.");
      // Success — the next call starts from the next account so the load and
      // the per-account free quotas spread evenly.
      puterCursor = (puterCursor + attempt + 1) % puterTokens.length;
      return stripThinking(text);
    } catch (error) {
      lastError = error;
      continue; // that account failed — try the next one on this same request
    }
  }
  throw lastError || new Error("the Puter models are quiet right now.");
}

// The latest flagships on Puter, each one probed live through puter.ai.chat
// with a plain shorthand name (13 Nov 2026 — all twelve answered "OK").
const PUTER_LATEST = {
  astra: "gpt-6-astra",         // GPT-6 Astra — the strongest coding brain
  sol: "gpt-6.1-sol",           // GPT-6.1 Sol — newest general flagship, deep reasoning
  terra: "gpt-6.1-terra",       // GPT-6.1 Terra — the third 6.1 flavour
  luna: "gpt-6-luna",           // GPT-6 Luna — fast, light, great for quick answers
  opus: "claude-opus-5-5",      // Claude Opus 5.5 — Anthropic's biggest
  sonnet: "claude-sonnet-5-5",  // Claude Sonnet 5.5 — the fast Claude
  fable: "claude-fable-5-2",    // Claude Fable 5.2 — Anthropic's storyteller family
  argon: "gemini-4-argon",      // Gemini 4 Argon — Google's newest flagship
  flash: "gemini-3.8-flash"     // Gemini 3.8 Flash — the quick Gemini
};

// The auto-router: read the question, decide what KIND of task it is, and
// send it to the brain that is best at that kind — Astra for code (the
// owner's pick), Sol for maths and general questions, Fable for stories and
// creative writing, Luna when speed matters more than depth. Every route
// keeps a fallback ladder under it so a sleeping model never dead-ends.
const TASK_ROUTES = {
  code: [PUTER_LATEST.astra, PUTER_LATEST.sol, PUTER_LATEST.luna],
  math: [PUTER_LATEST.sol, PUTER_LATEST.astra, PUTER_LATEST.luna],
  creative: [PUTER_LATEST.fable, PUTER_LATEST.sol, PUTER_LATEST.luna],
  translate: [PUTER_LATEST.luna, PUTER_LATEST.sol, PUTER_LATEST.astra],
  chat: [PUTER_LATEST.sol, PUTER_LATEST.astra, PUTER_LATEST.luna]
};

export function classifyTask(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (/(translate|translation|how do (you|i) say|what does .* mean in |in (yoruba|igbo|hausa|pidgin|french|spanish|german|arabic|chinese|japanese)\b)/.test(text)) return "translate";
  if (/(```|function\b|debug|bug\b|error\b|stack ?trace|code\b|coding|program|script\b|javascript|typescript|python\b|java\b|c\+\+|c#|php\b|sql\b|html\b|css\b|react\b|node\.?js|api\b|regex|algorithm|compile|npm\b|git\b|json\b|class \w|array\b|loop\b|variable|database|syntax)/.test(text)) return "code";
  if (/(solve|calculate|equation|arithmetic|\bmath|algebra|geometry|percentage|integral|derivative|probability|\d+\s*[+\-*/^×÷]\s*\d+)/.test(text)) return "math";
  if (/(story|poem|poetry|write me|write a|essay|lyrics|joke|caption|slogan|speech|imagine|roleplay|novel|rhyme|fairytale|fairy tale|bedtime)/.test(text)) return "creative";
  return "chat";
}

export function routeTask(prompt) {
  return TASK_ROUTES[classifyTask(prompt)] || TASK_ROUTES.chat;
}

// Walk a route's model ladder on Puter until one answers. Shared by the
// "auto" brain, the per-model commands and the main bot's standard chain.
async function runPuterRoute(chat, route) {
  let routeError = null;
  for (const model of route) {
    try {
      return await callPuterModel(chat, model);
    } catch (error) {
      routeError = error;
    }
  }
  throw routeError || new Error("no model on the route answered");
}

// Named brains for the per-model commands (.chatgpt, .llama, .luna, .deepseek).
// Each one is a REAL model behind a free service — not a persona wearing a
// name. When a brain is unavailable (no key yet, sleeping service) askAI
// quietly continues down the standard chain, so a command never dead-ends.
const BRAINS = {
  "puter-claude": chat => callPuterModel(chat, PUTER_LATEST.sonnet),
  "puter-gpt": chat => callPuterModel(chat, PUTER_LATEST.luna),
  "puter-gemini": chat => callPuterModel(chat, PUTER_LATEST.flash),
  groq: async chat => {
    if (!config.groq.apiKey) throw new Error("no-key");
    return callOpenAICompatible({
      url: config.groq.url,
      apiKey: config.groq.apiKey,
      model: config.groq.model,
      messages: chat,
      label: "AI service"
    });
  },
  openrouter: async chat => {
    if (!config.openrouter.apiKey) throw new Error("no-key");
    return callOpenAICompatible({
      url: config.openrouter.url,
      apiKey: config.openrouter.apiKey,
      model: config.openrouter.model,
      messages: chat,
      label: "backup AI service",
      extraHeaders: {
        "HTTP-Referer": "https://damzd.local",
        "X-Title": config.name
      }
    });
  },
  pollinations: chat => callPollinations(chat),
  "nabees-luna": chat => callNabeesModel(chat, "gpt5-luna"),
  "nabees-deepseek": chat => callNabeesModel(chat, "deepseek-v4-flash")
};

export async function askAI({ messages, ownerName, style, brains } = {}) {
  const chat = [
    { role: "system", content: systemPrompt({ ownerName, style }) },
    ...(Array.isArray(messages) ? messages.slice(-18) : [])
  ];
  // Per-model requests: try the named brains first, in order.
  if (Array.isArray(brains) && brains.length) {
    for (const brain of brains) {
      try {
        if (typeof brain === "string" && brain.startsWith("openrouter:")) {
          if (!config.openrouter.apiKey) throw new Error("no-key");
          return await callOpenAICompatible({
            url: config.openrouter.url,
            apiKey: config.openrouter.apiKey,
            model: brain.slice("openrouter:".length),
            messages: chat,
            label: "backup AI service",
            extraHeaders: {
              "HTTP-Referer": "https://damzd.local",
              "X-Title": config.name
            }
          });
        }
        // "puter-model:<id>" — one specific Puter model, e.g. .astra sends
        // "puter-model:gpt-6-astra". Fails over to the next brain on error.
        if (typeof brain === "string" && brain.startsWith("puter-model:")) {
          return await callPuterModel(chat, brain.slice("puter-model:".length));
        }
        // "auto" — the smart router: classify the question, then walk the
        // route's model ladder. If every model on the route fails, throw so
        // the next brain (or the standard chain below) takes over.
        if (brain === "auto") {
          const lastUser = [...chat].reverse().find(message => message.role === "user");
          return await runPuterRoute(chat, routeTask(lastUser?.content));
        }
        const run = BRAINS[brain];
        if (run) return await run(chat);
      } catch {
        continue; // that brain is asleep or keyless — the standard chain answers
      }
    }
  }
  const failures = [];
  // The AI split, applied to every plain chat (no explicit brain): the main
  // bot reads the question and sends it to the best Puter flagship, with
  // OpenRouter and the keyless services underneath — never Groq. A child bot
  // starts at Groq and never touches Puter or OpenRouter.
  if (!childMode) {
    if (puterTokens.length) {
      try {
        const lastUser = [...chat].reverse().find(message => message.role === "user");
        return await runPuterRoute(chat, routeTask(lastUser?.content));
      } catch (error) {
        failures.push(error?.message);
      }
    }
    if (config.openrouter.apiKey) {
      try {
        return await callOpenAICompatible({
          url: config.openrouter.url,
          apiKey: config.openrouter.apiKey,
          model: config.openrouter.model,
          messages: chat,
          label: "backup AI service",
          extraHeaders: {
            "HTTP-Referer": "https://damzd.local",
            "X-Title": config.name
          }
        });
      } catch (error) {
        failures.push(error?.message);
      }
    }
  } else if (config.groq.apiKey) {
    try {
      return await callOpenAICompatible({
        url: config.groq.url,
        apiKey: config.groq.apiKey,
        model: config.groq.model,
        messages: chat,
        label: "AI service"
      });
    } catch (error) {
      failures.push(error?.message);
    }
  }
  // Keyless fallback so the bot keeps chatting even before any API key is added.
  try {
    return await callPollinations(chat);
  } catch (error) {
    failures.push(error?.message);
  }
  // Last resort: the owner's free NABEES key unlocks GPT-5/DeepSeek models.
  try {
    return await callNabeesAI(chat);
  } catch {
    throw new Error("every AI service I know is quiet right now. Try again in a moment.");
  }
}

export async function askAIAboutText({ prompt, history = [], ownerName, style, brains } = {}) {
  const messages = [
    ...history,
    { role: "user", content: String(prompt || "").slice(0, 3500) }
  ];
  return askAI({ messages, ownerName, style, brains });
}
