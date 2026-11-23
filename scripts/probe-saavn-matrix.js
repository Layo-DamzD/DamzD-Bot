// JioSaavn full genre matrix — the v1.4.44 method (DES-ECB decrypt) with
// the artist-match guard. The question: for afrobeats/western/phonk/jazz/
// rock, does JioSaavn hold the REAL artist's track, and does the decrypted
// 320kbps URL serve FULL audio?
import crypto from "node:crypto";

// raw DES-ECB with no padding — Node's crypto can do this (des-ecb exists
// in OpenSSL 3; only the ancient des3 with weird padding fails).
const KEY = Buffer.from("38346591", "utf8");

function decryptMediaUrl(encoded) {
  try {
    const raw = crypto.createDecipheriv("des-ecb", KEY, null);
    raw.setAutoPadding(false);
    let out = Buffer.concat([raw.update(Buffer.from(String(encoded), "base64")), raw.final()]);
    return out.toString("utf8").replace(/[\x00-\x1f\x7f\s]+$/g, "");
  } catch {
    return "";
  }
}

async function j(url) {
  const r = await fetch(url, {
    headers: { accept: "*/*", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", origin: "https://www.jiosaavn.com", referer: "https://www.jiosaavn.com/" },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
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
      const artists = String(s.singers || "").toLowerCase();
      const title = String(s.title || "");
      // artist-match: any substantial query word in the singers field
      const artistHit = wanted.some(w => artists.includes(w));
      const dur = Number(s.more_info?.duration || s.duration || 0);
      const enc = s.more_info?.encrypted_media_url;
      if (artistHit && dur >= 90 && enc) {
        const base = decryptMediaUrl(enc);
        if (!base) continue;
        const url320 = base.replace("_96.mp4", "_320.mp4");
        const head = await fetch(url320, { headers: { range: "bytes=0-0", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
        const total = Number((head.headers.get("content-range") || "").split("/")[1] || head.headers.get("content-length") || 0);
        const kbps = dur ? Math.round(total * 8 / 1000 / dur) : 0;
        line.pick = String(s.singers).slice(0, 30) + " — " + title.slice(0, 32) + " (" + dur + "s)";
        line.stream = head.status + " " + (total / 1048576).toFixed(1) + "MB ≈" + kbps + "kbps";
        line.fullOk = head.status === 206 && total > 500000 && kbps >= 40;
        found = true;
        break;
      }
    }
    if (!found) {
      // show what WAS there, for the honest report
      line.top3 = songs.slice(0, 3).map(s => String(s.singers || "?").slice(0, 22) + "/" + String(s.title || "?").slice(0, 24) + "/" + Number(s.more_info?.duration || 0) + "s");
    }
  } catch (error) {
    line.error = String(error?.message || error).slice(0, 80);
  }
  results[genre + ":" + q] = line;
}
console.log(JSON.stringify(results, null, 1));
