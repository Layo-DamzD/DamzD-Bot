// Live check of the three song sources from this sandbox, so the
// recommendation is based on what actually answers today.
import { searchYouTubeNabees, resolveYouTubeAudioNabees } from "/home/z/my-project/damzd/src/downloads.js";
import { searchSong as saavnSearch } from "/home/z/my-project/damzd/src/saavn.js";
import { searchYouTubeAudio } from "/home/z/my-project/damzd/src/downloads.js";

const obscure = "altare bye";
const mainstream = "Calm Down Rema";

// 1. JioSaavn — the no-key workhorse.
for (const q of [mainstream, obscure]) {
  try {
    const hit = await saavnSearch(q, null);
    console.log("SAAVN ", q.padEnd(22), hit ? "OK  " + String(hit.title).slice(0, 40) : "no confident match");
  } catch (e) {
    console.log("SAAVN ", q.padEnd(22), "ERR " + String(e.message || e).slice(0, 50));
  }
}

// 2. NABEES with the shared public key — quota check.
try {
  const found = await searchYouTubeNabees(obscure);
  const audio = await resolveYouTubeAudioNabees(found.url);
  console.log("NABEES", obscure.padEnd(22), "OK " + String(audio.title).slice(0, 40));
} catch (e) {
  console.log("NABEES", obscure.padEnd(22), "ERR " + String(e.message || e).slice(0, 60));
}

// 3. Keyless Piped end-to-end — the route the bot falls back to.
try {
  const r = await searchYouTubeAudio(obscure);
  console.log("PIPED ", obscure.padEnd(22), "OK " + String(r.title).slice(0, 40));
} catch (e) {
  console.log("PIPED ", obscure.padEnd(22), "ERR " + String(e.message || e).slice(0, 60));
}
