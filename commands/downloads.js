import {
  requirePlatformUrl,
  resolveAllInOne,
  resolveYouTubeVideo,
  searchYouTube,
  searchYouTubeAudio,
  mediaKind,
  cleanTitle,
  PLATFORM_HOSTS
} from "../src/downloads.js";

async function deliver(ctx, resolved) {
  const info = mediaKind(resolved.item, resolved.url);
  const kind = info?.kind || "video";
  const extension = info?.extension || "mp4";
  const fileName = cleanTitle(resolved.title) + "." + extension;
  try {
    if (kind === "audio") {
      await ctx.send({ audio: { url: resolved.url }, mimetype: "audio/mpeg", fileName, ptt: false });
    } else if (kind === "image") {
      await ctx.send({ image: { url: resolved.url }, caption: "*" + resolved.title + "*" });
    } else if (kind === "video") {
      await ctx.send({ video: { url: resolved.url }, mimetype: "video/mp4", caption: "*" + resolved.title + "*" });
    } else {
      await ctx.send({ document: { url: resolved.url }, fileName, mimetype: "application/octet-stream" });
    }
  } catch {
    await ctx.reply("I could not attach the file, so here is the direct link:\n" + resolved.url);
  }
}

async function viaAio(ctx, label) {
  const hosts = Object.values(PLATFORM_HOSTS).flat();
  const url = requirePlatformUrl(ctx.args, label, hosts);
  await ctx.typing(1000);
  const resolved = await resolveAllInOne(url);
  await deliver(ctx, resolved);
}

// Shared song pipeline: JioSaavn first (full tracks, no YouTube involved,
// works from Render), then the legacy YouTube play service. Always sends the
// audio itself, never just a link.
async function sendSong(ctx, query) {
  const { downloadSong } = await import("../src/saavn.js");
  try {
    const song = await downloadSong(query);
    await ctx.typing(800);
    const name = song.artist ? song.artist + " - " + song.title : song.title;
    await ctx.send({ audio: song.buffer, mimetype: "audio/mp4", fileName: cleanTitle(name) + ".m4a", ptt: false });
  } catch {
    const result = await searchYouTubeAudio(query);
    await ctx.send({
      audio: { url: result.url },
      mimetype: "audio/mpeg",
      fileName: cleanTitle(result.title) + ".mp3",
      ptt: false
    });
  }
}

export default [
  {
    name: "aio",
    category: "Downloads",
    description: "download from any supported link",
    run: async ctx => viaAio(ctx, "media")
  },
  {
    name: "tiktok",
    aliases: ["tt", "ttdl"],
    category: "Downloads",
    description: "download a TikTok video",
    run: async ctx => {
      const url = requirePlatformUrl(ctx.args, "TikTok", PLATFORM_HOSTS.tiktok);
      await ctx.typing(1000);
      await deliver(ctx, await resolveAllInOne(url));
    }
  },
  {
    name: "tiktok2",
    category: "Downloads",
    description: "download a TikTok video (backup service)",
    run: async ctx => {
      const url = requirePlatformUrl(ctx.args, "TikTok", PLATFORM_HOSTS.tiktok);
      await ctx.typing(1000);
      const { fetchJson } = await import("../src/utils.js");
      const payload = await fetchJson("https://tikwm.com/api/?url=" + encodeURIComponent(url), {
        timeoutMs: 90000,
        label: "TikTok service"
      });
      const data = payload?.data || {};
      const video = String(data?.play || data?.hdplay || "").trim();
      if (!/^https:\/\//.test(video)) throw new Error("the backup service found no file for that link");
      await ctx.send({ video: { url: video }, mimetype: "video/mp4", caption: "*" + cleanTitle(data?.title || "TikTok video") + "*" });
      if (data?.music && /^https:\/\//.test(String(data.music))) {
        await ctx.send({ audio: { url: data.music }, mimetype: "audio/mpeg", ptt: false });
      }
    }
  },
  {
    name: "insta",
    aliases: ["ig", "instagram"],
    category: "Downloads",
    description: "download Instagram media",
    run: async ctx => {
      const url = requirePlatformUrl(ctx.args, "Instagram", PLATFORM_HOSTS.instagram);
      await ctx.typing(1000);
      await deliver(ctx, await resolveAllInOne(url));
    }
  },
  {
    name: "fb",
    category: "Downloads",
    description: "download a Facebook video",
    run: async ctx => {
      const url = requirePlatformUrl(ctx.args, "Facebook", PLATFORM_HOSTS.facebook);
      await ctx.typing(1000);
      await deliver(ctx, await resolveAllInOne(url));
    }
  },
  {
    name: "twitter",
    aliases: ["x"],
    category: "Downloads",
    description: "download an X/Twitter video",
    run: async ctx => {
      const url = requirePlatformUrl(ctx.args, "X/Twitter", PLATFORM_HOSTS.twitter);
      await ctx.typing(1000);
      await deliver(ctx, await resolveAllInOne(url));
    }
  },
  {
    name: "yt",
    aliases: ["video", "ytmp4"],
    category: "Downloads",
    description: "download a YouTube video",
    run: async ctx => {
      const url = requirePlatformUrl(ctx.args, "YouTube", PLATFORM_HOSTS.youtube);
      await ctx.typing(1000);
      let resolved;
      try {
        resolved = await resolveYouTubeVideo(url);
      } catch (error) {
        if (String(process.env.NABEES_API_KEY || "").trim()) {
          resolved = await resolveAllInOne(url);
        } else {
          throw new Error(
            "my free YouTube route is being refused right now — add a free NABEES_API_KEY (apis.nabeestech.com) to my settings to restore video downloads"
          );
        }
      }
      await deliver(ctx, resolved);
    }
  },
  {
    name: "song",
    aliases: ["play", "music"],
    category: "Downloads",
    description: "send any song as a full audio file",
    run: async ctx => {
      const query = String(ctx.args || "").trim();
      if (!query) throw new Error("tell me the song or artist name");
      await ctx.typing(1200);
      await sendSong(ctx, query);
    }
  },
  {
    name: "play2",
    category: "Downloads",
    description: "send a song as audio (alternate path)",
    run: async ctx => {
      const query = String(ctx.args || "").trim();
      if (!query) throw new Error("tell me the song or artist name");
      await ctx.typing(1500);
      await sendSong(ctx, query);
    }
  },
  {
    name: "spotify",
    category: "Downloads",
    description: "find a track and send a preview",
    run: async ctx => {
      const query = String(ctx.args || "").trim();
      if (!query) throw new Error("tell me the track name");
      await ctx.typing(1000);
      const { spotifyPreview } = await import("../src/apis.js");
      const track = await spotifyPreview(query);
      await ctx.send({
        audio: { url: track.preview },
        mimetype: "audio/mpeg",
        fileName: cleanTitle(track.artist + " - " + track.title + " (preview)") + ".mp3",
        ptt: false
      });
    }
  },
  {
    name: "ytsearch",
    category: "Downloads",
    description: "search YouTube without downloading",
    run: async ctx => {
      const query = String(ctx.args || "").trim();
      if (!query) throw new Error("tell me what to search for");
      await ctx.typing(900);
      const videos = await searchYouTube(query);
      if (!videos.length) throw new Error("nothing came back for that search");
      const lines = videos.map((video, index) =>
        (index + 1) + ". *" + video.title + "*\n" +
        (video.author ? "   " + video.author : "") +
        (video.duration ? " · " + video.duration : "") +
        "\n   " + video.url
      );
      await ctx.reply("Here is what I found:\n\n" + lines.join("\n\n"));
    }
  }
];
