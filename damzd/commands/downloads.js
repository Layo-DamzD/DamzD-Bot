import {
  requestApiJson,
  requestExternalJson,
  safeFileName,
  unicodeBox,
  validateHttpsUrl
} from "../lib/api-client.js";
import { searchYouTubeAudio, youtubeSearch } from "../lib/youtube-play.js";

const AIO_API = "https://apis.nabeestech.com/api/v1/download/aio";
const AIO_KEY = String(process.env.NABEES_API_KEY || "").trim();

const PLATFORM_HOSTS = Object.freeze({
  fb: ["facebook.com", "fb.com", "fb.watch"],
  twitter: ["x.com", "twitter.com", "t.co"],
  instagram: ["instagram.com", "instagr.am"],
  ytmp4: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]
});

function requirePlatformUrl(ctx, label, allowedHosts) {
  const raw = String(ctx.args || "").trim().split(/\s+/)[0];
  if (!raw) throw new Error("Usage: " + ctx.config.prefix + ctx.commandName + " https://...");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid " + label + " link.");
  }
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.some(suffix => host === suffix || host.endsWith("." + suffix));
  if (url.protocol !== "https:" || url.username || url.password || !allowed) {
    throw new Error("That is not a supported public " + label + " URL.");
  }
  return url.toString();
}

function responseData(payload) {
  return payload?.data?.data || payload?.data || payload?.result || payload || {};
}

function safeMediaUrl(value, label = "media") {
  try {
    return validateHttpsUrl(value, label);
  } catch {
    return "";
  }
}

