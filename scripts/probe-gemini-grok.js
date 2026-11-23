// Probe the owner's Puter tokens live: which Gemini and Grok model names
// actually answer today. Prints PASS/FAIL per candidate so ai.js can pin
// the working names. Reads the token from damzd/.env if present.
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.argv[2] || "/home/z/my-project/damzd/.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const tokens = String(process.env.PUTER_AUTH_TOKEN || process.env.GROQ_API_KEY || "")
  .split(",").map(t => t.trim()).filter(Boolean);
if (!tokens.length) {
  console.log("NO TOKENS — put tokens in damzd/.env as PUTER_AUTH_TOKEN=a,b,c");
  process.exit(0);
}

const { init } = await import("/home/z/my-project/damzd/node_modules/@heyputer/puter.js/src/init.cjs");
const puter = init(tokens[0]);

function extract(result) {
  const content = result?.message?.content ?? result?.toString?.() ?? result;
  if (Array.isArray(content)) return content.map(p => (typeof p === "string" ? p : p?.text || "")).join("").trim();
  return String(content || "").trim();
}

// Gemini and Grok candidates — shorthand first, provider-prefixed second.
const candidates = [
  ["gemini", "google:google/gemini-2.5-flash"],
  ["gemini-3.8-flash", "google:google/gemini-3.8-flash"],
  ["gemini-4-argon", "google:google/gemini-4-argon"],
  ["grok", "xai:xai/grok-4"],
  ["grok-4", "xai:xai/grok-4"],
  ["grok-4.1", "xai:xai/grok-4.1"],
  ["grok-code-fast", "xai:xai/grok-code-fast-1"]
];

for (const [plain, prefixed] of candidates) {
  for (const model of [...new Set([plain, prefixed])]) {
    try {
      const answer = await Promise.race([
        puter.ai.chat([{ role: "user", content: "Say OK." }], { model }),
        new Promise((_r, reject) => setTimeout(() => reject(new Error("timeout")), 45000))
      ]);
      const text = extract(answer);
      console.log(text ? "PASS  " + model + "  -> " + text.slice(0, 40) : "EMPTY " + model);
    } catch (error) {
      console.log("FAIL  " + model + "  (" + String(error?.message || error).slice(0, 60) + ")");
    }
  }
}
