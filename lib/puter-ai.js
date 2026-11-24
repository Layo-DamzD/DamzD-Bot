// DamzD's Puter bridge — the owner's tokens (PUTER_AUTH_TOKEN, comma
// separated) unlock the real flagship models through puter.ai.chat. Calls
// rotate through the accounts round-robin; a failing account is skipped for
// that request. With no tokens the keyless Pollinations service answers
// instead, so the commands never dead-end.
//
// Model names below were verified live against the owner's accounts:
//   gemini: gemini-4-argon / gemini-3.8-flash (google: prefixed as fallback)
//   grok:   infron:x-ai/grok-4.6 (4.5, 4.3 as fallbacks — plain "grok-4"
//           names are NOT in Puter's catalog; the prefixed form is required)

const MODEL_LADDERS = {
  gemini: ["gemini-4-argon", "google:google/gemini-4-argon", "gemini-3.8-flash", "google:google/gemini-2.5-flash"],
  grok: ["infron:x-ai/grok-4.6", "infron:x-ai/grok-4.5", "infron:x-ai/grok-4.3", "azure:x-ai/grok-4.3"]
};

let puterCursor = 0;
const puterClients = new Map();

export function puterTokens() {
  return [...new Set(
    String(process.env.PUTER_AUTH_TOKEN || process.env.GROQ_API_KEY || "")
      .split(",")
      .map(token => token.trim())
      .filter(Boolean)
  )];
}

async function getPuterFor(token) {
  if (!puterClients.has(token)) {
    const { init } = await import("@heyputer/puter.js/src/init.cjs");
    puterClients.set(token, init(token));
  }
  return puterClients.get(token);
}

function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

function puterText(result) {
  const content = result?.message?.content ?? result?.toString?.() ?? result;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  }
  return String(content || "").trim();
}

async function callPuterModel(chat, model) {
  const tokens = puterTokens();
  if (!tokens.length) throw new Error("no-key");
  let lastError = null;
  for (let attempt = 0; attempt < tokens.length; attempt++) {
    const token = tokens[(puterCursor + attempt) % tokens.length];
    try {
      const puter = await getPuterFor(token);
      const answer = await Promise.race([
        puter.ai.chat(chat, { model }),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("the model took too long")), 90000))
      ]);
      const text = puterText(answer);
      if (!text) throw new Error("the model had nothing to say.");
      puterCursor = (puterCursor + attempt + 1) % tokens.length;
      return stripThinking(text);
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError || new Error("the accounts are quiet right now.");
}

// Keyless fallback so the commands keep working even without tokens.
async function callPollinations(chat) {
  const response = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "openai", messages: chat }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error("the free AI service refused that request.");
  const payload = await response.json().catch(() => null);
  const text = payload?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error("the free AI service had nothing to say.");
  return stripThinking(text);
}

// Ask a named family ("gemini" | "grok") — walks its model ladder across the
// token pool, then falls back to the keyless service. Returns the answer
// text plus which model actually produced it (for the command's header).
export async function askPuterFamily({ prompt, family, system }) {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) throw new Error("the question is empty.");
  const chat = [
    ...(system ? [{ role: "system", content: String(system).slice(0, 1200) }] : []),
    { role: "user", content: trimmed.slice(0, 3500) }
  ];

  const failures = [];
  if (puterTokens().length) {
    for (const model of MODEL_LADDERS[family] || []) {
      try {
        const text = await callPuterModel(chat, model);
        return { text, model };
      } catch (error) {
        failures.push(model + ": " + String(error?.message || error).slice(0, 80));
      }
    }
  }
  try {
    return { text: await callPollinations(chat), model: "pollinations" };
  } catch (error) {
    failures.push("free: " + String(error?.message || error).slice(0, 80));
    throw new Error("every AI service is quiet right now. Try again in a moment." +
      (failures.length ? " (" + failures[0] + ")" : ""));
  }
}
