import { fetchJson, isHttpsUrl } from "./utils.js";

const AIO_API = "https://apis.nabeestech.com/api/v1/download/aio";
// Rebix stays as the last resort for direct video links; YouTube now
// bot-gates extraction from datacenter hosts, so it often answers
// "no video qualities available". The Piped instances below do the
// extraction on their own community hosts and are tried first.
const YT_VIDEO_API = "https://api-rebix.vercel.app/api/ytv";
// Piped: the open-source YouTube proxy network, keyless. Individual
// instances come and go — the list is ordered by today's health and the
// rotation below simply falls through to the next one when one 5xx's.
const PIPED_APIS = [
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.kavin.rocks"
];

export const PLATFORM_HOSTS = Object.freeze({
  facebook: ["facebook.com", "fb.com", "fb.watch"],
  twitter: ["x.com", "twitter.com", "t.co"],
  instagram: ["instagram.com", "instagr.am"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]
});

export function detectPlatform(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    const host = url.hostname.toLowerCase();
    for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
      if (hosts.some(suffix => host === suffix || host.endsWith("." + suffix))) {
        return { platform, url: url.toString() };
      }
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function requirePlatformUrl(rawInput, label, allowedHosts) {
  const raw = String(rawInput || "").trim().split(/\s+/)[0];
  if (!raw) throw new Error("Send a " + label + " link and I will fetch it for you.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid " + label + " link.");
  }
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.some(suffix => host === suffix || host.endsWith("." + suffix));
  if (url.protocol !== "https:" || !allowed) {
    throw new Error("That is not a supported " + label + " link.");
  }
  return url.toString();
}

function safeMediaUrl(value, label = "media") {
  const candidate = String(value || "").trim();
  return isHttpsUrl(candidate) ? candidate : "";
}

function chooseMedia(data) {
  const medias = Array.isArray(data?.medias) ? data.medias
    : Array.isArray(data?.media) ? data.media
    : [];
  const candidates = [data?.best, ...medias, data];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const url = [
      item.url, item.directUrl, item.downloadUrl, item.proxyUrl, item.link
    ].map(value => safeMediaUrl(value)).find(Boolean);
    if (url) return { item, url };
  }
  return null;
}

function extensionOf(item, url) {
  const declared = String(item?.extension || item?.ext || "").toLowerCase().replace(/^\./, "");
  if (/^[a-z0-9]{2,8}$/.test(declared)) return declared;
  try {
    return new URL(url).pathname.match(/\.([a-z0-9]{2,8})$/i)?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

export function mediaKind(item, url) {
  const extension = extensionOf(item, url);
  const type = String(item?.type || item?.mimeType || item?.mime || "").toLowerCase();
  if (item?.isAudio || type.includes("audio") || ["mp3", "m4a", "aac", "ogg", "opus", "wav"].includes(extension)) {
    return { kind: "audio", extension: extension || "mp3" };
  }
  if (item?.isImage || type.includes("image") || ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) {
    return { kind: "image", extension: extension || "jpg" };
  }
  if (item?.isVideo || type.includes("video") || ["mp4", "m4v", "mov", "webm", "mkv"].includes(extension) || true) {
    return { kind: "video", extension: extension || "mp4" };
  }
}

export function cleanTitle(value, fallback = "download") {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || fallback;
}

export async function resolveAllInOne(sourceUrl) {
  // The provider introduced API keys — attach the owner's free key when it is
  // configured so downloads keep working; without it most providers now fail.
  const key = String(process.env.NABEES_API_KEY || "").trim();
  const url = AIO_API + "?url=" + encodeURIComponent(sourceUrl) + (key ? "&apikey=" + encodeURIComponent(key) : "");
  const payload = await fetchJson(url, { timeoutMs: 90000, label: "download provider" });
  const data = payload?.data?.data || payload?.data || payload?.result || payload || {};
  const selected = chooseMedia(data);
  if (!selected) throw new Error("I could not find a downloadable file in that link.");
  return {
    url: selected.url,
    title: cleanTitle(data.title || data.source || "Media download"),
    item: selected.item
  };
}

// Pulls the video id out of any YouTube link shape (watch, youtu.be, shorts,
// embed, live). Pure so the suite can pin the behaviour.
export function youtubeVideoId(value) {
  const raw = String(value || "").trim();
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /\/shorts\/([A-Za-z0-9_-]{6,})/,
    /\/embed\/([A-Za-z0-9_-]{6,})/,
    /\/live\/([A-Za-z0-9_-]{6,})/
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[1];
  }
  return "";
}

// Pure: picks WhatsApp's friendliest audio stream — m4a/aac only (webm/opus
// playback is unreliable in WhatsApp), highest bitrate wins. Tested.
export function pickBestAudio(streams) {
  const audio = (Array.isArray(streams) ? streams : [])
    .filter(stream => /audio\/mp4|audio\/aac/i.test(String(stream?.mimeType || "")))
    .sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0));
  return safeMediaUrl(audio[0]?.url, "audio") || null;
}

// Pure: picks WhatsApp's friendliest combined video stream — mp4 with its own
// audio track, highest bitrate wins. Tested.
export function pickBestVideo(streams) {
  const videos = (Array.isArray(streams) ? streams : [])
    .filter(stream => /video\/mp4/i.test(String(stream?.mimeType || "")) && !stream?.videoOnly)
    .sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0));
  return safeMediaUrl(videos[0]?.url, "video") || null;
}

async function pipedRequest(path, { timeoutMs = 15000, label = "Piped" } = {}) {
  let lastError = null;
  for (const api of PIPED_APIS) {
    try {
      return await fetchJson(api + path, { timeoutMs, label });
    } catch (error) {
      lastError = error; // instance down or YouTube-gated — try the next one
    }
  }
  throw lastError || new Error("the " + label + " services are all unreachable right now");
}

