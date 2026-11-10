import { config, hasAIBrain } from "./config.js";

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

// Puter — the owner's free Puter account (PUTER_AUTH_TOKEN) unlocks the REAL
// flagship models: Claude, GPT and Gemini, through puter.ai.chat. The SDK is
// imported lazily so the bot still boots fine before the package or token
// exists — that brain simply sleeps and the standard chain answers instead.
let puterClient = null;
async function getPuter() {
  const token = String(process.env.PUTER_AUTH_TOKEN || "").trim();
  if (!token) throw new Error("no-key");
  if (!puterClient) {
    const { init } = await import("@heyputer/puter.js/src/init.cjs");
    puterClient = init(token);
  }
  return puterClient;
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
  const puter = await getPuter();
  const answer = await Promise.race([
    puter.ai.chat(chat, { model }),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("the Puter model took too long")), 90000))
  ]);
  const text = puterText(answer);
  if (!text) throw new Error("the Puter model had nothing to say.");
  return stripThinking(text);
}

// Named brains for the per-model commands (.chatgpt, .llama, .luna, .deepseek).
// Each one is a REAL model behind a free service — not a persona wearing a
// name. When a brain is unavailable (no key yet, sleeping service) askAI
// quietly continues down the standard chain, so a command never dead-ends.
const BRAINS = {
  "puter-claude": chat => callPuterModel(chat, "claude-sonnet-4-6"),
  "puter-gpt": chat => callPuterModel(chat, "gpt-5.4-nano"),
  "puter-gemini": chat => callPuterModel(chat, "gemini-3.1-flash-lite"),
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
        const run = BRAINS[brain];
        if (run) return await run(chat);
      } catch {
        continue; // that brain is asleep or keyless — the standard chain answers
      }
    }
  }
  const failures = [];
  if (config.groq.apiKey) {
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
