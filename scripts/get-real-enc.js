// Fetch a real full-length encrypted_media_url and test the decrypt
// round-trip, so the unit test uses a genuine payload.
import { decryptMediaUrl } from "/home/z/my-project/damzd/lib/saavn-music.js";

const r = await fetch("https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&p=1&q=" + encodeURIComponent("Queen Bohemian Rhapsody"), {
  headers: { accept: "*/*", "user-agent": "Mozilla/5.0", origin: "https://www.jiosaavn.com", referer: "https://www.jiosaavn.com/" },
  signal: AbortSignal.timeout(20000)
});
const songs = (await r.json()).results || [];
console.log("results:", songs.length);
songs.slice(0, 4).forEach(s => console.log(" -", (s.singers || "?").slice(0, 24), "|", String(s.title).slice(0, 30)));
// singers can be empty — match via artistMap like the tier does
const queen = songs.find(s =>
  (String(s.singers || "") + (s.more_info?.artistMap?.primary_artists || []).map(a => a.name).join(",")).includes("Queen") &&
  !/karaoke|piano|2024/i.test(String(s.title)));
if (!queen) throw new Error("no Queen result this time");
const enc = queen.more_info.encrypted_media_url;
console.log("ENC(" + enc.length + "): " + enc);
const dec = decryptMediaUrl(enc);
console.log("DEC: " + dec.slice(0, 100));
console.log(dec.includes("_96.mp4") ? "OK-96mp4" : "NO-96");
