// List the live Puter model catalog, filtered for grok/xai and gemini/google,
// so .grok can pin a name that actually exists today.
import fs from "node:fs";

const envPath = "/home/z/my-project/download/puter-token-for-render.txt";
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^(PUTER_AUTH_TOKEN)=([A-Za-z0-9._,-]+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const tokens = String(process.env.PUTER_AUTH_TOKEN || "").split(",").map(t => t.trim()).filter(Boolean);
const { init } = await import("/home/z/my-project/damzd/node_modules/@heyputer/puter.js/src/init.cjs");
const puter = init(tokens[0]);

try {
  const res = await fetch("https://api.puter.com/puterai/chat/models", {
    headers: { Authorization: "Bearer " + tokens[0] }
  });
  const data = await res.json();
  const names = (Array.isArray(data) ? data : data?.models || data?.result || []).map(m =>
    typeof m === "string" ? m : (m?.id || m?.model || m?.name)
  ).filter(Boolean);
  console.log("catalog size:", names.length);
  console.log("GROK/XAI:", names.filter(n => /grok|xai/i.test(n)).slice(0, 20));
  console.log("GEMINI:", names.filter(n => /gemini/i.test(n)).slice(0, 20));
} catch (error) {
  console.log("catalog fetch failed:", String(error?.message || error).slice(0, 120));
  // fallback: use puter.ai itself
  const models = await puter.ai.listModels?.().catch?.(() => null);
  console.log("listModels:", models ? JSON.stringify(models).slice(0, 600) : "unavailable");
}
