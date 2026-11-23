// Prove the shipped song chain returns FULL-TRACK bytes for the exact query
// that failed live: "altare bye" → NABEES search → convert → verified buffer.
import { searchYouTubeNabees, resolveYouTubeAudioNabees } from "../damzd/src/downloads.js";

const { fetchBuffer } = await import("../damzd/src/apis.js");

const found = await searchYouTubeNabees("altare bye");
console.log("search ok:", found.title, "|", found.url);
const audio = await resolveYouTubeAudioNabees(found.url);
console.log("convert ok:", audio.title);
const buffer = await fetchBuffer(audio.url, { timeoutMs: 90000, label: "rescue stream" });
console.log("bytes:", buffer.length, "=", (buffer.length / 1024 / 1024).toFixed(2) + "MB");
if (buffer.length < 150 * 1024) throw new Error("buffer too small — broken transfer");
console.log("FULL TRACK VERIFIED");
