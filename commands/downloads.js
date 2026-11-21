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
// 2. JioSaavn without identification (regional tracks Apple does not list) —
//    the library's best match is very likely the real recording.
// 3. Real YouTube audio via the keyless public route, then NABEES conversion
//    when the owner's free key is configured.
// 4. Honest last resort: Apple's official 30-second preview — never a cover
//    pretending to be the song.
async function sendAudioBuffer(ctx, song) {
  const name = song.artist ? song.artist + " - " + song.title : song.title;
  await ctx.send({ audio: song.buffer, mimetype: "audio/mp4", fileName: cleanTitle(name) + ".m4a", ptt: false });
}

async function sendAudioUrl(ctx, url, title) {
  await ctx.send({ audio: { url }, mimetype: "audio/mpeg", fileName: cleanTitle(title) + ".mp3", ptt: false });
}

// Turns a raw duration — seconds from the music library or a "3:45" string
// from YouTube — into a plain minutes count for the found card.
function durationMinutes(value) {
  if (typeof value === "number" && isFinite(value) && value > 0) {
    return Math.max(1, Math.round(value / 60));
  }
  const match = String(value || "").match(/^(\d+):(\d{1,2})/);
  if (match) return Math.max(1, Math.round(Number(match[1]) + Number(match[2]) / 60));
  return null;
}

// The found card: what matched (title, artist when known), the rough length,
// and the honest "download in progress" line before the bytes move.
async function announceFound(ctx, song) {
  const minutes = durationMinutes(song.duration);
  const lines = ["✅ Found it: " + (song.artist ? song.artist + " — " : "") + song.title];
  if (minutes) lines.push("⏱️ About " + minutes + " minute" + (minutes === 1 ? "" : "s") + " long.");
  lines.push("⬇️ Download in progress — sending the audio in a moment…");
  await ctx.reply(lines.join("\n"));
}

async function sendSong(ctx, query) {
  const { searchSong, downloadSong } = await import("../src/saavn.js");
  const { audiusFullTrack } = await import("../src/audius.js");
  const { identifyTrack, fetchBuffer, searchQuality } = await import("../src/apis.js");
  await ctx.reply("🔍 Searching the music libraries for *" + query + "* …");
  // One identification up front, shared by every stage — the preview fallback
  // no longer needs a second call to Apple.
  const identified = await identifyTrack(query).catch(() => null);
  let song = null;
  try {
    song = await searchSong(query, identified); // metadata first — bytes only after the found card
  } catch {
    song = null;
  }
  if (song && (song.artistVerified || !song.expectedArtist) && searchQuality(query, song) === "strong") {
    await announceFound(ctx, song);
    try {
      const full = await downloadSong(query, song);
      await ctx.typing(800);
      return sendAudioBuffer(ctx, full);
    } catch {
      /* the library copy failed to transfer — say so, then keep going */
      await ctx.reply("That copy would not transfer — trying YouTube next…").catch(() => {});
    }
  }
  // A fuzzy match for a mistyped name is not a confirmation: a weak match
  // moves on quietly instead of announcing the wrong song as "Found it".
  // YouTube via NABEES comes first among the fallbacks — a real YouTube
  // search and convert, the most reliable full-track source there is. It is
  // ALWAYS on: the free NABEES key works, a personal NABEES_API_KEY only
  // raises the quota. A missing key must never switch the service off again.
  try {
    const found = await searchYouTubeNabees(query);
    const audio = await resolveYouTubeAudioNabees(found.url);
    const buffer = await fetchBuffer(audio.url, { timeoutMs: 60000, label: "rescue stream" });
    if (buffer.length < 150 * 1024) throw new Error("the rescue stream came back broken");
    await announceFound(ctx, { title: audio.title || found.title });
    await ctx.typing(800);
    return await ctx.send({ audio: buffer, mimetype: "audio/mpeg", fileName: cleanTitle(audio.title || found.title) + ".mp3", ptt: false });
  } catch {
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
  if (identified?.preview) {
    // The preview is downloaded and checked BEFORE it is offered: a bare URL
    // send on a bad host is exactly how that 3-second wreck got delivered.
    // Under 150KB is a broken transfer — silence beats junk.
    let previewBuffer = null;
    try {
      previewBuffer = await fetchBuffer(identified.preview, { timeoutMs: 45000, label: "preview" });
    } catch { previewBuffer = null; }
    if (previewBuffer && previewBuffer.length >= 150 * 1024) {
      await ctx.reply(
        "The full-track services are refusing me right now, so here is the official preview of \"" +
        identified.track + "\" by " + identified.artist + " instead — try again later for the whole song."
      );
      return await ctx.send({
        audio: previewBuffer,
        mimetype: "audio/mpeg",
        fileName: cleanTitle(identified.artist + " - " + identified.track + " (preview)") + ".mp3",
        ptt: false
      });
    }
  }
  throw new Error(
    "I could not get a clean copy of that song — try the exact title, and if it still refuses, every source is refusing that one right now"
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
