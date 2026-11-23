// JioSaavn — the licensed-catalog tier, keyless. The v1.4.44 method
// brought back with harder guards: the site's own api.php endpoints, the
// DES-ECB media URL decrypt via crypto-js (Node's OpenSSL 3 refuses raw
// DES), and — new since v1.4.44 — BOTH an artist match AND a title match,
// because the catalog hides covers ("ZZang KARAOKE", "Nightcore",
// "Originally Performed By") that pass an artist-only check when the
// requested artist merely features on somebody else's song.
//
// What the live matrix proved this tier delivers at 320kbps: licensed
// classics (Queen, Dave Brubeck). What it never gets: modern label pop
// (Weeknd/Dua Lipa — covers only) — the guards reject those and the
// ladder falls through honestly.
import CryptoJS from "crypto-js";

const SAAVN_API = "https://www.jiosaavn.com/api.php";
const SAAVN_KEY = CryptoJS.enc.Utf8.parse("38346591");

// Labels that mark a cover/tribute/variant standing in for the real song.
export const VARIANT_LABELS = [
  "originally performed", "originally perfomed", "performed by", "tribute",
  "cover", "nightcore", "lofi", "lo-fi", "piano version", "acoustic version",
  "instrumental", "karaoke", "live aid", "re-recorded", "speed up", "slowed",
  "sped up", "techno", "ambient", "acapella", "mashup", "type beat",
  "8-bit", "16-bit", "bass boosted", "fitness remix", "hyperpop", "melody"
];

export function decryptMediaUrl(encoded) {
  try {
    const raw = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(String(encoded || "")) },
      SAAVN_KEY,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
    ).toString(CryptoJS.enc.Utf8);
    return raw.replace(/[\x00-\x1f\x7f\s]+/g, "");
  } catch {
    return ""; // malformed ciphertext must never crash the ladder
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;amp;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function words(value) {
  return String(value || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);
}

// Pure: does this search hit look like the real requested song?
//  - artists include a word from the expected artist (feat. credits count)
//  - title includes a word from the expected track name
//  - no variant label anywhere
//  - at least 90 seconds
export function pickSaavnTrack(songs, expectedArtist, expectedTitle) {
  const artistWords = words(expectedArtist);
  const titleWords = words(expectedTitle);
  for (const song of Array.isArray(songs) ? songs : []) {
    const artists = Array.isArray(song?.more_info?.artistMap?.primary_artists)
      ? song.more_info.artistMap.primary_artists.map(a => a?.name || "").join(", ")
      : String(song?.singers || "");
    const title = decodeEntities(song?.title);
    const label = (title + " " + artists).toLowerCase();
    if (VARIANT_LABELS.some(v => label.includes(v))) continue;
    if (!artistWords.length || !artistWords.some(w => artists.toLowerCase().includes(w))) continue;
    if (titleWords.length && !titleWords.some(w => title.toLowerCase().includes(w))) continue;
    const duration = Number(song?.more_info?.duration || song?.duration || 0);
    if (duration < 90) continue;
    if (!song?.more_info?.encrypted_media_url) continue;
    return {
      title,
      artist: artists,
      duration,
      encryptedUrl: song.more_info.encrypted_media_url
    };
  }
  return null;
}

async function saavnSearch(query) {
  const url = SAAVN_API + "?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=" +
    encodeURIComponent(String(query || "").slice(0, 120));
  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      origin: "https://www.jiosaavn.com",
      referer: "https://www.jiosaavn.com/"
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

// Returns a .song result when JioSaavn holds the REAL track at full
// length — null otherwise (caller moves on).
export async function saavnFullTrack(query, expectedArtist, expectedTitle) {
  if (!String(expectedArtist || "").trim() || !String(expectedTitle || "").trim()) return null;
  try {
    const songs = await saavnSearch(query);
    const hit = pickSaavnTrack(songs, expectedArtist, expectedTitle);
    if (!hit) return null;
    const base = decryptMediaUrl(hit.encryptedUrl);
    if (!/^https:\/\//.test(base)) return null;
    // The decrypted URL points at the 96kbps AAC copy; the 320kbps copy
    // lives at the same path with the quality swapped (verified live).
    const url320 = base.replace("_96.mp4", "_320.mp4");
    if (url320 === base) return null;
    return {
      title: hit.title.slice(0, 180),
      artist: hit.artist,
      audioUrl: url320,
      source: "JioSaavn",
      full: true,
      youtubeUrl: ""
    };
  } catch {
    return null;
  }
}
