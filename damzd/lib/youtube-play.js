// The .song engine — a three-rung ladder, each rung verified live:
//
//   1) NABEES all-in-one (apis.nabeestech.com) — the owner's preferred
//      provider; needs NABEES_API_KEY. Full YouTube-to-mp3 conversion.
//      (Currently hard-down HTTP 530 — the rung re-arms itself whenever
//      the service comes back; no code change needed.)
//   2) Apple/YouTube identify the real track (artist + title), then every
//      still-alive public downloader the owner suggested is tried: Siputzx
//      (host up, downloader routes removed upstream), Dark Yasiya, Izumi,
//      Gifted (DNS dead). When one of them ever comes back it slots in
//      here — see PUBLIC_DOWNLOADERS below.
//   3) Apple 30-second preview + the YouTube link — never leaves the user
//      empty-handed; both are stable first-party endpoints.
//
// Search (for .ytsearch) uses YouTube's own innertube WEB API — the old
// eliteprotech provider is gone. No JioSaavn: the owner does not want
// Bollywood/regional substitutes standing in for real tracks.
import { validateHttpsUrl } from "./api-client.js";

const NABEES_AIO = "https://apis.nabeestech.com/api/v1/download/aio";
const ITUNES = "https://itunes.apple.com/search";
const INNERTUBE = "https://www.youtube.com/youtubei/v1/search";

// Owner-suggested public downloader families. Each entry is tried in order;
// a rung is skipped silently when its host is dead. Siputzx is first because
// its host still answers (only its yt routes are gone right now).
const PUBLIC_DOWNLOADERS = [
  {
    name: "Siputzx",
    build: videoUrl => "https://api.siputzx.my.id/api/dl/ytmp3?url=" + encodeURIComponent(videoUrl),
    paths: ["data.audio", "data.url", "data.download", "result", "url", "download"]
  },
  {
    name: "Dark Yasiya",
    build: videoUrl => "https://dark-yasiya-api.site/download/ytmp3?url=" + encodeURIComponent(videoUrl),
    paths: ["result.dl_link", "result.download", "data.url", "result", "url", "download"]
  },
  {
    name: "Izumi",
    build: videoUrl => "https://api.izumii-official.my.id/api/dl/ytmp3?url=" + encodeURIComponent(videoUrl),
    paths: ["result", "data.url", "url", "download"]
  },
  {
    name: "Gifted",
    build: videoUrl => "https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=" + encodeURIComponent(videoUrl),
    paths: ["result.download_url", "result.dl_link", "data.download", "result", "url", "download"]
  }
];

