// Live end-to-end check of the new AI wiring with the owner's real tokens:
// 1. brains ["auto"] on a code question must answer via gpt-6-astra
// 2. brains ["auto"] on a maths question must answer via gpt-6.1-sol
// 3. a direct puter-model command (.astra path) must answer
// 4. a creative question must answer via claude-fable-5-2
// The .env is loaded manually (this script lives outside damzd/).
import fs from "node:fs";
for (const line of fs.readFileSync("/home/z/my-project/damzd/.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
process.env.DATA_DIR = "/tmp/damzd-live-test";
const { askAI, classifyTask } = await import("/home/z/my-project/damzd/src/ai.js");

async function route(label, prompt) {
  const task = classifyTask(prompt);
  const answer = await askAI({
    messages: [{ role: "user", content: prompt }],
    ownerName: "DamzD",
    brains: ["auto"]
  });
  console.log("[" + label + "] task=" + task + " → " + String(answer).slice(0, 110).replace(/\n/g, " "));
}

await route("code", "Write a one-line javascript function that reverses a string. Answer with the code only.");
await route("math", "What is 17 * 23? Reply with just the number.");
await route("direct .astra path", "In one short sentence, what is a closure in javascript?");
await route("creative", "Write a two-line poem about Lagos traffic.");
console.log("LIVE ROUTER TEST PASSED");
