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

// Official-account check: SoundCloud-verified uploaders, or accounts with
// a six-figure following, are the real act. Small unverified accounts
// carrying a big artist's song are tribute bands and re-uploaders —
// "Killer Queen Band Page" (85 followers) playing Bohemian Rhapsody is
// not Queen.
export function uploaderVerified(user) {
  if (!user) return false;
  if (user.verified === true) return true;
  return Number(user.followers_count || 0) >= 100000;
}

// The strict indie check: when the artist has NO verified SoundCloud
// presence at all, a small account still passes when its name carries the
// ENTIRE artist name and no tribute-band words — that is the artist's own
// upload (Feli Nuna on "Feli Nuna Official"), not a cover act.
export function uploaderIsTheArtist(expectedArtist, user) {
  const uploader = String(user?.username || user?.permalink || "").toLowerCase();
  if (!uploader) return false;
  const tributeWords = ["band", "page", "tribute", "boot", "cover", "fan", "live", "karaoke", "story", "music"];
  if (tributeWords.some(w => uploader.includes(w))) return false;
  const artistWords = String(expectedArtist || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(w => w.length > 2);
  if (!artistWords.length) return false;
  return artistWords.every(w => uploader.includes(w));
}

// The uploader gate for a result set: if any account matching the artist
// in these results is verified, the real act is on SoundCloud and only
// verified uploads count (tributes rejected). Otherwise the artist is
// indie here and their own strictly-named account counts.
export function scUploaderOk(items, expectedArtist, user) {
  const artistPresent = (Array.isArray(items) ? items : [])
    .filter(i => i?.kind === "track")
    .some(i => artistMatches(expectedArtist, String(i.user?.username || "")) && uploaderVerified(i.user));
  if (artistPresent) return uploaderVerified(user);
  return uploaderVerified(user) || uploaderIsTheArtist(expectedArtist, user);
}

// Labels that mark a remix/variant standing in for the real song — the
// same rejection list the JioSaavn tier uses. The uploader's own name can
// legitimately carry these (a DJ called "Lofi Beats"), so only the track
// TITLE is checked here.
export const VARIANT_LABELS = [
  "remix", "edit", "nightcore", "lofi", "lo-fi", "slowed", "sped up",
  "speed up", "cover", "tribute", "mashup", "bootleg", "vip", "extended",
  "acoustic", "piano", "instrumental", "karaoke", "acapella", "live",
  "8-bit", "16-bit", "bass boosted", "type beat", "flip", "dub", "mix"
];

// Title check: the track title must share a real word with the wanted
// song title ("Last Last" matches "Last Last", not "Mera Na" and not a
// multi-artist medley whose title merely lists the artist's name). DJ
// blends and medleys separate songs with " / " — those never stand in
// for the single wanted track, so they are rejected outright.
export function titleMatches(expectedTitle, actualTitle) {
  const title = String(actualTitle || "");
  if (/ \/ | vs\.? | medley/i.test(title)) return false;
  const norm = value => String(value || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(Boolean);
  const want = norm(expectedTitle);
  if (!want.length) return true; // no title known — artist check alone
  const have = norm(title).join(" ");
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
// uploads cannot be fetched without keys). The track title must share a
// word with the wanted song, variant labels (remix/edit/live) in the
// title are rejected, and the uploader gate (scUploaderOk) keeps tribute
// bands from standing in for the act.
export function pickSoundcloudTrack(items, expectedArtist, expectedTitle = "") {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind !== "track" || !item?.media?.transcodings) continue;
    const uploader = String(item.user?.username || item.user?.permalink || "").trim();
    if (!uploader) continue;
    if (!artistMatches(expectedArtist, uploader)) continue;
    if (!scUploaderOk(items, expectedArtist, item.user)) continue;
    const title = String(item.title || "");
    if (VARIANT_LABELS.some(v => title.toLowerCase().includes(v))) continue;
    if (!titleMatches(expectedTitle, title)) continue;
    if (Math.round((Number(item.duration) || 0) / 1000) < MIN_FULL_SECONDS) continue;
    const progressive = item.media.transcodings.find(t => t.format?.protocol === "progressive");
    if (!progressive?.url) continue;
    return {
      title,
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

export async function soundcloudFullTrack(query, expectedArtist, expectedTitle = "") {
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
    const hit = pickSoundcloudTrack(payload?.collection, expectedArtist, expectedTitle);
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

// ---- SoundCloud plain-HLS tier (the phonk tier) ----
// Independent and phonk artists distribute natively on SoundCloud, and
// their uploads stream as PLAIN unencrypted HLS: an m3u8 playlist of mp4
// segments that concatenate into the full track (verified live: KORDHELL
// "Murder In My Mind" = 15 segments ≈ 2.9MB). Label-blocked tracks serve
// *encrypted* HLS (CBC/CTR) — those playlists carry EXT-X-KEY tags and
// are skipped honestly; they cannot be fetched without keys.
const MAX_HLS_BYTES = 25 * 1024 * 1024; // keep the bot inside Render's RAM

export async function soundcloudHlsTrack(query, expectedArtist, expectedTitle = "") {
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
      "&client_id=" + clientId + "&limit=20"
    );
    for (const item of (payload?.collection || [])) {
      if (item?.kind !== "track" || !item?.media?.transcodings) continue;
      const uploader = String(item.user?.username || "").trim();
      if (!uploader || !artistMatches(expectedArtist, uploader)) continue;
      if (!scUploaderOk(payload?.collection, expectedArtist, item.user)) continue;
      const title = String(item.title || "");
      // a remix/edit/live/tribute title never stands in for the real song
      if (VARIANT_LABELS.some(v => title.toLowerCase().includes(v))) continue;
      if (!titleMatches(expectedTitle, title)) continue;
      const duration = Math.round((Number(item.duration) || 0) / 1000);
      if (duration < MIN_FULL_SECONDS) continue;
      // audio hls transcodings: format.mime_type = audio/mp4 (aac);
      // pick the 160k preset when present, else any audio preset
      const audioHls = item.media.transcodings.filter(t =>
        t.format?.protocol === "hls" &&
        String(t.format?.mime_type || t.format?.mime_codec || "").startsWith("audio/mp4"));
      const hls = audioHls.find(t => String(t.preset || "").startsWith("aac_160")) || audioHls[0];
      if (!hls?.url) continue;
      const meta = await fetchJson(hls.url + "?client_id=" + clientId, 15000).catch(() => null);
      if (!meta?.url) continue;
      const m3u8 = await fetch(meta.url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(20000)
      }).then(res => res.text()).catch(() => "");
      if (!m3u8) continue;
      // encrypted playlists (label blocks) are unusable — skip honestly
      if (/EXT-X-KEY/i.test(m3u8)) continue;
      const segmentUrls = m3u8.split("\n").map(l => l.trim())
        .filter(l => l && !l.startsWith("#"))
        .map(l => l.startsWith("http") ? l : new URL(l, meta.url).href);
      if (segmentUrls.length < 3) continue;
      const parts = [];
      let total = 0;
      let ok = true;
      for (const segUrl of segmentUrls) {
        const buf = await fetch(segUrl, {
          headers: { "user-agent": UA },
          signal: AbortSignal.timeout(30000)
        }).then(res => {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.arrayBuffer();
        }).catch(() => null);
        if (!buf || !buf.byteLength) { ok = false; break; }
        parts.push(Buffer.from(buf));
        total += buf.byteLength;
        if (total > MAX_HLS_BYTES) { ok = false; break; }
      }
      if (!ok || total < 200 * 1024) continue;
      return {
        title: String(item.title || "Untitled").slice(0, 180),
        artist: uploader,
        audioBuffer: Buffer.concat(parts),
        mimetype: "audio/mp4",
        source: "SoundCloud",
        full: true,
        youtubeUrl: ""
      };
    }
  } catch { /* fall through */ }
  return null;
}
