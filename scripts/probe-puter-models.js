// Load the token straight from damzd/.env (no dotenv dep next to this script).
import fs from "node:fs";
for (const line of fs.readFileSync("/home/z/my-project/damzd/.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
// Probe the latest Puter models found in the live catalog (942 models).
// For each candidate: try the plain shorthand name first, then the
// provider-prefixed form. Prints PASS with the working name for ai.js.
const tokens = String(process.env.PUTER_AUTH_TOKEN || "").split(",").map(t => t.trim()).filter(Boolean);
const token = tokens[0];
const { init } = await import("/home/z/my-project/damzd/node_modules/@heyputer/puter.js/src/init.cjs");
const puter = init(token);

function extract(result) {
  const content = result?.message?.content ?? result?.toString?.() ?? result;
  if (Array.isArray(content)) return content.map(p => (typeof p === "string" ? p : p?.text || "")).join("").trim();
  return String(content || "").trim();
}

const candidates = [
  ["gpt-6-astra", "openai:openai/gpt-6-astra"],
  ["gpt-6.1-sol", "openai:openai/gpt-6.1-sol"],
  ["gpt-6.1-terra", "openai:openai/gpt-6.1-terra"],
  ["gpt-6-luna", "openai:openai/gpt-6-luna"],
  ["claude-opus-5-5", "anthropic:anthropic/claude-opus-5-5"],
  ["claude-opus-5-5", "infron:anthropic/claude-opus-5.5"],
  ["claude-sonnet-5-5", "anthropic:anthropic/claude-sonnet-5-5"],
  ["claude-fable-5-2", "anthropic:anthropic/claude-fable-5-2"],
  ["claude-fable-5-2", "openrouter:anthropic/claude-fable-5.2"],
  ["gemini-4-argon", "google:google/gemini-4-argon"],
  ["gemini-3.8-flash", "google:google/gemini-3.8-flash"],
  ["gpt-5.4-nano", "azure:openai/gpt-5.4-nano"]
];

const results = [];
for (const [plain, prefixed] of candidates) {
  let ok = null;
  for (const model of [plain, prefixed]) {
    if (results.some(r => r.model === model)) continue;
    try {
      const answer = await Promise.race([
        puter.ai.chat([{ role: "user", content: "Reply with exactly: OK" }], { model }),
        new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout 45s")), 45000))
      ]);
      const text = extract(answer);
      if (text) {
        results.push({ model, sample: text.slice(0, 40) });
        ok = model;
        break;
      }
    } catch (error) {
      // try the next form
    }
  }
  console.log((ok ? "PASS" : "FAIL") + " — " + plain + (ok ? "  → working as: " + ok : "  (both forms failed)"));
}

console.log("\n--- working model IDs ---");
for (const r of results) console.log(r.model + "   (\"" + r.sample + "\")");
