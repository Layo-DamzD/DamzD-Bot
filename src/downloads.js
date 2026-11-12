import { fetchJson, isHttpsUrl } from "./utils.js";

const AIO_API = "https://apis.nabeestech.com/api/v1/download/aio";
const YT_VIDEO_API = "https://api-rebix.vercel.app/api/ytv";
const YT_SEARCH_API = "https://eliteprotech-apis.zone.id/search/ytsearch";
const YT_AUDIO_API = "https://eliteprotech-apis.zone.id/download/ytmp3";
const YT_PLAY_API = "https://api.ikyyxd.my.id/search/ytplayv2";

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

export async function resolveYouTubeVideo(videoUrl) {
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
  const payload = await fetchJson(YT_SEARCH_API + "?q=" + encodeURIComponent(String(query || "").slice(0, 200)), {
    timeoutMs: 45000,
    label: "YouTube search"
  });
  const videos = Array.isArray(payload?.results?.videos) ? payload.results.videos
    : Array.isArray(payload?.videos) ? payload.videos
    : [];
  if (!videos.length) throw new Error("Nothing turned up for that search.");
  return videos.slice(0, 5).map(video => ({
    title: cleanTitle(video?.title || "Untitled"),
    author: cleanTitle(video?.author?.name || video?.author || "Unknown creator", "Unknown creator").slice(0, 60),
    duration: String(video?.duration || "").slice(0, 20),
    url: safeMediaUrl(video?.url, "video")
  })).filter(item => item.url);
}

export async function searchYouTubeAudio(query) {
  const term = encodeURIComponent(String(query || "").slice(0, 200));
  // Primary route, verified working from datacenter hosts (the old yt-play
  // services all died there): a keyless YouTube search finds the official
  // video, a keyless converter turns it into a direct MP3 link.
  try {
    const found = await fetchJson(YT_SEARCH_API + "?q=" + term, {
      timeoutMs: 45000,
      label: "YouTube search"
    });
    const videos = found?.results?.videos || found?.results || found?.videos || [];
    const top = (Array.isArray(videos) ? videos : [])
      .find(video => safeMediaUrl(video?.url, "video") || video?.id);
    const videoUrl = top
      ? (safeMediaUrl(top.url, "video") || (top.id ? "https://www.youtube.com/watch?v=" + top.id : ""))
      : "";
    if (videoUrl) {
      const converted = await fetchJson(YT_AUDIO_API + "?url=" + encodeURIComponent(videoUrl), {
        timeoutMs: 120000,
        label: "music service"
      });
      const audioUrl = safeMediaUrl(
        converted?.download?.downloadUrl || converted?.downloadUrl ||
        converted?.download?.url || converted?.url,
        "audio"
      );
      if (audioUrl) {
        return {
          url: audioUrl,
          title: cleanTitle(converted?.download?.title || top.title || query, "song")
        };
      }
    }
  } catch {
    /* fall through to the legacy route */
  }
  // Legacy route — dead at the moment, kept for when it wakes back up.
  const payload = await fetchJson(YT_PLAY_API + "?q=" + term, {
    timeoutMs: 60000,
    label: "music service"
  });
  const result = payload?.result || payload?.data?.result || payload?.data || {};
  const url = safeMediaUrl(result?.audio?.url || result?.audioUrl || result?.url, "audio");
  if (!url) throw new Error("I could not get the audio for that. Try another song name.");
  return {
    url,
    title: cleanTitle(result?.title || result?.name || query, "song")
  };
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
