// Live end-to-end proof: the bot's own YouTube rescue path, no env key set.
import { searchYouTubeNabees, resolveYouTubeAudioNabees } from "../damzd/src/downloads.js";
import { fetchBuffer } from "../damzd/src/apis.js";

const query = process.argv[2] || "altare bye";
try {
  const found = await searchYouTubeNabees(query);
  console.log("search:", found.title, "|", found.url);
  const audio = await resolveYouTubeAudioNabees(found.url);
  console.log("resolved:", audio.title, "|", audio.url.slice(0, 60) + "…");
  const buffer = await fetchBuffer(audio.url, { timeoutMs: 90000, label: "rescue stream" });
  const ok = buffer.length >= 150 * 1024;
  console.log("bytes:", buffer.length, ok ? "— PASSES the 150KB verified-audio gate" : "— FAILS the gate");
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.log("FAILED:", error.message);
  process.exit(1);
}
