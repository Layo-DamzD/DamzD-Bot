// Where the guards REJECT a real match, check what's actually there.
// Burna "Last Last" picked "Mera Na" (Sidhu Moose Wala feat. Burna Boy) —
// a track where Burna is FEATURED, not the main artist. Need title-match
// too. Also probe SoundCloud for the phonk/western/jazz gaps.
import CryptoJS from "/home/z/my-project/damzd/node_modules/crypto-js/index.js";

const KEY = CryptoJS.enc.Utf8.parse("38346591");
function decryptMediaUrl(encoded) {
  const raw = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(String(encoded || "")) },
    KEY,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
  ).toString(CryptoJS.enc.Utf8);
  return raw.replace(/[\x00-\x1f\x7f\s]+/g, "");
}

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
  return String(s?.singers || "");
}

// Show ALL 10 results for the failing queries with artist + title + duration
for (const q of ["Burna Boy Last Last", "The Weeknd Blinding Lights", "Ed Sheeran Shape of You", "Nirvana Smells Like Teen Spirit", "Miles Davis So What", "Wizkid Essence"]) {
  console.log("=== " + q);
  try {
    const data = await j("https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=" + encodeURIComponent(q));
    const songs = data?.results || [];
    for (const s of songs) {
      console.log("  " + (s.more_info?.duration || 0) + "s | " + artistsOf(s).slice(0, 32) + " | " + String(s.title).slice(0, 40));
    }
  } catch (e) { console.log("  ERR " + String(e?.message || e).slice(0, 60)); }
}
