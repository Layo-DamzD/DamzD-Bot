// Tool-section commands: sticker conversion (ffmpeg), view-once resend,
// media saving, profile pictures, website screenshots, URL shortening,
// Bible lookups, couple avatars and TikTok lookups. Every network feature
// degrades to a clear error message instead of pretending.
import { spawn } from "node:child_process";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { validateHttpUrl, withPoweredFooter } from "../lib/api-client.js";
import { getContextInfo, normalizeJid, numberFromJid, unwrapMessage } from "../lib/message-utils.js";
import { findAnyMediaNode } from "../src/damzd/viewonce.js";

const BIBLE_API = "https://bible-api.com/";
const SHORTEN_API = "https://is.gd/create.php";
const NEKOS_ROOT = "https://nekos.best/api/v2/";

function quoted(ctx) {
  const info = getContextInfo(ctx.msg?.message);
  if (!info?.stanzaId || !info?.quotedMessage) return null;
  const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).filter(Boolean);
  const participant = normalizeJid(info.participant || "");
  const key = {
    remoteJid: String(ctx.msg?.key?.remoteJid || ctx.jid || ""),
    id: String(info.stanzaId),
    fromMe: Boolean(participant && selfIds.includes(participant))
  };
  if (participant) key.participant = participant;
  return { key, message: info.quotedMessage, participant };
}

async function downloadQuotedMedia(ctx, hint) {
  const target = quoted(ctx);
  if (!target) {
    throw new Error("Reply to " + hint + " with " + ctx.config.prefix + ctx.commandName + ".");
  }
  const found = findAnyMediaNode(target.message);
  if (!found) throw new Error("The replied-to message carries no image, video, audio or document.");
  const nodeKey = found.key; // e.g. imageMessage
  const kind = nodeKey.replace(/Message$/, "");
  let buffer;
  try {
    buffer = await downloadMediaMessage(
      { key: target.key, message: target.message, messageTimestamp: ctx.msg?.messageTimestamp },
      "buffer",
      {},
      { reuploadRequest: ctx.sock.updateMediaMessage }
    );
  } catch (error) {
    throw new Error("The media could not be downloaded (" +
      String(error?.message || error).slice(0, 140) + "). Try again while the sender is online.");
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("WhatsApp returned no media data.");
  return { kind, node: found.node, buffer };
}

function payloadForMedia(kind, buffer, node) {
  const caption = String(node?.caption || "").slice(0, 800);
  if (kind === "image") return { image: buffer, ...(caption ? { caption } : {}) };
  if (kind === "video") return { video: buffer, ...(caption ? { caption } : {}) };
  if (kind === "audio") return { audio: buffer, mimetype: node?.mimetype || "audio/mpeg", ptt: Boolean(node?.ptt) };
  if (kind === "document") {
    return {
      document: buffer,
      mimetype: node?.mimetype || "application/octet-stream",
      fileName: String(node?.fileName || "file").slice(0, 160),
      ...(caption ? { caption } : {})
    };
  }
  return { sticker: buffer }; // stickerMessage and anything odd
}

function runFfmpeg(args, inputBuffer) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.stdin.on("error", () => { /* ffmpeg may close stdin early */ });
    child.on("error", error => {
      if (error?.code === "ENOENT") {
        reject(new Error("ffmpeg is not installed on this host, so stickers cannot be converted here."));
      } else {
        reject(new Error("ffmpeg failed to start: " + String(error?.message || error).slice(0, 160)));
      }
    });
    child.on("close", code => {
      const output = Buffer.concat(chunks);
      if (code === 0 && output.length) resolve(output);
      else reject(new Error("ffmpeg could not process this media: " + stderr.slice(-300).trim()));
    });
    child.stdin.end(inputBuffer);
  });
}

async function fetchJson(url, options, label, timeoutMs = 15000) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "DamzD-Bot (https://github.com/Layo-DamzD/DamzD-Bot)" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      ...options
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long to answer. Try again shortly.");
    }
    throw new Error("Could not reach " + label + ".");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(label + " returned an unreadable response.");
  }
  return { ok: response.ok, payload };
}

