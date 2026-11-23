// Live-test the 5 TTS endpoints on api.omegatech.app to pick the best
// engine for .ttsm (male) and .ttsf (female).
const API = "https://api.omegatech.app/api";

const tests = [
  { name: "tts  /ai/clideo (NORMAL)", url: API + "/ai/clideo", params: { action: "generate", text: "Hello from DamzD bot, testing male voice.", mood: "NORMAL" }, paths: ["data.previewUrl", "previewUrl"] },
  { name: "tts2 /ai/Gemini-tts", url: API + "/ai/Gemini-tts", params: { text: "Hello from DamzD bot, testing voice." }, paths: ["result", "data.result", "audio"] },
  { name: "tts3 /ai/text2speech-v3", url: API + "/ai/text2speech-v3", params: { text: "Hello from DamzD bot, testing voice.", voice: "woman1", language: "English" }, paths: ["audio", "data.audio", "result"] },
  { name: "tts4 /ai/text-to-speech2", url: API + "/ai/text-to-speech2", params: { text: "Hello from DamzD bot, testing voice.", voice: "NORMAL MALE" }, paths: ["result", "data.result", "audio"] },
  { name: "tts5 /ai/Multi-Text-to-speech", url: API + "/ai/Multi-Text-to-speech", params: { action: "tts", text: "Hello from DamzD bot, testing voice." }, paths: ["data.audio_url", "audio_url", "result"] }
];

function valueAt(payload, paths) {
  for (const path of paths) {
    let value = payload;
    for (const key of path.split(".")) value = value && value[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

for (const t of tests) {
  try {
    const res = await fetch(t.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(t.params),
      signal: AbortSignal.timeout(60000)
    });
    const text = await res.text();
    let payload = {};
    try { payload = JSON.parse(text); } catch { /* html error page */ }
    const audio = valueAt(payload, t.paths);
    let verdict = "no audio url in: " + text.slice(0, 120).replace(/\s+/g, " ");
    if (audio && audio.startsWith("http")) {
      try {
        const head = await fetch(audio, { method: "GET", headers: { range: "bytes=0-512" }, signal: AbortSignal.timeout(30000) });
        verdict = "AUDIO OK — HTTP " + head.status + " | " + (head.headers.get("content-type") || "?") +
          " | " + (head.headers.get("content-range") || head.headers.get("content-length") || "?") + " bytes";
      } catch (e) {
        verdict = "url failed: " + String(e.cause?.code || e.message).slice(0, 60);
      }
    }
    console.log(t.name.padEnd(30), "| HTTP", res.status, "|", verdict.slice(0, 130));
  } catch (e) {
    console.log(t.name.padEnd(30), "| FAIL", String(e.cause?.code || e.message).slice(0, 70));
  }
}

// also test voice options for the winner — try male/female voices on v3 and tts4
console.log("\n-- voice variants --");
const variants = [
  ["v3 man1", API + "/ai/text2speech-v3", { text: "Testing male voice one.", voice: "man1", language: "English" }, ["audio", "data.audio", "result"]],
  ["v3 man2", API + "/ai/text2speech-v3", { text: "Testing male voice two.", voice: "man2", language: "English" }, ["audio", "data.audio", "result"]],
  ["v4 FEMALE", API + "/ai/text-to-speech2", { text: "Testing female voice.", voice: "FEMALE" }, ["result", "data.result", "audio"]],
  ["v4 NORMAL FEMALE", API + "/ai/text-to-speech2", { text: "Testing normal female voice.", voice: "NORMAL FEMALE" }, ["result", "data.result", "audio"]]
];
for (const [label, url, params, paths] of variants) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(60000) });
    const payload = await res.json().catch(() => ({}));
    const audio = valueAt(payload, paths);
    console.log(label.padEnd(20), "| HTTP", res.status, "|", audio ? audio.slice(0, 90) : "no url");
  } catch (e) {
    console.log(label.padEnd(20), "| FAIL", String(e.cause?.code || e.message).slice(0, 60));
  }
}