function fetchJson(url, options = {}, timeoutMs = 25000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(Math.max(5000, timeoutMs))
  }).then(res => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function decodeEntities(value) {
  return String(value || "").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&");
}

function valueAt(payload, paths) {
  for (const path of paths) {
    let value = payload;
    for (const key of path.split(".")) value = value && value[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// ---- rung 1: NABEES (owner's key) ----
async function nabeesAudio(query, apiKey) {
  // NABEES is a link downloader, so search first, then feed it the top video.
  const video = (await youtubeSearch(query, 1).catch(() => null) || []).find(v => v && v.title && v.id);
  if (!video) return null;
  const payload = await fetchJson(
    NABEES_AIO + "?url=" + encodeURIComponent(video.url) +
    "&apikey=" + encodeURIComponent(apiKey),
    { headers: { accept: "application/json" } },
    90000
  ).catch(() => null);
  if (!payload || payload.status === false || payload.success === false) return null;
  const data = payload?.data?.data || payload?.data || payload?.result || {};
  const medias = Array.isArray(data.medias) ? data.medias : Array.isArray(data.media) ? data.media : [];
  const audio = medias.find(item => String(item?.type || item?.mimeType || "").toLowerCase().includes("audio"));
  const candidate = audio?.url || data?.url || data?.downloadUrl || "";
  try {
    return {
      title: String(data.title || video.title).slice(0, 180),
      audioUrl: validateHttpsUrl(candidate, "audio download"),
      source: "NABEES",
      full: true,
      youtubeUrl: video.url
    };
  } catch {
    return null;
  }
}

// ---- rung 2: owner-suggested public downloaders ----
async function publicDownloaderAudio(identity) {
  const video = identity?.youtube;
  if (!video) return null;
  for (const provider of PUBLIC_DOWNLOADERS) {
    try {
      const payload = await fetchJson(provider.build(video.url), { headers: { accept: "application/json" } }, 60000);
      const candidate = valueAt(payload, provider.paths);
      if (!candidate || !/^https:\/\//i.test(candidate)) continue;
      return {
        title: video.title.slice(0, 180),
        audioUrl: validateHttpsUrl(candidate, "audio download"),
        source: provider.name,
        full: true,
        youtubeUrl: video.url
      };
    } catch { /* provider down — next one */ }
  }
  return null;
}

// ---- Apple/YouTube identification ----
async function appleIdentify(query) {
  const data = await fetchJson(ITUNES + "?term=" + encodeURIComponent(query) +
    "&limit=1&media=music&entity=song").catch(() => null);
  const hit = data?.results?.[0];
  return hit ? { artist: hit.artistName, track: hit.trackName, previewUrl: hit.previewUrl } : null;
}

// Identify the real track: YouTube first (it understands remix/feat
// phrasing like "altare bye"), Apple as a second opinion. YouTube's top
// result is only trusted when its title shares a word with the query —
// otherwise the top hit can be unrelated junk.
async function identifyTrack(query) {
  const video = (await youtubeSearch(query, 1).catch(() => null) || []).find(v => v && v.title && v.id);
  if (video) {
    const queryWords = new Set(query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2));
    const titleWords = String(video.title).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    const related = titleWords.some(w => queryWords.has(w));
    if (related) {
      const match = video.title.match(/^\s*(.+?)\s*[-–—]\s*(.+?)\s*(?:\[|\(|$)/);
      if (match && match[1].trim().length > 1) {
        return { artist: match[1].trim(), track: match[2].trim(), youtube: video };
      }
      return {
        artist: String(video.author || "").replace(/\s*-\s*Topic$/, "").trim(),
        track: video.title,
        youtube: video
      };
    }
    // unrelated top hit — keep the video as a link candidate only
    const apple = await appleIdentify(query).catch(() => null);
    return apple ? { ...apple, youtube: video } : { artist: "", track: "", youtube: video };
  }
  const apple = await appleIdentify(query).catch(() => null);
  return apple ? { ...apple, youtube: null } : null;
}

// ---- rung 3: Apple preview + YouTube link ----
async function previewAudio(query, identity) {
  // The identity may have come from YouTube (no preview url) — ask Apple
  // for the identified track so we can still send a real audio preview.
  let apple = identity?.previewUrl ? identity : null;
  if (!apple && identity?.artist && identity?.track) {
    apple = await appleIdentify(identity.artist + " " + identity.track).catch(() => null);
  }
  if (!apple) apple = await appleIdentify(query).catch(() => null);
  const video = identity?.youtube || (await youtubeSearch(query, 1).catch(() => null) || []).find(v => v && v.title && v.id);
  if (apple?.previewUrl) {
    return {
      title: apple.artist + " — " + apple.track,
      audioUrl: validateHttpsUrl(apple.previewUrl, "audio preview"),
      source: "Apple Music preview",
      full: false,
      youtubeUrl: video ? "https://www.youtube.com/watch?v=" + video.id : ""
    };
  }
  if (video) {
    return {
      title: video.title,
      audioUrl: "",
      source: "YouTube",
      full: false,
      youtubeUrl: "https://www.youtube.com/watch?v=" + video.id
    };
  }
  throw new Error("I could not find that song anywhere. Try a different spelling or add the artist name.");
}

// ---- YouTube innertube search (also powers .ytsearch) ----
export async function youtubeSearch(query, limit = 5) {
  const payload = await fetchJson(INNERTUBE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20250312.04.00", hl: "en", gl: "NG" } },
      query: String(query || "").slice(0, 200)
    })
  }, 30000);
  const videos = [];
  (function walk(node) {
    if (!node || typeof node !== "object" || videos.length >= limit) return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      videos.push({
        id: v.videoId,
        title: decodeEntities(v.title?.runs?.[0]?.text || v.title?.simpleText || ""),
        author: decodeEntities(v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || ""),
        duration: v.lengthText?.simpleText || "",
        url: "https://www.youtube.com/watch?v=" + v.videoId
      });
    }
    for (const value of Object.values(node)) walk(value);
  })(payload);
  return videos;
}

// The public entry: rung after rung, first hit wins.
export async function searchYouTubeAudio(query) {
  const search = String(query || "").trim();
  if (!search) throw new Error("Enter a song title or artist name.");
  if (search.length > 200) throw new Error("Keep the song search under 200 characters.");

  const apiKey = String(process.env.NABEES_API_KEY || "").trim();
  if (apiKey) {
    const nabees = await nabeesAudio(search, apiKey).catch(() => null);
    if (nabees) return nabees;
  }
  const identity = await identifyTrack(search);
  const downloader = await publicDownloaderAudio(identity).catch(() => null);
  if (downloader) return downloader;
  return previewAudio(search, identity);
}