const commands = [
  {
    name: "sticker",
    aliases: ["s"],
    category: "Tools",
    description: "Turn an image or short video into a sticker (reply to it).",
    run: async ctx => {
      const media = await downloadQuotedMedia(ctx, "an image, GIF or short video");
      const isVideo = ["video", "audio"].includes(media.kind);
      const args = isVideo
        ? ["-hide_banner", "-loglevel", "error", "-t", "6", "-i", "pipe:0", "-an",
           "-vf", "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2",
           "-c:v", "libwebp", "-q:v", "60", "-loop", "0", "-f", "webp", "pipe:1"]
        : ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
           "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2",
           "-c:v", "libwebp", "-q:v", "80", "-frames:v", "1", "-f", "webp", "pipe:1"];
      const webp = await runFfmpeg(args, media.buffer);
      if (webp.length > 1024 * 1024) throw new Error("The sticker came out too large; try a shorter clip or smaller image.");
      await ctx.send({ sticker: webp });
    }
  },
  {
    name: "sendvv",
    category: "Tools",
    description: "Resend a photo/video as view-once.",
    run: async ctx => {
      const media = await downloadQuotedMedia(ctx, "a photo, video, voice note or document");
      if (["sticker"].includes(media.kind)) {
        throw new Error("Stickers cannot be sent as view-once. Reply to a photo, video or document.");
      }
      const payload = payloadForMedia(media.kind, media.buffer, media.node);
      await ctx.send({ ...payload, viewOnce: true });
    }
  },
  {
    name: "save",
    category: "Tools",
    description: "Save a replied-to status or media to your own DM.",
    run: async ctx => {
      const media = await downloadQuotedMedia(ctx, "the media you want saved");
      const owner = String(ctx.config.ownerNumber || "").replace(/\D/g, "");
      if (!owner) throw new Error("No owner number is configured, so there is nowhere to save this.");
      const target = owner + "@s.whatsapp.net";
      await ctx.sock.sendMessage(target, payloadForMedia(media.kind, media.buffer, media.node));
      await ctx.reply("💾 Saved to your private chat with DamzD (+" + owner + ").");
    }
  },
  {
    name: "pp",
    category: "Tools",
    description: "Show profile picture of you or a replied-to user.",
    run: async ctx => {
      const target = normalizeJid(quoted(ctx)?.participant || ctx.senderJid || "");
      if (!target) throw new Error("Could not resolve the WhatsApp ID to look up.");
      let url;
      try {
        url = await ctx.sock.profilePictureUrl(target, "image");
      } catch {
        url = undefined;
      }
      if (!url) {
        await ctx.reply("🖼️ No profile photo is set for +" + (numberFromJid(target) || target) + ".");
        return;
      }
      await ctx.send({ image: { url }, caption: "🖼️ Profile photo of +" + (numberFromJid(target) || target) });
    }
  },
  {
    name: "couplepp",
    category: "Tools",
    description: "Matching couple profile pictures.",
    run: async ctx => {
      const [her, him] = await Promise.all([
        fetchJson(NEKOS_ROOT + "waifu?results=1", {}, "the couple image service"),
        fetchJson(NEKOS_ROOT + "husbando?results=1", {}, "the couple image service")
      ]);
      const hers = her.payload?.results?.[0]?.url;
      const his = him.payload?.results?.[0]?.url;
      if (!hers || !his) throw new Error("The couple image service did not return a matched pair. Try again.");
      await ctx.send({ image: { url: hers }, caption: "👩 Her side of the set" });
      await ctx.send({ image: { url: his }, caption: "👨 His side of the set\n\n✦ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ" });
    }
  },
  {
    name: "shortenurl",
    aliases: ["shorturl"],
    category: "Tools",
    description: "Shorten a link.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim().split(/\s+/)[0] || "";
      const target = validateHttpUrl(raw, "link to shorten");
      const { ok, payload } = await fetchJson(
        SHORTEN_API + "?format=json&url=" + encodeURIComponent(target), {}, "the shortener");
      if (!ok || !payload?.shorturl) {
        throw new Error("The shortener failed: " + String(payload?.errormessage || "unknown error").slice(0, 140));
      }
      await ctx.reply("🔗 " + target.slice(0, 180) + "\n➡️ *" + payload.shorturl + "*");
    }
  },
  {
    name: "bible",
    category: "Tools",
    description: "Look up a Bible verse.",
    run: async ctx => {
      const reference = String(ctx.args || "").trim();
      if (!reference) throw new Error("Usage: " + ctx.config.prefix + "bible John 3:16");
      if (reference.length > 120) throw new Error("Keep the reference short, e.g. John 3:16 or Psalm 23:1-3.");
      const { ok, payload } = await fetchJson(
        BIBLE_API + encodeURIComponent(reference.replace(/\s+/g, "+")) + "?translation=kjv",
        {}, "the Bible service");
      if (!ok || payload?.error) {
        throw new Error("That reference could not be found: " +
          String(payload?.details || payload?.error || "check the book, chapter and verse").slice(0, 160));
      }
      const lines = (payload.verses || [])
        .map(verse => "*" + verse.book_name + " " + verse.chapter + ":" + verse.verse + "* — " + verse.text.trim());
      await ctx.reply(withPoweredFooter(
        "✝️ *" + String(payload.reference || reference).slice(0, 120) + "* (KJV)\n\n" + lines.join("\n"), 3800));
    }
  },
  {
    name: "ssweb",
    category: "AI Media",
    description: "Screenshot a website.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim().split(/\s+/)[0] || "";
      const target = validateHttpUrl(raw, "website to screenshot");
      const shot = "https://image.thum.io/get/width/1200/" + target;
      await ctx.reply("📸 Rendering " + target.slice(0, 120) + " ...");
      await ctx.send({ image: { url: shot }, caption: "🖥️ Screenshot of " + target.slice(0, 150) });
    }
  },
  {
    name: "tiktokstalk",
    category: "Tools",
    description: "Look up a TikTok profile.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (!raw) throw new Error("Usage: " + ctx.config.prefix + "tiktokstalk @username — or a TikTok video link");
      const videoMatch = raw.match(/tiktok\.com\/[@\w.\-/]+\/video\/(\d+)/i);
      if (videoMatch) {
        const { ok, payload } = await fetchJson(
          "https://www.tiktok.com/oembed?url=" +
          encodeURIComponent("https://www.tiktok.com/@x/video/" + videoMatch[1]),
          {}, "TikTok's info service");
        if (!ok || !payload?.author_name) throw new Error("TikTok did not return info for that link.");
        await ctx.reply([
          "🎵 *TIKTOK VIDEO*",
          "Author: " + String(payload.author_name || "?").slice(0, 80),
          "Handle: " + String(payload.author_unique_id || payload.author_url || "?").slice(0, 80),
          payload.title ? "Caption: " + String(payload.title).slice(0, 200) : "",
          payload.thumbnail_url ? "🖼️ " + payload.thumbnail_url : ""
        ].filter(Boolean).join("\n"));
        return;
      }
      const username = raw.replace(/^@/, "").replace(/[^\w.]/g, "").slice(0, 40);
      if (!username) throw new Error("Send a TikTok username, e.g. " + ctx.config.prefix + "tiktokstalk @damzd");
      const response = await fetch("https://www.tiktok.com/@" + username, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 DamzD-Bot" },
        signal: AbortSignal.timeout(15000),
        redirect: "follow"
      }).catch(() => null);
      const html = response && response.ok ? await response.text() : "";
      const nickname = html.match(/"nickname":"([^"]{1,80})"/)?.[1];
      const fans = html.match(/"fans":(\d+)/)?.[1];
      const hearts = html.match(/"heart":(\d+)/)?.[1];
      const following = html.match(/"following":(\d+)/)?.[1];
      if (!nickname) {
        throw new Error("TikTok would not share that profile from this network (they block automated reads often)." +
          " Try a video link instead: " + ctx.config.prefix + "tiktokstalk <link to any of their videos>");
      }
      const format = value => value ? Number(value).toLocaleString("en-US") : "?";
      await ctx.reply([
        "👤 *TIKTOK PROFILE*",
        "Nickname: " + nickname,
        "Handle: @" + username,
        "Followers: " + format(fans),
        "Following: " + format(following),
        "❤️ Likes: " + format(hearts),
        "",
        "🔗 https://www.tiktok.com/@" + username
      ].join("\n"));
    }
  }
];
export default commands;