async function pipedSearchVideos(query) {
  const payload = await pipedRequest(
    "/search?q=" + encodeURIComponent(String(query || "").slice(0, 200)) + "&filter=music_songs",
    { timeoutMs: 15000, label: "YouTube search" }
  );
  return (Array.isArray(payload?.items) ? payload.items : [])
    .filter(item => item?.type === "stream" && (item?.url || item?.id))
    .slice(0, 5)
    .map(item => ({
      id: String(item.id || String(item.url || "").match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1] || ""),
      title: cleanTitle(item.title || "Untitled", "song"),
      author: cleanTitle(item.uploaderName || "Unknown creator", "Unknown creator").slice(0, 60),
      duration: String(item.duration || "").slice(0, 20)
    }))
    .filter(item => item.id);
}

export async function resolveYouTubeVideo(videoUrl) {
  const id = youtubeVideoId(videoUrl);
  if (id) {
    for (const api of PIPED_APIS) {
      try {
        const streams = await fetchJson(api + "/streams/" + id, { timeoutMs: 20000, label: "YouTube service" });
        const url = pickBestVideo(streams?.videoStreams);
        if (url) {
          return { url, title: cleanTitle(streams?.title || "YouTube video"), item: { type: "video/mp4", extension: "mp4" } };
        }
      } catch { /* next instance */ }
    }
  }
  // Rebix fallback for link downloads — alive, just YouTube-gated some days.
  const payload = await fetchJson(YT_VIDEO_API + "?url=" + encodeURIComponent(videoUrl), {
    timeoutMs: 90000,
    label: "YouTube service"
  });
  const data = payload?.results || payload?.result || payload?.data || payload || {};
  const url = safeMediaUrl(data.downloadUrl || data.download || data.url, "video");
  if (!url) throw new Error("No video link came back. Try again or use a different link.");
  return { url, title: cleanTitle(data.title || "YouTube video"), item: { type: "video/mp4", extension: "mp4" } };
}

export async function searchYouTube(query) {
  const videos = await pipedSearchVideos(query);
  if (!videos.length) throw new Error("Nothing turned up for that search.");
  return videos.map(video => ({
    title: video.title,
    author: video.author,
    duration: video.duration,
    url: "https://www.youtube.com/watch?v=" + video.id
  }));
}

// YouTube audio for .song — Piped search finds the official track, the
// streams call hands back direct googlevideo URLs that WhatsApp's fetchers
// can pull even when our own host is IP-gated. A few candidates are tried:
// the top hit's streams call sometimes comes back bot-gated.
export async function searchYouTubeAudio(query) {
  const videos = await pipedSearchVideos(query);
  if (!videos.length) throw new Error("Nothing turned up for that search.");
  for (const video of videos.slice(0, 3)) {
    try {
      const streams = await pipedRequest("/streams/" + video.id, { timeoutMs: 20000, label: "music service" });
      const url = pickBestAudio(streams?.audioStreams);
      if (!url) continue;
      // The bytes come home verified — a bare URL send on a flaky host is how
      // truncated 3-second wrecks got delivered. Under 150KB is a broken
      // transfer, not a song: try the next candidate instead.
      const { fetchBuffer } = await import("./apis.js");
      const buffer = await fetchBuffer(url, { timeoutMs: 60000, label: "audio stream" });
      if (buffer.length < 150 * 1024) continue;
      return { buffer, title: video.title };
    } catch { /* next candidate */ }
  }
  throw new Error("I could not get the audio for that. Try another song name.");
}

const NABEES_API = "https://apis.nabeestech.com/api/v1";

// NABEES free tier (key "nabeestech", ~100 requests/day) can search YouTube
// and convert a video to MP3 — the rescue path for tracks the song library
// only offers as covers. Kept behind NABEES_API_KEY so the daily quota is
// never spent by accident.
export async function searchYouTubeNabees(query) {
  const key = String(process.env.NABEES_API_KEY || "").trim();
  if (!key) throw new Error("no-key");
  const payload = await fetchJson(
    NABEES_API + "/search/youtube?apikey=" + encodeURIComponent(key) +
    "&q=" + encodeURIComponent(String(query || "").slice(0, 200)),
    { timeoutMs: 45000, label: "YouTube search" }
  );
  const videos = Array.isArray(payload?.results) ? payload.results : [];
  const hit = videos.find(video => video && (safeMediaUrl(video.url, "video") || video.id));
  if (!hit) throw new Error("YouTube search found nothing usable for that song");
  return {
    url: safeMediaUrl(hit.url, "video") || "https://youtu.be/" + hit.id,
    title: cleanTitle(hit.title || query, "song"),
    channel: cleanTitle(hit.channel || "", "").slice(0, 60)
  };
}

export async function resolveYouTubeAudioNabees(videoUrl) {
  const key = String(process.env.NABEES_API_KEY || "").trim();
  if (!key) throw new Error("no-key");
  const query = "apikey=" + encodeURIComponent(key) + "&url=" + encodeURIComponent(videoUrl);
  const endpoints = ["/download/youtube-mp3", "/download/youtube", "/download/youtube-v2"];
  let lastError = new Error("the YouTube music service refused that request");
  for (const endpoint of endpoints) {
    try {
      const payload = await fetchJson(NABEES_API + endpoint + "?" + query, {
        timeoutMs: 120000,
        label: "music service"
      });
      const data = payload?.data || payload?.result || payload || {};
      const url = safeMediaUrl(
        data.downloadUrl || data.audio?.url || data.audioUrl || data.url || data.download,
        "audio"
      );
      if (url) return { url, title: cleanTitle(data.title || "song", "song") };
      lastError = new Error(payload?.error || payload?.message || "no audio link came back");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
