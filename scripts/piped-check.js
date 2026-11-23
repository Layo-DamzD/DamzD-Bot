// One-shot diagnostic: does the live Piped instance return a full audio URL
// for the exact song the user failed on? Run: node scripts/piped-check.js
const API = "https://api.piped.private.coffee";

const search = await fetch(API + "/search?q=" + encodeURIComponent("altare bye") + "&filter=music_songs")
  .then(r => r.json())
  .catch(e => ({ error: String(e.message) }));
const items = search.items || [];
console.log("search items:", items.length);
const hit = items.find(i => String(i.url || "").includes("watch?v="));
console.log("hit:", hit?.title, hit?.url);
if (!hit) process.exit(0);

const id = hit.url.split("watch?v=")[1].split("&")[0];
const streams = await fetch(API + "/streams/" + id)
  .then(r => r.json())
  .catch(e => ({ error: String(e.message) }));
const audio = (streams.audioStreams || []).filter(s => s.bitrate).sort((a, b) => b.bitrate - a.bitrate);
console.log("title:", streams.title);
console.log("audio streams:", audio.length);
const best = audio[0];
console.log("best:", best?.bitrate, best?.mimeType);
if (best?.url) {
  const head = await fetch(best.url, { method: "GET", headers: { Range: "bytes=0-1023" } }).catch(e => null);
  console.log("probe status:", head?.status, "content-type:", head?.headers?.get("content-type"));
}
