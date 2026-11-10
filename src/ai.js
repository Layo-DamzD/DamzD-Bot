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

export async function askAI({ messages, ownerName, style } = {}) {
  const chat = [
    { role: "system", content: systemPrompt({ ownerName, style }) },
    ...(Array.isArray(messages) ? messages.slice(-18) : [])
  ];
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
  return callPollinations(chat);
}

export async function askAIAboutText({ prompt, history = [], ownerName, style } = {}) {
  const messages = [
    ...history,
    { role: "user", content: String(prompt || "").slice(0, 3500) }
  ];
  return askAI({ messages, ownerName, style });
}