function chooseMedia(data) {
  const medias = Array.isArray(data?.medias) ? data.medias :
    Array.isArray(data?.media) ? data.media : [];
  const bestIndex = Number(data?.best?.index);
  const bestMatch = Number.isInteger(bestIndex)
    ? medias.find(item => Number(item?.index) === bestIndex)
    : null;
  const candidates = [bestMatch, data?.best, ...medias, data];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const url = [item.url, item.directUrl, item.downloadUrl, item.proxyUrl]
      .map(value => safeMediaUrl(value))
      .find(Boolean);
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

function mediaKind(item, extension) {
  const type = String(item?.type || item?.mimeType || item?.mime || "").toLowerCase();
  if (item?.isImage || type.includes("image") || ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) return "image";
  if (item?.isAudio || type.includes("audio") || ["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac"].includes(extension)) return "audio";
  if (item?.isVideo || type.includes("video") || ["mp4", "m4v", "mov", "webm", "mkv", "3gp"].includes(extension)) return "video";
  return "document";
}

async function sendDownloadedMedia(ctx, url, title, item = {}) {
  const extension = extensionOf(item, url);
  const kind = mediaKind(item, extension);
  const cleanTitle = String(title || "DamzD download").replace(/[\r\n*_\x60~]/g, " ").trim().slice(0, 150);
  const details = [
    "✅ *" + cleanTitle + "*",
    item.quality ? "✨ Quality: " + String(item.quality).slice(0, 50) : "",
    item.size ? "📦 Size: " + String(item.size).slice(0, 50) : ""
  ].filter(Boolean).join("\n");
  const caption = unicodeBox("📥 DOWNLOAD READY", details, { footer: true });
  const fileName = safeFileName(cleanTitle, "FEI-XMD-download") + (extension ? "." + extension : "");

  try {
    if (kind === "audio") {
      await ctx.send({ audio: { url }, mimetype: "audio/mpeg", fileName, ptt: false });
    } else if (kind === "video") {
      await ctx.send({ video: { url }, mimetype: "video/mp4", caption });
    } else if (kind === "image") {
      await ctx.send({ image: { url }, caption });
    } else {
      await ctx.send({ document: { url }, fileName, mimetype: "application/octet-stream", caption });
    }
    if (kind === "audio") await ctx.reply(caption);
  } catch {
    await ctx.reply(caption + "\n\n🔗 Direct download:\n" + url);
  }
}

async function runAio(ctx, sourceUrl, label = "ALL-IN-ONE") {
  await ctx.reply(unicodeBox("📥 " + label + " DOWNLOAD",
    "🔗 Source: " + sourceUrl + "\n\nFetching available media formats...", { footer: false }));
  const params = { url: sourceUrl };
  if (AIO_KEY) params.apikey = AIO_KEY;

  const payload = await requestExternalJson(AIO_API, params, 90000);
  const data = responseData(payload);
  if (payload?.success === false || payload?.status === false || data?.success === false || data?.status === false) {
    throw new Error("The download provider could not process that link.");
  }
  const selected = chooseMedia(data);
  if (!selected) throw new Error("The provider did not return a valid HTTPS media URL.");
  await sendDownloadedMedia(ctx, selected.url, data.title || data.source || "Media download", selected.item);
}

async function runYouTubeSearch(ctx) {
  const query = String(ctx.args || "").trim();
  if (!query) throw new Error("Usage: " + ctx.config.prefix + "ytsearch song title or creator");
  if (query.length > 200) throw new Error("Keep the search under 200 characters.");

  await ctx.reply("🔎 Searching YouTube for: " + query);
  // YouTube's own search API (the old eliteprotech provider is gone).
  const videos = await youtubeSearch(query, 5);
  if (!videos.length) throw new Error("No YouTube results were returned.");

  const lines = videos.map((video, index) => [
    (index + 1) + ". *" + video.title.slice(0, 150) + "*",
    "👤 " + video.author.slice(0, 80),
    video.duration ? "⏱ " + video.duration : "",
    "🔗 " + video.url
  ].filter(Boolean).join("\n"));
  await ctx.reply(unicodeBox("🔎 YOUTUBE RESULTS", lines.join("\n\n"), { footer: true }));
}

async function runYouTubeVideo(ctx) {
  const url = requirePlatformUrl(ctx, "YouTube", PLATFORM_HOSTS.ytmp4);
  await ctx.reply("🎬 Preparing the YouTube video download...");
  const payload = await requestApiJson("ytv", { url }, 90000);
  const data = payload?.results || payload?.result || payload?.data || {};
  const downloadUrl = safeMediaUrl(data.downloadUrl || data.download || data.url, "video");
  if (!downloadUrl) throw new Error("No valid video download URL was returned.");
  await sendDownloadedMedia(ctx, downloadUrl, data.title || "YouTube video", {
    type: "video/mp4",
    extension: "mp4",
    quality: data.quality || "available"
  });
}

export default [
  {
    name: "aio",
    category: "Downloads",
    description: "Download supported public media links through the NabeesTech all-in-one provider.",
    run: async ctx => {
      const url = requirePlatformUrl(ctx, "supported media", [
        ...PLATFORM_HOSTS.fb, ...PLATFORM_HOSTS.twitter, ...PLATFORM_HOSTS.instagram,
        ...PLATFORM_HOSTS.ytmp4, ...PLATFORM_HOSTS.tiktok
      ]);
      await runAio(ctx, url);
    }
  },
  {
    name: "fb",
    category: "Downloads",
    description: "Download a Facebook video using the all-in-one media provider.",
    run: async ctx => runAio(ctx, requirePlatformUrl(ctx, "Facebook", PLATFORM_HOSTS.fb), "FACEBOOK")
  },
  {
    name: "twitter",
    category: "Downloads",
    description: "Download a public X/Twitter video using the all-in-one media provider.",
    run: async ctx => runAio(ctx, requirePlatformUrl(ctx, "X/Twitter", PLATFORM_HOSTS.twitter), "X / TWITTER")
  },
  {
    name: "insta",
    aliases: ["instagram"],
    category: "Downloads",
    description: "Download Instagram media.",
    run: async ctx => runAio(ctx, requirePlatformUrl(ctx, "Instagram", PLATFORM_HOSTS.instagram), "INSTAGRAM")
  },
  {
    name: "yt",
    aliases: ["ytmp4", "ytdl"],
    category: "Downloads",
    description: "Download a YouTube video.",
    run: async ctx => runAio(ctx, requirePlatformUrl(ctx, "YouTube", PLATFORM_HOSTS.ytmp4), "YOUTUBE")
  },
  {
    name: "tiktok",
    aliases: ["ttdl"],
    category: "Downloads",
    description: "Download a TikTok video.",
    run: async ctx => runAio(ctx, requirePlatformUrl(ctx, "TikTok", PLATFORM_HOSTS.tiktok), "TIKTOK")
  },
  {
    name: "tiktok2",
    category: "Downloads",
    description: "Download a TikTok video (backup service).",
    run: async ctx => {
      const url = requirePlatformUrl(ctx, "TikTok", PLATFORM_HOSTS.tiktok);
      await ctx.reply("🎬 Preparing the TikTok download (backup provider)...");
      const payload = await requestExternalJson(
        "https://tikwm.com/api/",
        { url },
        60000
      );
      const data = payload?.data || {};
      if (payload?.code !== 0 || !data) {
        throw new Error("The backup TikTok provider could not process that link. Try " +
          ctx.config.prefix + "tiktok instead.");
      }
      const direct = data.hdplay || data.play || data.wmplay || "";
      if (!direct) throw new Error("No downloadable video was returned. Try " + ctx.config.prefix + "tiktok instead.");
      const videoUrl = direct.startsWith("http") ? direct : "https://tikwm.com" + direct;
      const safeUrl = safeMediaUrl(videoUrl, "video");
      if (!safeUrl) throw new Error("The provider returned an unsupported video URL.");
      await sendDownloadedMedia(ctx, safeUrl,
        data.title || "TikTok video", { type: "video/mp4", extension: "mp4" });
      if (data.music && safeMediaUrl(data.music, "audio")) {
        await ctx.send({ audio: { url: data.music }, mimetype: "audio/mpeg", ptt: false })
          .catch(() => {});
      }
    }
  },
  {
    name: "song",
    aliases: ["play2"],
    category: "Downloads",
    description: "Send any song as full audio — Audius and SoundCloud serve the real track; honest link otherwise.",
    run: async ctx => {
      const query = String(ctx.args || "").trim();
      if (!query) throw new Error("Usage: " + ctx.config.prefix + "song song title or artist");
      await ctx.reply("🎵 Finding your song: " + query.slice(0, 120) + "...");
      const result = await searchYouTubeAudio(query);
      if (!result.audioUrl && result.youtubeUrl) {
        // nothing downloadable anywhere — hand over the honest link box
        await ctx.reply(unicodeBox("🎵 SONG FOUND",
          result.title + "\n\nI could not get a downloadable audio for this one right now.\n🔗 " + result.youtubeUrl,
          { footer: true }));
        return;
      }
      await sendDownloadedMedia(ctx, result.audioUrl, result.title, {
        type: "audio/mpeg",
        extension: "mp3"
      });
    }
  },
  {
    name: "ytsearch",
    category: "Downloads",
    description: "Search YouTube and list matching videos without downloading them.",
    run: runYouTubeSearch
  },
  {
    name: "video",
    category: "Downloads",
    description: "Download a YouTube video in the best available quality.",
    run: async ctx => {
      const url = requirePlatformUrl(ctx, "YouTube", PLATFORM_HOSTS.ytmp4);
      await ctx.reply("🎬 Preparing the YouTube video download...");
      const payload = await requestApiJson("ytv", { url }, 90000).catch(() => null);
      const data = payload?.results || payload?.result || payload?.data || {};
      const downloadUrl = safeMediaUrl(data.downloadUrl || data.download || data.url, "video");
      if (!downloadUrl) {
        // The FEI video endpoint is unavailable — fall back to the
        // all-in-one provider so the command still answers.
        await runAio(ctx, url, "YOUTUBE HQ");
        return;
      }
      await sendDownloadedMedia(ctx, downloadUrl, data.title || "YouTube video", {
        type: "video/mp4",
        extension: "mp4",
        quality: data.quality || "available"
      });
    }
  }
];
