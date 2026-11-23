// The cloud-safe music tiers for .song — verified live from this sandbox
// and designed for Render's datacenter IPs:
//
//   Audius (api.audius.co) — decentralized, keyless, never blocks
//   datacenter IPs, full-length mp3 (audio/mpeg, HTTP 206 verified).
//   The catch: search floods with remixes/covers uploaded by DJs, so a
//   track is only accepted when its UPLOADER matches the officially
//   identified artist AND it runs at least 90 seconds.
//
//   SoundCloud (api-v2) — the web app's own /search route with the
//   public client_id scraped from the a-v2 bundles. Label tracks serve
//   30-second snippets or encrypted HLS (Asake), but genuine full
//   uploads expose a "progressive" transcoding: mp3 bytes over plain
//   HTTPS (HTTP 206 verified). Same guards: uploader matches the artist,
//   at least 90 seconds, progressive protocol only.
//
// Both tiers return null when they cannot deliver a REAL full track —
// never a snippet, never a cover standing in for the real song.
import { validateHttpsUrl } from "./api-client.js";

const APP_NAME = "DamzD-Bot";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MIN_FULL_SECONDS = 90;

function fetchJson(url, timeoutMs = 20000) {
  return fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(Math.max(5000, timeoutMs))
  }).then(res => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

// The v1.4.44 artist check: the uploader must share a real word with the
// officially identified artist, so a DJ's remix never stands in for the
// original. "and" normalization handles "Burna Boy" vs "Burna Boy Official".
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

// ---------- Audius ----------
const AUDIUS_FALLBACK_HOSTS = [
  "https://discoveryprovider.audius.co",
  "https://discoveryprovider2.audius.co"
];

let audiusHostCache = null;
async function audiusHosts() {
  if (audiusHostCache) return audiusHostCache;
  try {
    const payload = await fetchJson("https://api.audius.co", 8000);
    const hosts = (Array.isArray(payload?.data) ? payload.data : [])
      .filter(host => /^https:\/\//.test(String(host)));
    if (hosts.length) {
      audiusHostCache = hosts.slice(0, 3);
      return audiusHostCache;
    }
  } catch { /* fall back to the well-known discovery hosts */ }
  return AUDIUS_FALLBACK_HOSTS;
}

// Walk the search results in rank order; first track uploaded by the
// expected artist that runs at least 90 seconds wins. Pure, testable.
export function pickAudiusTrack(tracks, expectedArtist) {
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const uploader = String(track?.user?.name || track?.user?.handle || "").trim();
    if (!uploader || !track?.id) continue;
    if (!artistMatches(expectedArtist, uploader)) continue;
    if (Number(track?.duration) < MIN_FULL_SECONDS) continue;
    return {
      id: String(track.id),
      title: String(track.title || "Untitled"),
      artist: uploader,
      duration: Number(track.duration)
    };
  }
  return null;
}

// Returns a .song result when Audius genuinely hosts the artist's own
// full track — null otherwise (caller moves to the next tier).
export async function audiusFullTrack(query, expectedArtist) {
  if (!String(expectedArtist || "").trim()) return null;
  const hosts = await audiusHosts();
  for (const host of hosts) {
    try {
      const payload = await fetchJson(
        host + "/v1/tracks/search?query=" + encodeURIComponent(String(query || "").slice(0, 120)) +
        "&app_name=" + APP_NAME
      );
      const hit = pickAudiusTrack(payload?.data, expectedArtist);
      if (hit) {
        return {
          title: hit.title.slice(0, 180),
          artist: hit.artist,
          audioUrl: validateHttpsUrl(
            host + "/v1/tracks/" + hit.id + "/stream?app_name=" + APP_NAME,
            "Audius stream"
          ),
          source: "Audius",
          full: true,
          youtubeUrl: ""
        };
      }
    } catch { /* next host */ }
  }
  return null;
}

// ---------- SoundCloud ----------
// The public web client_id is scraped from the a-v2 asset bundles — the
// same id the soundcloud.com web player itself uses. Cached; re-scraped
// only when it stops working (they rotate it every few months).
let scClientId = null;
let scClientIdAt = 0;

async function scrapeScClientId() {
  if (scClientId && Date.now() - scClientIdAt < 3600_000) return scClientId;
  const html = await fetch("https://soundcloud.com", {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(12000)
  }).then(res => res.text());
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map(m => m[1]);
  for (const script of scripts.slice(0, 9)) {
    const js = await fetch(script, { signal: AbortSignal.timeout(15000) })
      .then(r => r.text()).catch(() => "");
    const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{28,40})"/) ||
      js.match(/client_id=([a-zA-Z0-9]{28,40})/);
    if (m) {
      scClientId = m[1];
      scClientIdAt = Date.now();
      return scClientId;
    }
  }
  if (scClientId) return scClientId; // keep the last known id on a failed scrape
  throw new Error("could not find the SoundCloud client id");
}

// Pure, testable: from api-v2 /search collection, pick the first TRACK by
// the expected artist that runs at least 90 seconds AND exposes a
// progressive transcoding (label snippets are 30s; encrypted-HLS-only
// uploads cannot be fetched without keys).
export function pickSoundcloudTrack(items, expectedArtist) {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind !== "track" || !item?.media?.transcodings) continue;
    const uploader = String(item.user?.username || item.user?.permalink || "").trim();
    if (!uploader) continue;
    if (!artistMatches(expectedArtist, uploader)) continue;
    if (Math.round((Number(item.duration) || 0) / 1000) < MIN_FULL_SECONDS) continue;
    const progressive = item.media.transcodings.find(t => t.format?.protocol === "progressive");
    if (!progressive?.url) continue;
    return {
      title: String(item.title || "Untitled"),
      artist: uploader,
      progressiveUrl: progressive.url,
      duration: Math.round(Number(item.duration) / 1000)
    };
  }
  return null;
}

// Resolve the progressive transcoding to direct mp3 bytes (the
// transcoding url + client_id returns {"url": ...} pointing at the file).
async function scProgressiveUrl(transcodingUrl, clientId) {
  const meta = await fetchJson(transcodingUrl + "?client_id=" + clientId, 15000);
  const url = meta?.url;
  return typeof url === "string" && /^https:\/\//.test(url) ? url : "";
}

export async function soundcloudFullTrack(query, expectedArtist) {
  if (!String(expectedArtist || "").trim()) return null;
  let clientId;
  try {
    clientId = await scrapeScClientId();
  } catch {
    return null;
  }
  try {
    const payload = await fetchJson(
      "https://api-v2.soundcloud.com/search?q=" + encodeURIComponent(String(query || "").slice(0, 120)) +
      "&client_id=" + clientId + "&limit=12"
    );
    const hit = pickSoundcloudTrack(payload?.collection, expectedArtist);
    if (!hit) return null;
    const directUrl = await scProgressiveUrl(hit.progressiveUrl, clientId).catch(() => "");
    if (!directUrl) return null;
    return {
      title: hit.title.slice(0, 180),
      artist: hit.artist,
      audioUrl: validateHttpsUrl(directUrl, "SoundCloud stream"),
      source: "SoundCloud",
      full: true,
      youtubeUrl: ""
    };
  } catch {
    return null;
  }
}
