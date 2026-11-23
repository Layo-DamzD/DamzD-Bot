// Verify the exact grok model names from the catalog actually answer on the
// owner's tokens (the catalog lists them, but only a live chat proves it).
import fs from "node:fs";
const envPath = "/home/z/my-project/download/puter-token-for-render.txt";
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^(PUTER_AUTH_TOKEN)=([A-Za-z0-9._,-]+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const tokens = String(process.env.PUTER_AUTH_TOKEN || "").split(",").filter(Boolean);
const { init } = await import("/home/z/my-project/damzd/node_modules/@heyputer/puter.js/src/init.cjs");
const puter = init(tokens[0]);

function extract(result) {
  const content = result?.message?.content ?? result?.toString?.() ?? result;
  if (Array.isArray(content)) return content.map(p => (typeof p === "string" ? p : p?.text || "")).join("").trim();
  return String(content || "").trim();
}

for (const model of [
  "infron:x-ai/grok-4.6",
  "infron:x-ai/grok-4.5",
  "infron:x-ai/grok-4.3",
  "azure:x-ai/grok-4.3",
  "infron:x-ai/grok-4.2-reasoning"
]) {
  try {
    const answer = await Promise.race([
      puter.ai.chat([{ role: "user", content: "Say OK." }], { model }),
      new Promise((_r, reject) => setTimeout(() => reject(new Error("timeout")), 45000))
    ]);
    const text = extract(answer);
    console.log(text ? "PASS  " + model + " -> " + text.slice(0, 30) : "EMPTY " + model);
  } catch (error) {
    console.log("FAIL  " + model + " (" + String(error?.message || error).slice(0, 50) + ")");
  }
}
