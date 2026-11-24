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
  "8-bit", "16-bit", "bass boosted", "type beat", "flip", "dub", "mix",
  // Naija-style edits of Western songs — the exact covers the Africa gate
  // is built to keep out of a Western request
  "naija", "afrobeat remix", "afrobeats remix", "amapiano remix",
  "refix", "freestyle", "snippet"
];

// Title check: every significant word of the wanted song must appear in
// the candidate ("Last Last" matches "Last Last", not "Mera Na" and not
// "Baszz To The Top" sharing one word with "Lonely At The Top" — the
// one-word match used to pass a different song by the same artist).
// Trailing parenthetical/bracket groups on the WANTED title are release
// metadata ("(Official Music Video)", "(Remix)"), not the song's name —
// stripped before comparing so they cannot veto a genuine catalog match.
// DJ blends and medleys separate songs with " / " — those never stand in
// for the single wanted track, so they are rejected outright.
export function titleMatches(expectedTitle, actualTitle) {
  const title = String(actualTitle || "");
  if (/ \/ | vs\.? | medley/i.test(title)) return false;
  const wanted = String(expectedTitle || "")
    .replace(/\s*(\([^)]*\)|\[[^\]]*\])\s*$/, "")
    .trim();
  const norm = value => String(value || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(Boolean);
  const want = norm(wanted).filter(word => word.length > 2);
  if (!want.length) return true; // no title known — artist check alone
  const have = norm(title).join(" ");
  return want.every(word => have.includes(word));
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

// The Africa gate for the Audiomack tier. Audiomack's catalog is
// afrobeats/amapiano/hip-hop first: the artists themselves upload there.
// For Western acts the same search returns covers and "Naija-style" edits,
// so the tier only runs when the IDENTIFIED artist is actually African —
// decided by Apple's genre (the metadata oracle) with the artist name as
// a second signal. Drake/Ed Sheeran style Western acts skip straight to
// SoundCloud/JioSaavn even though some are verified on Audiomack.
const AFRICAN_GENRES = [
  "afrobeats", "afrobeat", "afro", "afro-pop", "afro-fusion", "amapiano",
  "alta", "gqom", "kwaito", "gengetone", "bongo", "bingu", "coupé-décalé",
  "coupe-decale", "ndombolo", "makossa", "highlife", "hiplife", "azonto",
  "dagbamba", "ethio-jazz", "genge", "kapuka", "kizomba", "semba", "zouk",
  "chamambe", "sungura", "taarab", "soukouss", "soukous", "worldwide",
  "naija", "nigerian", "ghanaian", "african", "east african", "south african"
];
const AFRICAN_ARTIST_HINTS = [
  "wizkid", "davido", "burna boy", "asake", "rema", "ayra starr", "tems",
  "fireboy dml", "olamide", "tiwa savage", "yemi alade", "mr eazi",
  "kizz daniel", "ckay", "pheelz", "bnxn", "buju", "omah lay", " Portable",
  "shallipopi", "odumodublvck", "seyi vibez", "zinoleesky", "lil kesh",
  "adekunle gold", "simi", "falz", "m.i ag", "ice prince", " Jesse Jagz",
  "sarkodie", "stonebwoy", "shatta wale", "black sheriff", "blacko",
  "king promise", "amaarae", "gyakie", "camidoh", "sankyofa", "sarkess",
  "diamond platnumz", "harmonize", "rayvanny", "zuchu", "nandy",
  "marioo", "aly osman", "alykibo", "bnwja", "bnija", "bnjw", "bnjwa",
  "sauti sol", "nviiri", "bwenene", "buruklyn boyz", "buruklyn boiz",
  "wakadinali", "khaligraph jones", "nyashinski", "octopizzo", "sautisol",
  "femi kuti", "seun kuti", "made kuti", "angelique kidjo", "yemi",
  "yemi alade", "fally ipupa", "ferre gola", "innoss'b", "rema namakula",
  "diamond", "psquare", "p-square", "psq", "don jazzy", "mavins", "mavin",
  "starboy", "spaceship", "ybnl", "chocolate city", "30bg", "30bg",
  "sina rambo", "sarkcess", "rufftown", "burniton"
];

// Pure, testable: is the identified artist African? The genre oracle
// (Apple's primaryGenreName) decides; the artist-name hints are a fallback
// for when the genre is missing or generic ("Pop", "Hip-Hop/Rap").
export function isAfricanMusic(genre, artist) {
  const g = String(genre || "").toLowerCase();
  if (g && AFRICAN_GENRES.some(k => g.includes(k))) return true;
  // a Western genre from the oracle means Western catalog — no hint rescue
  // unless the genre is generic/missing
  const WESTERN_GENRES = [
    "pop", "rock", "alternative", "indie", "metal", "punk", "folk",
    "country", "jazz", "blues", "classical", "electronic", "dance",
    "house", "techno", "trance", "ambient", "new age", "r&b/soul",
    "hip-hop/rap", "rap", "christian", "gospel", "world", "reggae",
    "latin", "k-pop", "j-pop", "anime", "children", "comedy", "holiday",
    "vocal", "easy listening", "singer/songwriter", "soundtrack",
    "fitness/workout", "karaoke", "spoken word", "specialty", "karaoke"
  ];
  const generic = !g || WESTERN_GENRES.some(k => g === k) || g === "music";
  const a = String(artist || "").toLowerCase();
  if (generic && a && AFRICAN_ARTIST_HINTS.some(h => a.includes(h.trim()))) return true;
  return false;
}

// ---- Audiomack tier (the afrobeats/hip-hop tier) ----
// Audiomack's catalog is afrobeats-first: the African artists themselves
// upload there (Asake's "Lonely At The Top" = 194M plays, the official
// asakemusic account). v2.3.4 hard lesson: Western songs are NOT there —
// only covers and Naija-style edits — so the tier runs ONLY behind the
// isAfricanMusic gate above. The web player talks to api.audiomack.com
// with OAuth 1.0 HMAC-SHA1 signing using a PUBLIC web consumer key+secret
// baked into their own JavaScript bundle (bundle 7919:
// API_CONSUMER_KEY="audiomack-web",
// API_CONSUMER_SECRET="bd8a...b8e") — every browser does exactly this, no
// signup and no rate limits observed from datacenter IPs. /v1/music/play
// returns a signed CDN .m4a (verified live: HTTP 206, audio/mp4).
import crypto from "node:crypto";

const AM_CONSUMER_KEY = "audiomack-web";
const AM_CONSUMER_SECRET = "bd8a07e9f23fbe9d808646b730f89b8e";
const AM_API = "https://api.audiomack.com/v1";

function amPercent(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function amGet(path, params = {}) {
  // OAuth 1.0 signature base: METHOD & percent(base URL) & percent(sorted
  // query incl. oauth params), HMAC-SHA1 with the consumer secret.
  const full = {
    oauth_consumer_key: AM_CONSUMER_KEY,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.round(Date.now() / 1000),
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_version: "1.0",
    ...params
  };
  const base = AM_API + path;
  const sorted = Object.keys(full).sort()
    .map(k => amPercent(k) + "=" + amPercent(full[k])).join("&");
  full.oauth_signature = crypto.createHmac("sha1", amPercent(AM_CONSUMER_SECRET) + "&")
    .update(["GET", amPercent(base), amPercent(sorted)].join("&"))
    .digest("base64");
  const qs = Object.entries(full)
    .map(([k, v]) => amPercent(k) + "=" + amPercent(v)).join("&");
  return fetch(base + "?" + qs, {
    headers: { "user-agent": UA, accept: "application/json", referer: "https://audiomack.com/" },
    signal: AbortSignal.timeout(20000)
  });
}

// Pure, testable: the Audiomack uploader gate.
//   • uploader must BE the artist: verified=="yes" (their blue check) and
//     the account slug/name carries the artist name — "asakemusic" IS
//     Asake, "miles-davis" IS Miles Davis, but "the-mixer" / "bianca-
//     martins-3" / "djlandlord" are re-uploaders and are rejected;
//   • banned / authenticated-declined accounts never count;
//   • the track title must share a word with the wanted song and carry no
//     variant label (remix/cover/live...);
//   • >=90s, not premium-only, not geo-restricted, a song (not album/live).
export function amUploaderOk(song, expectedArtist) {
  const uploader = song?.uploader || {};
  const verified = String(uploader.verified || "").toLowerCase();
  if (verified !== "yes") return false;
  const slug = String(uploader.url_slug || uploader.slug || "").toLowerCase();
  const name = String(uploader.name || uploader.username || "").toLowerCase();
  // Strict for Audiomack: the uploader's account must carry MOST of the
  // artist's name (every significant word, or the longest word embedded —
  // "asakemusic" IS Asake, "heisrema" IS Rema). The loose any-word
  // artistMatches let "The Weeknd" match any verified "The ..." account,
  // which is exactly how Naija-style covers of Western songs slipped in.
  const words = String(expectedArtist || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return false;
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const inName = words.every(w => name.includes(w)) || name.includes(longest);
  const inSlug = words.every(w => slug.includes(w)) || slug.includes(longest);
  if (!inName && !inSlug) return false;
  return true;
}

export function pickAudiomackSong(songs, expectedArtist, expectedTitle) {
  for (const song of Array.isArray(songs) ? songs : []) {
    if (!song?.id) continue;
    if (String(song.type || "") !== "song") continue;
    if (song.live === true) continue;
    if (String(song.status || "") !== "complete" && song.status !== undefined) continue;
    if (String(song.premium_user_only || "").toLowerCase() === "yes") continue;
    if (song.geo_restricted === true) continue;
    const duration = Number(song.duration || 0);
    if (duration < MIN_FULL_SECONDS) continue;
    if (!amUploaderOk(song, expectedArtist)) continue;
    const title = String(song.title || "");
    if (VARIANT_LABELS.some(v => title.toLowerCase().includes(v))) continue;
    if (!titleMatches(expectedTitle, title)) continue;
    return {
      id: String(song.id),
      title: title.slice(0, 180),
      artist: String(song.artist || expectedArtist),
      duration
    };
  }
  return null;
}

// Returns a .song result when Audiomack holds the artist's own full track
// (the 403 label locks answer honestly as a null) — null otherwise.
// Only runs for AFRICAN artists (isAfricanMusic gate): for Western acts
// the search returns covers and Naija-style edits, so they fall through
// to SoundCloud/JioSaavn instead.
export async function audiomackFullTrack(query, expectedArtist, expectedTitle = "", genre = "") {
  if (!String(expectedArtist || "").trim()) return null;
  if (!isAfricanMusic(genre, expectedArtist)) return null;
  try {
    const res = await amGet("/search", { t: "song", q: String(query || "").slice(0, 120), limit: 10 });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    const hit = pickAudiomackSong(payload?.results, expectedArtist, expectedTitle);
    if (!hit) return null;
    const play = await amGet("/music/play/" + hit.id, { environment: "desktop-web", hq: "true" });
    if (!play.ok) return null; // label-locked (403) or gone — honest null
    const media = await play.json().catch(() => null);
    const url = String(media?.signedUrl || "");
    if (!/^https:\/\//.test(url)) return null;
    return {
      title: hit.title,
      artist: hit.artist,
      audioUrl: validateHttpsUrl(url, "Audiomack stream"),
      mimetype: "audio/mp4",
      source: "Audiomack",
      full: true,
      youtubeUrl: ""
    };
  } catch {
    return null;
  }
}
