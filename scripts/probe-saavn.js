// JioSaavn (saavn.dev public API) — the licensed-catalog test across the
// owner's genre matrix: afrobeats, western, phonk, jazz, rock. JioSaavn
// carries licensed international catalogs; the old objection (covers
// standing in for real tracks) is solved by the artist-match guard. What
// must be verified live: do the download URLs serve FULL tracks (not
// 30s/96kbps previews), and does the real artist's track exist?
const results = {};

async function j(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function bitrateCheck(bytes, seconds) {
  if (!bytes || !seconds) return "?";
  const kbps = Math.round(bytes * 8 / 1000 / seconds);
  return kbps + "kbps" + (kbps < 40 ? " ⚠ PREVIEW-QUALITY" : " ok");
}

const QUERIES = [
  "Burna Boy Last Last",        // afrobeats
  "Asake Lonely At The Top",    // afrobeats
  "The Weeknd Blinding Lights", // western pop
  "Dua Lipa Levitating",        // western pop
  "Kordhell Scorpion Genghis",  // phonk
  "PlayaPhonk Why Not",         // phonk
  "Miles Davis So What",        // jazz
  "John Coltrane Giant Steps",  // jazz
  "Led Zeppelin Stairway to Heaven", // rock
  "Queen Bohemian Rhapsody",    // rock
  "Nirvana Smells Like Teen Spirit"  // rock
];

for (const q of QUERIES) {
  const line = { q };
  try {
    const data = await j("https://saavn.dev/api/search/songs?query=" + encodeURIComponent(q) + "&limit=3");
    const songs = data?.data?.results || [];
    if (!songs.length) { line.found = "none"; results[q] = line; continue; }
    // artist-match: check each result for the real artist
    const wanted = q.split(" ").filter(w => w.length > 2);
    for (const s of songs) {
      const artists = (s.artists?.primary || []).map(a => a.name).join(", ") || s.primaryArtists || "";
      const artistHit = wanted.some(w => artists.toLowerCase().includes(w.toLowerCase()));
      const dur = Number(s.duration || 0);
      const best = (s.downloadUrl || []).slice(-1)[0]; // highest quality last
      line.candidates = line.candidates || [];
      line.candidates.push((artistHit ? "✓" : "✗") + " " + (artists || "?").slice(0, 24) + " | " + s.name.slice(0, 26) + " | " + dur + "s | " + (best?.quality || "?"));
      if (artistHit && dur >= 90 && best?.url) {
        // fetch it — is it FULL length?
        const head = await fetch(best.url, { headers: { range: "bytes=0-0" }, signal: AbortSignal.timeout(20000) });
        const total = head.headers.get("content-range")?.split("/")[1] || head.headers.get("content-length") || "0";
        const bytes = Number(total);
        line.pick = (artists || "").slice(0, 30) + " — " + s.name.slice(0, 30);
        line.stream = head.status + " " + (bytes / 1048576).toFixed(1) + "MB " + (head.headers.get("content-type") || "?");
        line.quality = bitrateCheck(bytes, dur);
        line.fullOk = bytes > 0 && (bytes * 8 / 1000 / dur) >= 40; // >=40kbps means real audio, not 30s-cut preview
        break;
      }
    }
  } catch (error) {
    line.error = String(error?.message || error).slice(0, 80);
  }
  results[q] = line;
}

console.log(JSON.stringify(results, null, 1));
