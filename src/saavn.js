// JioSaavn music engine — full songs without YouTube. JioSaavn's public web
// API returns encrypted stream URLs; the key below is the long-known site key.
// This needs no third-party bot API, no YouTube, and works from datacenter
// hosts (Render), which is exactly where the old yt-play services died.

import CryptoJS from "crypto-js";
import { fetchJson } from "./utils.js";
import { fetchBuffer, identifyTrack } from "./apis.js";

const SAAVN_API = "https://www.jiosaavn.com/api.php";
const SAAVN_KEY = CryptoJS.enc.Utf8.parse("38346591");

// Node's OpenSSL 3 build refuses raw DES, so the site's long-known cipher is
// done with crypto-js (pure JS) — same result on every Node version.
export function decryptMediaUrl(encoded) {
  const raw = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(String(encoded || "")) },
    SAAVN_KEY,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
  ).toString(CryptoJS.enc.Utf8);
  return raw.replace(/[\x00-\x1f\x7f\s]+/g, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function pickImage(item) {
  const image = String(item?.image || item?.more_info?.image || "");
  return image.replace(/150x150/, "500x500");
}

// Cover/karaoke/sped-up variants flood every search — they must never win
// over the original recording when the owner asks for a plain song.
const VARIANT_LABELS = [
  "instrumental", "karaoke", "cover", "tribute", "originally performed",
  "made famous", "sped up", "slowed", "nightcore", "8d audio",
  "bass boosted", "reverb", "lofi", "lo-fi"
];

// Queries like "Alan x walkers" choke the library's literal search. Dropping
// one-letter tokens gives the search something it can actually match.
function cleanSearchQuery(query) {
  return String(query || "").toLowerCase().split(/\s+/).filter(t => t.length > 1).join(" ");
}

// True when the expected official artist actually appears among the result's
// artists — the difference between the real "Faded" and a random cover.
export function artistMatches(expected, actual) {
  const norm = value => String(value || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(Boolean);
  const want = norm(expected);
  if (!want.length) return false;
  const have = norm(actual).join(" ");
  return want.some(word => word.length > 2 && have.includes(word));
}

// Rank results by how many of the query's words appear in the track's own
// metadata — so "alan walker faded" prefers the real Alan Walker song over
// the many covers, and a stray "x" in the query does not mislead the pick.
function scoreTrack(item, tokens) {
  const info = item?.more_info || {};
  const artists = Array.isArray(info.artistMap?.primary_artists)
    ? info.artistMap.primary_artists.map(a => a?.name || "").join(" ")
    : String(info.singers || info.primaryArtists || "");
  const title = decodeEntities((item?.title || "") + " " + (item?.subtitle || "")).toLowerCase();
  const artistLower = decodeEntities(artists).toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const singular = token.length > 3 ? token.replace(/s$/, "") : token;
    if (title.includes(token)) score += 2;
    else if (title.includes(singular)) score += 2;
    if (artistLower.includes(token)) score += 3;
    else if (artistLower.includes(singular)) score += 3;
  }
  const label = title + " " + artistLower;
  for (const variant of VARIANT_LABELS) {
    if (label.includes(variant)) score -= 4;
  }
  return score;
}

async function saavnSearch(query) {
  const url = SAAVN_API +
    "?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=" +
    encodeURIComponent(String(query || "").slice(0, 150));
  const payload = await fetchJson(url, { timeoutMs: 45000, label: "music search" });
  let items = payload?.results;
  if (!Array.isArray(items)) items = items?.results;
  if (!Array.isArray(items) && Array.isArray(payload)) items = payload;
  return Array.isArray(items) ? items : [];
}

function rankedSaavnMatches(items, term) {
  const tokens = String(term || "").toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = [];
  for (const item of items) {
    const info = item?.more_info || {};
    const encrypted = info.encrypted_media_url || item?.encryptedMediaUrl;
    if (!encrypted) continue;
    // Karaoke/cover/sped-up candidates are dead weight: they can never pass
    // artist verification, and when Apple cannot identify the track one of
    // them could slip through as the "best match". Drop them at the door.
    const label = decodeEntities((item?.title || "") + " " + (item?.subtitle || "") +
      " " + (info.subtitle || "")).toLowerCase();
    if (VARIANT_LABELS.some(v => label.includes(v))) continue;
    scored.push({ item, info, encrypted, score: scoreTrack(item, tokens) });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function buildSong(item, info, encrypted, query) {
  const artists = Array.isArray(info.artistMap?.primary_artists)
    ? info.artistMap.primary_artists.map(a => a?.name || "").filter(Boolean).join(", ")
    : decodeEntities(info.singers || info.primaryArtists || item?.subtitle || "");
  const base = decryptMediaUrl(encrypted);
  if (!base.startsWith("http")) throw new Error("the music library gave me a broken link for that song");
  return {
    title: decodeEntities(item?.title || info.title || query).slice(0, 90),
    artist: decodeEntities(artists).slice(0, 80),
    album: decodeEntities(info.album || "").slice(0, 80),
    duration: String(info.duration || "").slice(0, 6),
    image: pickImage(item),
    url320: base.replace("_96.mp4", "_320.mp4"),
    url96: base
  };
}

// Returns { title, artist, duration, image, url320, url96, artistVerified }
// for the best match. artistVerified means the official artist (identified
// through Apple's catalogue) really appears on the track — a cover never
// passes, so callers can prefer a real copy elsewhere when it is false.
export async function searchSong(query) {
  const raw = String(query || "").trim();
  const cleaned = cleanSearchQuery(raw);
  if (!cleaned) throw new Error("tell me the song or artist name");

  const identified = await identifyTrack(raw);
  const attempts = [];
  if (identified?.artist && identified?.track) {
    attempts.push({ term: (identified.artist + " " + identified.track).slice(0, 140), expected: identified.artist });
  }
  attempts.push({ term: cleaned, expected: identified?.artist || "" });
  // The library's search is oddly literal — "burna boy last last" returns
  // zero results while the bare title returns ten. A title-only attempt with
  // the artist still verified afterwards rescues exactly those cases.
  if (identified?.track) {
    attempts.push({ term: identified.track.slice(0, 140), expected: identified.artist });
  }

  let fallback = null;
  for (const attempt of attempts) {
    let items = [];
    try {
      items = await saavnSearch(attempt.term);
    } catch {
      continue;
    }
    // Walk the whole ranked list — the real recording often sits below the
    // karaoke/cover variants that flood the top of the results.
    for (const match of rankedSaavnMatches(items, attempt.term).slice(0, 6)) {
      let song;
      try {
        song = buildSong(match.item, match.info, match.encrypted, attempt.term);
      } catch {
        continue;
      }
      if (artistMatches(attempt.expected, song.artist)) {
        return { ...song, artistVerified: true, expectedArtist: attempt.expected };
      }
      if (!fallback) fallback = { ...song, artistVerified: false, expectedArtist: attempt.expected };
    }
  }
  if (fallback) return fallback;
  throw new Error("I could not find that song — try another spelling");
}

// Full song as a Buffer — prefers the 320kbps copy and quietly falls back to
// the 96kbps one when the premium-quality link is unavailable.
export async function downloadSong(query) {
  const song = await searchSong(query);
  let buffer;
  try {
    buffer = await fetchBuffer(song.url320, { timeoutMs: 180000, label: "music library" });
  } catch {
    buffer = await fetchBuffer(song.url96, { timeoutMs: 180000, label: "music library" });
  }
  return { ...song, buffer };
}
