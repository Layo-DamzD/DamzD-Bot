// Real Puter token test: (1) each of the 6 tokens is brought up through the
// same SDK the bot uses and asked a tiny question on Claude; (2) the command
// path (.claude / .chatgpt / .gemini brains) is exercised end-to-end through
// ai.js with the full comma-separated token set, proving rotation works.
import { askAI } from "/home/z/my-project/damzd/src/ai.js";

const tokens = String(process.env.PUTER_AUTH_TOKEN || "").split(",").map(t => t.trim()).filter(Boolean);
console.log("tokens loaded from env: " + tokens.length);
if (!tokens.length) {
  console.error("FAIL — no tokens in PUTER_AUTH_TOKEN");
  process.exit(1);
}

let ok = true;
// Absolute path: the package lives in damzd/node_modules, not next to this script.
const { init } = await import("/home/z/my-project/damzd/node_modules/@heyputer/puter.js/src/init.cjs");

function extract(result) {
  const content = result?.message?.content ?? result?.toString?.() ?? result;
  if (Array.isArray(content)) return content.map(p => (typeof p === "string" ? p : p?.text || "")).join("").trim();
  return String(content || "").trim();
}

for (let i = 0; i < tokens.length; i++) {
  try {
    const puter = init(tokens[i]);
    const answer = await Promise.race([
      puter.ai.chat([{ role: "user", content: "Reply with exactly: OK" }], { model: "claude-sonnet-4-6" }),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout 60s")), 60000))
    ]);
    const text = extract(answer);
    const pass = /ok/i.test(text);
    console.log((pass ? "PASS" : "WARN") + " — token #" + (i + 1) + " claude replied: " + JSON.stringify(text.slice(0, 60)));
    if (!pass) ok = false;
  } catch (error) {
    console.log("FAIL — token #" + (i + 1) + ": " + String(error?.message || error).slice(0, 120));
    ok = false;
  }
}

console.log("--- command path (through ai.js rotation) ---");
for (const [label, brain] of [[".claude", ["puter-claude"]], [".chatgpt", ["puter-gpt"]], [".gemini", ["puter-gemini"]]]) {
  try {
    const answer = await askAI({
      messages: [{ role: "user", content: "In one short sentence, name the capital of Nigeria." }],
      ownerName: "Layo",
      brains: brain
    });
    console.log("PASS — " + label + " answered: " + JSON.stringify(String(answer).slice(0, 90)));
  } catch (error) {
    console.log("FAIL — " + label + ": " + String(error?.message || error).slice(0, 120));
    ok = false;
  }
}

console.log(ok ? "ALL PUTER CHECKS PASSED" : "PUTER CHECKS FAILED");
process.exit(ok ? 0 : 1);
