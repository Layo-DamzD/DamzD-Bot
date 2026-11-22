import {
  requirePlatformUrl,
  resolveAllInOne,
  resolveYouTubeVideo,
  resolveYouTubeAudioNabees,
  searchYouTube,
  searchYouTubeAudio,
  searchYouTubeNabees,
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

// Shared song pipeline, in order of quality:
// 1. JioSaavn when the official artist is verified — the real track, up to 320kbps.
// 2. YouTube via NABEES (always on; the free key works, a personal key only
//    raises quota) — a real YouTube search and convert.
// 3. Audius: the artist's own full uploads, up to 320 kbps.
// 4. Keyless YouTube audio as the final rescue.
// The flow stays silent until bytes are in hand: one "Song found" line, then
// the audio. No search chatter, no preview fallback — a 30-second preview is
// not the song, and pretending otherwise is exactly what must never ship.
async function sendAudioBuffer(ctx, song) {
  const name = song.artist ? song.artist + " - " + song.title : song.title;
  await ctx.send({ audio: song.buffer, mimetype: "audio/mp4", fileName: cleanTitle(name) + ".m4a", ptt: false });
}

async function sendAudioUrl(ctx, url, title) {
  await ctx.send({ audio: { url }, mimetype: "audio/mpeg", fileName: cleanTitle(title) + ".mp3", ptt: false });
}

// One line, nothing else: what matched. The audio follows immediately.
async function announceFound(ctx, song) {
  const name = song.artist ? song.artist + " — " + song.title : song.title;
  await ctx.reply("✅ Song found: " + name);
}

async function sendSong(ctx, query) {
  const { searchSong, downloadSong } = await import("../src/saavn.js");
  const { audiusFullTrack } = await import("../src/audius.js");
  const { identifyTrack, fetchBuffer, searchQuality } = await import("../src/apis.js");
  // Silent until bytes are in hand — no "searching" filler, no step-by-step
  // narration. The first thing the chat sees is the found line, then audio.
  const identified = await identifyTrack(query).catch(() => null);
  let song = null;
  try {
    song = await searchSong(query, identified); // metadata first — bytes only after the found line
  } catch {
    song = null;
  }
  if (song && (song.artistVerified || !song.expectedArtist) && searchQuality(query, song) === "strong") {
    try {
      const full = await downloadSong(query, song);
      await announceFound(ctx, song);
      await ctx.typing(800);
      return sendAudioBuffer(ctx, full);
    } catch {
      /* the library copy failed to transfer — move on quietly */
    }
  }
  // A fuzzy match for a mistyped name is not a confirmation: a weak match
  // moves on quietly instead of announcing the wrong song as found.
  // YouTube via NABEES comes next — a real YouTube search and convert, the
  // most reliable full-track source there is. It is ALWAYS on: the free
  // NABEES key works, a personal NABEES_API_KEY only raises the quota. A
  // missing key must never switch the service off again. When even the
  // rescue route refuses, the final error says so plainly — the shared key's
  // daily quota is the usual reason, and "try again soon" is honest there.
  let rescueRefused = false;
  try {
    const found = await searchYouTubeNabees(query);
    const audio = await resolveYouTubeAudioNabees(found.url);
    const buffer = await fetchBuffer(audio.url, { timeoutMs: 60000, label: "rescue stream" });
    if (buffer.length < 150 * 1024) throw new Error("the rescue stream came back broken");
    await announceFound(ctx, { title: audio.title || found.title });
    await ctx.typing(800);
    return await ctx.send({ audio: buffer, mimetype: "audio/mpeg", fileName: cleanTitle(audio.title || found.title) + ".mp3", ptt: false });
  } catch {
    rescueRefused = true;
    /* keep trying */
  }
  // Audius: the artist's own full uploads, up to 320 kbps. The gate is the
  // uploader name — a remix published by another artist never passes. The
  // bytes come home verified: bare URL sends are how truncated audio happened.
  try {
    const aud = await audiusFullTrack(query, identified?.artist);
    if (aud) {
      const buffer = await fetchBuffer(aud.url, { timeoutMs: 60000, label: "artist upload" });
      if (buffer.length >= 150 * 1024) {
        await announceFound(ctx, { title: aud.title, artist: aud.artist, duration: aud.duration });
        await ctx.typing(800);
        return await ctx.send({ audio: buffer, mimetype: "audio/mpeg", fileName: cleanTitle(aud.artist + " - " + aud.title) + ".mp3", ptt: false });
      }
    }
  } catch {
    /* keep trying */
  }
  try {
    const result = await searchYouTubeAudio(query);
    await announceFound(ctx, { title: result.title });
    await ctx.typing(800);
    return await ctx.send({ audio: result.buffer, mimetype: "audio/mpeg", fileName: cleanTitle(result.title) + ".mp3", ptt: false });
  } catch {
    /* keep trying */
  }
  throw new Error(
    "No clean copy of *" + query + "* right now — every source is refusing that one. " +
    (rescueRefused
      ? "The YouTube rescue route is busy today — it usually frees up within a day, so try again soon."
      : "Try again soon.")
  );
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
            "every YouTube route refused me on that link just now — try it again in a little while"
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
