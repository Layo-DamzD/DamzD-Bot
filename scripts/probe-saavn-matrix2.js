// JioSaavn matrix, corrected: artists from more_info.artistMap (singers is
// empty for international tracks), plus the v1.4.44 VARIANT_LABELS cover
// rejection. The question: which genres hold the REAL artist's FULL track?
import crypto from "node:crypto";

const KEY = Buffer.from("38346591", "utf8");
function decryptMediaUrl(encoded) {
  try {
    const d = crypto.createDecipheriv("des-ecb", KEY, null);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(Buffer.from(String(encoded), "base64")), d.final()])
      .toString("utf8").replace(/[\x00-\x1f\x7f\s]+$/g, "");
  } catch { return ""; }
}

// The v1.4.44 cover-rejection list — a track with these words in its label
// is a cover/tribute/remix standing in for the real thing.
const VARIANT_LABELS = [
  "originally performed", "performed by", "tribute", "cover", "nightcore",
  "lofi", "lo-fi", "piano version", "acoustic version", "instrumental",
  "karaoke", "remix", "edit", "live at", "re-recorded", "speed up",
  "slowed", "sped up", "techno", "ambient", "acapella", "mashup"
];

async function j(url) {
  const r = await fetch(url, {
    headers: { accept: "*/*", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", origin: "https://www.jiosaavn.com", referer: "https://www.jiosaavn.com/" },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function artistsOf(s) {
  const map = s?.more_info?.artistMap?.primary_artists;
  if (Array.isArray(map) && map.length) return map.map(a => a?.name || "").join(", ");
  return String(s?.singers || s?.more_info?.singers || "");
}

const QUERIES = [
  ["afrobeats", "Burna Boy Last Last"],
  ["afrobeats", "Asake Lonely At The Top"],
  ["western", "The Weeknd Blinding Lights"],
  ["western", "Dua Lipa Levitating"],
  ["phonk", "Kordhell Scorpion Genghis"],
  ["phonk", "PlayaPhonk Why Not"],
  ["jazz", "Miles Davis So What"],
  ["jazz", "John Coltrane Giant Steps"],
  ["rock", "Led Zeppelin Stairway to Heaven"],
  ["rock", "Queen Bohemian Rhapsody"],
  ["rock", "Nirvana Smells Like Teen Spirit"]
];

const results = {};
for (const [genre, q] of QUERIES) {
  const line = { q };
  try {
    const data = await j("https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=" + encodeURIComponent(q));
    const songs = data?.results || [];
    const wanted = q.split(" ").filter(w => w.length > 2).map(w => w.toLowerCase());
    let found = false;
    for (const s of songs) {
      const artists = artistsOf(s);
      const artistsLower = artists.toLowerCase();
      const title = String(s.title || "");
      const label = title.toLowerCase() + " " + artistsLower;
      const isVariant = VARIANT_LABELS.some(v => label.includes(v));
      const artistHit = wanted.some(w => artistsLower.includes(w));
      const dur = Number(s.more_info?.duration || s.duration || 0);
      const enc = s.more_info?.encrypted_media_url;
      line.candidates = line.candidates || [];
      if (line.candidates.length < 4) {
        line.candidates.push((isVariant ? "VAR" : artistHit ? "✓" : "✗") + " " + artists.slice(0, 22) + " / " + title.slice(0, 30) + " / " + dur + "s");
      }
      if (!isVariant && artistHit && dur >= 90 && enc) {
        const base = decryptMediaUrl(enc);
        if (!base) continue;
        const url320 = base.replace("_96.mp4", "_320.mp4");
        const head = await fetch(url320, { headers: { range: "bytes=0-0", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
        const total = Number((head.headers.get("content-range") || "").split("/")[1] || head.headers.get("content-length") || 0);
        const kbps = dur ? Math.round(total * 8 / 1000 / dur) : 0;
        line.pick = artists.slice(0, 28) + " — " + title.slice(0, 32) + " (" + dur + "s)";
        line.stream = head.status + " " + (total / 1048576).toFixed(1) + "MB ≈" + kbps + "kbps " + (head.headers.get("content-type") || "").split("/").pop();
        line.fullOk = (head.status === 206 || head.status === 200) && total > 500000 && kbps >= 40;
        found = true;
        break;
      }
    }
    if (!found) line.delivers = false;
  } catch (error) {
    line.error = String(error?.message || error).slice(0, 80);
  }
  results[genre] = results[genre] || {};
  results[genre][q] = line;
}
console.log(JSON.stringify(results, null, 1));
