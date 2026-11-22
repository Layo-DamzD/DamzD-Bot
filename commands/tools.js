import { downloadContentFromMessage } from "baileys";
import { numberFromJid } from "../src/utils.js";
import { fetchBuffer, tiktokStalk, lyricsFor, bibleVerse, wikipediaRandom, nasaToday, pokemonInfo, shortenUrl } from "../src/apis.js";
import { toStickerWebp } from "../src/mediautil.js";
import { getCached } from "../src/cache.js";

function pickReply(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const MEDIA_PATHS = {
  image: "/mms/image",
  video: "/mms/video",
  audio: "/mms/audio",
  sticker: "/mms/image",
  document: "/mms/document"
};

function synthesizedDirectPath(node, kind) {
  // WhatsApp strips url and directPath from quoted copies of view-once media,
  // but the encrypted-file hash and the mediaKey survive the strip — and the
  // CDN path is just /mms/<type>/<hash>, the exact shape Baileys' own uploader
  // builds. With the mediaKey that is enough to fetch and decrypt the
  // original, even when the bot never saw the view-once itself.
  const hash = node?.fileEncSha256;
  if (!hash || !node?.mediaKey) return null;
  const path = MEDIA_PATHS[kind];
  if (!path) return null;
  const b64 = Buffer.isBuffer(hash) || hash instanceof Uint8Array
    ? Buffer.from(hash).toString("base64")
    : String(hash);
  const encoded = encodeURIComponent(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  return path + "/" + encoded;
}

async function downloadVia(node, kind) {
  const stream = await downloadContentFromMessage(node, kind === "sticker" ? "sticker" : kind);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadNode(node, kind) {
  try {
    return await downloadVia(node, kind);
  } catch (error) {
    const directPath = synthesizedDirectPath(node, kind);
    if (!directPath) throw error;
    return await downloadVia({ ...node, directPath, url: undefined }, kind);
  }
}

// Last resort for a quoted view-once: the anti-delete snapshot holds the last
// 600 arrivals with their FULL media metadata. When the view-once stash lost
// the original (restart, TTL, wrapper shape), the quote's stanza id can still
// be matched back to the cached arrival — but only when that arrival really
// was a view-once, so plain media never gets re-sent by accident.
async function cachedFromSnapshot(stanzaId) {
  try {
    const { getCached } = await import("../src/cache.js");
    const { findViewOnceCarrier } = await import("../src/viewonce.js");
    const carrier = findViewOnceCarrier(getCached(stanzaId)?.node);
    if (!carrier) return null;
    const { unwrapMessage } = await import("../src/utils.js");
    const inner = unwrapMessage(carrier);
    const kinds = [
      ["imageMessage", "image"],
      ["videoMessage", "video"],
      ["stickerMessage", "sticker"],
      ["audioMessage", "audio"]
    ];
    for (const [key, kind] of kinds) {
      if (inner[key]) return { node: inner[key], kind };
    }
    return null;
  } catch {
    return null;
  }
}

async function quotedMedia(ctx, { allowDocument = true } = {}) {
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  const quoted = info?.quotedMessage;
  if (!quoted) throw new Error("reply to the message with the media");
  const { unwrapMessage } = await import("../src/utils.js");
  const { findCachedViewOnce, readCachedMedia } = await import("../src/viewonce.js");
  const inner = unwrapMessage(quoted);
  const kinds = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["stickerMessage", "sticker"],
    ["audioMessage", "audio"],
    ...(allowDocument ? [["documentMessage", "document"]] : [])
  ];
  for (const [key, kind] of kinds) {
    const node = inner[key];
    if (!node) continue;
    try {
      return { buffer: await downloadNode(node, kind), kind, node };
    } catch (error) {
      // Quotes of a view-once arrive with the media URL and directPath
      // stripped by WhatsApp, so the download can only fail. If the bot saw
      // the original view-once in this chat, the cache still holds the full
      // metadata — match it back by the quoted stanza id and download that.
      const { refreshMediaLocation } = await import("../src/utils.js");
      const cached = await findCachedViewOnce(ctx.jid, info?.stanzaId) || await cachedFromSnapshot(info?.stanzaId);
      if (cached) {
        const captured = readCachedMedia(cached);
        if (captured) return { buffer: captured, kind: cached.kind, node: cached.node };
        try {
          return { buffer: await downloadNode(cached.node, cached.kind), kind: cached.kind, node: cached.node };
        } catch {
          // Even the stashed arrival lost its media location — the media-retry
          // protocol is the last chance for a fresh one. The sender's device
          // can answer the retry late, so one more refresh-and-download pass
          // runs before the failure stands.
          await refreshMediaLocation(ctx.sock, { remoteJid: ctx.jid, id: info?.stanzaId, participant: info?.participant }, cached.node);
          try {
            return { buffer: await downloadNode(cached.node, cached.kind), kind: cached.kind, node: cached.node };
          } catch {
            await new Promise(resolve => setTimeout(resolve, 1500));
            await refreshMediaLocation(ctx.sock, { remoteJid: ctx.jid, id: info?.stanzaId, participant: info?.participant }, cached.node);
            return { buffer: await downloadNode(cached.node, cached.kind), kind: cached.kind, node: cached.node };
          }
        }
      }
      // No cached copy at all: the quote itself still carries the mediaKey,
      // which is exactly what the retry protocol needs to re-serve the media.
      const refreshed = await refreshMediaLocation(ctx.sock, { remoteJid: info?.remoteJid || ctx.jid, id: info?.stanzaId, participant: info?.participant }, node);
      if (refreshed) {
        try {
          return { buffer: await downloadNode(node, kind), kind, node };
        } catch {
          await new Promise(resolve => setTimeout(resolve, 1500));
          await refreshMediaLocation(ctx.sock, { remoteJid: info?.remoteJid || ctx.jid, id: info?.stanzaId, participant: info?.participant }, node);
          return { buffer: await downloadNode(node, kind), kind, node };
        }
      }
      // The retry could not refresh the quote either. If the bot never
      // received this message at all (no stash, no snapshot), relaying
      // Baileys' raw "No valid media URL or directPath" error is baffling —
      // the reaction path already explains this wall honestly, so Ggs must
      // match it. The owner gets the same plain-language reason and the same
      // fix: resend while online, watch for the lock note, then react/Ggs.
      const { getCached } = await import("../src/cache.js");
      if (!getCached(info?.stanzaId)) {
        throw new Error("that message never reached me — it was sent while I was offline, restarting or re-pairing, and WhatsApp does not re-deliver missed media. Ask the sender to resend it now; watch for my 🔒 note in your own chat, then react or reply Ggs.");
      }
      throw error;
    }
  }
  // A stripped quote can lose the media node entirely — try the cache first.
  const cached = await findCachedViewOnce(ctx.jid, info?.stanzaId) || await cachedFromSnapshot(info?.stanzaId);
  if (cached) return { buffer: await downloadNode(cached.node, cached.kind), kind: cached.kind, node: cached.node };
  throw new Error("I could not find any image, video or sticker in that message");
}

function ownNumberJid(ctx) {
  const number = String(ctx.sock?.user?.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return number ? number + "@s.whatsapp.net" : null;
}

export default [
  {
    name: "sticker",
    aliases: ["s"],
    category: "Tools",
    description: "turn an image or short video into a sticker (reply to it)",
    run: async ctx => {
      await ctx.typing(1200);
      const media = await quotedMedia(ctx);
      const webp = await toStickerWebp(media.buffer, { isVideo: media.kind === "video" });
      await ctx.send({ sticker: webp });
    }
  },
  {
    // Stealth skin: the menu shows a harmless gaming command, and typing it
    // casually answers "GGs!" — but with a view-once quoted it silently does
    // the recovery exactly like the old .vv did. The old name is gone
    // everywhere (aliases show up in the menu, so .vv is not kept as one).
    name: "Ggs",
    aliases: ["gg"],
    category: "Tools",
    description: "say good game to the squad 🎮",
    run: async ctx => {
      const hasQuoted = Boolean(ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage);
      if (!hasQuoted) {
        await ctx.reply(pickReply(["GGs! 🎮🔥", "Good game! 🎮", "GG — well played. 🎮🔥"]));
        return;
      }
      const target = ownNumberJid(ctx);
      if (!target) throw new Error("I could not resolve your own chat");
      // A LID-mode DM renders as a 12-digit privacy id, not a phone number —
      // never pretend it is one (the old "+" + digits produced nonsense like
      // +251814620463268). Say "a contact" instead.
      const jid = String(ctx.jid || "");
      const source = ctx.isGroup ? "a group" : (jid.endsWith("@lid") ? "a contact" : "+" + numberFromJid(jid));
      // House rule: nothing — no reply, no reaction, no typing indicator —
      // is ever sent back to the chat the media came from. The person who
      // sent the view-once will never know it was recovered. Everything
      // lands quietly in your own "Message yourself" chat.
      try {
        const media = await quotedMedia(ctx, { allowDocument: true });
        const origin = "From: " + source;
        if (media.kind === "image") {
          await ctx.sock.sendMessage(target, { image: media.buffer, caption: "👀 Recovered view-once\n" + origin + (media.node?.caption ? "\n\n" + media.node.caption : "") });
        } else if (media.kind === "video") {
          await ctx.sock.sendMessage(target, { video: media.buffer, mimetype: "video/mp4", caption: "👀 Recovered view-once\n" + origin + (media.node?.caption ? "\n\n" + media.node.caption : "") });
        } else if (media.kind === "audio") {
          await ctx.sock.sendMessage(target, { audio: media.buffer, mimetype: media.node?.mimetype || "audio/mpeg", ptt: media.node?.ptt === true });
          await ctx.sock.sendMessage(target, { text: "👀 Recovered voice note\n" + origin });
        } else if (media.kind === "sticker") {
          await ctx.sock.sendMessage(target, { sticker: media.buffer });
          await ctx.sock.sendMessage(target, { text: "👀 Recovered sticker\n" + origin });
        } else {
          await ctx.sock.sendMessage(target, { document: media.buffer, fileName: media.node?.fileName || "file", mimetype: media.node?.mimetype || "application/octet-stream" });
          await ctx.sock.sendMessage(target, { text: "👀 Recovered file\n" + origin });
        }
      } catch (error) {
        // Even failures stay out of the original chat — and for other people
        // they stay out of everywhere, because a "could not recover" DM would
        // reveal what the command really does. Only the owner gets the note.
        if (ctx.isOwner) {
          await ctx.sock.sendMessage(target, { text: "I could not recover that one (from " + source + ") — " + String(error?.message || "it may have expired.") });
        }
      }
    }
  },
  {
    name: "sendvv",
    category: "Tools",
    description: "resend a photo/video as view-once",
    run: async ctx => {
      await ctx.typing(1000);
      const media = await quotedMedia(ctx, { allowDocument: false });
      if (media.kind === "image") {
        await ctx.send({ viewOnceMessage: { message: { imageMessage: { ...media.node, url: undefined, image: media.buffer } } } });
      } else if (media.kind === "video") {
        await ctx.send({ viewOnceMessage: { message: { videoMessage: { ...media.node, url: undefined, video: media.buffer } } } });
      } else {
        throw new Error("only photos and videos can be sent as view-once");
      }
    }
  },
  {
    name: "vvinfo",
    category: "Tools",
    description: "show metadata for a replied-to message",
    run: async ctx => {
      const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
      const quoted = info?.quotedMessage;
      if (!quoted) throw new Error("reply to a message to inspect it");
      const { unwrapMessage, messageText } = await import("../src/utils.js");
      const inner = unwrapMessage(quoted);
      const type = Object.keys(inner).find(key => key.endsWith("Message")) || "unknown";
      const mediaTypes = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"];
      const mediaNode = mediaTypes.map(key => inner[key]).find(Boolean);
      const lines = [
        "Type: *" + type + "*",
        mediaNode?.mimetype ? "MIME: " + mediaNode.mimetype : "",
        mediaNode?.fileLength ? "Size: " + Number(mediaNode.fileLength).toLocaleString() + " bytes" : "",
        mediaNode?.seconds ? "Duration: " + mediaNode.seconds + "s" : "",
        mediaNode ? "View-once: " + Boolean(quoted.viewOnceMessage || quoted.viewOnceMessageV2) : "",
        messageText(quoted) ? "Text: " + messageText(quoted).slice(0, 200) : ""
      ].filter(Boolean);
      await ctx.reply(lines.join("\n"));
    }
  },
  {
    name: "save",
    category: "Tools",
    description: "save a replied-to status or media to your own DM",
    run: async ctx => {
      await ctx.typing(1000);
      const target = ownNumberJid(ctx);
      if (!target) throw new Error("I could not resolve your own chat");
      const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
      const quoted = info?.quotedMessage;
      if (!quoted) throw new Error("reply to the status or media to save — or say save dp for a profile picture");
      const { unwrapMessage } = await import("../src/utils.js");
      const inner = unwrapMessage(quoted);
      try {
        if (inner.imageMessage) {
          const stream = await downloadContentFromMessage(inner.imageMessage, "image");
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          await ctx.sock.sendMessage(target, { image: Buffer.concat(chunks), caption: inner.imageMessage.caption || "Saved." });
        } else if (inner.videoMessage) {
          const stream = await downloadContentFromMessage(inner.videoMessage, "video");
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          await ctx.sock.sendMessage(target, { video: Buffer.concat(chunks), caption: inner.videoMessage.caption || "Saved." });
        } else if (inner.audioMessage) {
          const stream = await downloadContentFromMessage(inner.audioMessage, "audio");
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          await ctx.sock.sendMessage(target, { audio: Buffer.concat(chunks), mimetype: "audio/mpeg" });
        } else {
          const { messageText } = await import("../src/utils.js");
          await ctx.sock.sendMessage(target, { text: messageText(quoted) || "Saved." });
        }
        await ctx.react("📥");
      } catch {
        throw new Error("I could not save that one — it may have expired");
      }
    }
  },
  {
    name: "tiktokstalk",
    category: "Tools",
    description: "look up a TikTok profile",
    run: async ctx => {
      const user = String(ctx.args || "").trim();
      if (!user) throw new Error("give me the username, e.g. " + ctx.config.prefix + "tiktokstalk @damzd");
      await ctx.typing(1200);
      const profile = await tiktokStalk(user);
      const lines = [
        "🎵 *" + profile.nickname + "* (@" + profile.username + ")",
        profile.followers !== "" ? "Followers: " + Number(profile.followers).toLocaleString() : "",
        profile.following !== "" ? "Following: " + Number(profile.following).toLocaleString() : "",
        profile.likes !== "" ? "Likes: " + Number(profile.likes).toLocaleString() : "",
        profile.videos !== "" ? "Videos: " + profile.videos : ""
      ].filter(Boolean);
      if (profile.avatar) {
        try {
          const buffer = await fetchBuffer(profile.avatar, { timeoutMs: 45000, label: "avatar service" });
          await ctx.send({ image: buffer, caption: lines.join("\n") });
          return;
        } catch {
          /* fall through to text */
        }
      }
      await ctx.reply(lines.join("\n"));
    }
  },
  {
    name: "lyrics",
    category: "Tools",
    description: "find a song's lyrics",
    run: async ctx => {
      const query = String(ctx.args || "").trim();
      if (!query) throw new Error("tell me the song, e.g. " + ctx.config.prefix + "lyrics asake lifestyle");
      await ctx.typing(1500);
      const result = await lyricsFor(query);
      await ctx.reply(
        "🎶 *" + result.track + "* — " + result.artist + "\n\n" + result.lyrics
      );
    }
  },
  {
    name: "bible",
    category: "Tools",
    description: "look up a Bible verse",
    run: async ctx => {
      const reference = String(ctx.args || "").trim();
      await ctx.typing(900);
      await ctx.reply(await bibleVerse(reference));
    }
  },
  {
    name: "wiki",
    category: "Tools",
    description: "a random Wikipedia article",
    run: async ctx => {
      await ctx.typing(1200);
      const page = await wikipediaRandom();
      await ctx.reply(
        "📚 *" + page.title + "*\n\n" + (page.extract || "no summary available") +
        (page.url ? "\n\n" + page.url : "")
      );
    }
  },
  {
    name: "nasa",
    category: "Tools",
    description: "NASA's picture of the day",
    run: async ctx => {
      await ctx.typing(1500);
      const photo = await nasaToday();
      const buffer = await fetchBuffer(photo.url, { timeoutMs: 60000, label: "NASA" });
      await ctx.send({ image: buffer, caption: "🚀 *" + photo.title + "*\n\n" + photo.explanation });
    }
  },
  {
    name: "pokemon",
    category: "Tools",
    description: "a random (or named) Pokémon",
    run: async ctx => {
      await ctx.typing(1200);
      const info = await pokemonInfo(ctx.args);
      const caption = (
        "⚡ *" + info.name + "* (#" + info.id + ")\n" +
        (info.types ? "Type: " + info.types + "\n" : "") +
        (info.abilities ? "Abilities: " + info.abilities + "\n" : "") +
        (info.height ? "Height: " + info.height + "\n" : "") +
        (info.weight ? "Weight: " + info.weight : "")
      ).trim();
      if (info.sprite) {
        const buffer = await fetchBuffer(info.sprite, { timeoutMs: 30000, label: "Pokédex" });
        await ctx.send({ image: buffer, caption });
        return;
      }
      await ctx.reply(caption);
    }
  },
  {
    name: "couplepp",
    category: "Tools",
    description: "matching couple profile pictures",
    run: async ctx => {
      await ctx.typing(1200);
      const { renderFfGirl } = await import("../src/canvas.js");
      const seeds = ["Aurora", "Leo"];
      const first = await renderFfGirl({ name: seeds[0] });
      await ctx.send({ image: first, caption: "His & hers — part 1 💙" });
      const second = await renderFfGirl({ name: seeds[1] });
      await ctx.send({ image: second, caption: "Part 2 💞 Matching set." });
    }
  },
  {
    name: "pp",
    category: "Tools",
    description: "show profile picture of you or a replied-to user",
    run: async ctx => {
      const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
      const participant = info?.participant;
      const number = participant ? String(participant).split("@")[0] : ctx.senderNumber;
      await ctx.typing(900);
      try {
        const url = await ctx.sock.profilePictureUrl(number + "@s.whatsapp.net", "image");
        const buffer = await fetchBuffer(url, { timeoutMs: 45000, label: "profile picture" });
        await ctx.send({ image: buffer, caption: "*" + (participant ? "+" + number : ctx.pushName || "+" + number) + "*'s profile picture" });
      } catch {
        throw new Error("that user has no visible profile picture");
      }
    }
  },
  {
    name: "shortenurl",
    aliases: ["shorturl", "tinyurl", "urlshort"],
    category: "Tools",
    description: "shorten a link",
    run: async ctx => {
      const url = String(ctx.args || "").trim();
      if (!url) throw new Error("send the link to shorten");
      await ctx.typing(800);
      const short = await shortenUrl(url);
      await ctx.reply("🔗 " + short);
    }
  },
  {
    name: "removebg",
    category: "Tools",
    description: "remove an image background (needs an API key)",
    run: async ctx => {
      const key = String(process.env.PHOTOROOM_API_KEY || "").trim();
      if (!key) {
        await ctx.reply(
          "Background removal needs a PhotoRoom API key (they have a free tier).\n" +
          "Add PHOTOROOM_API_KEY to my .env and this command will come alive."
        );
        return;
      }
      await ctx.typing(1500);
      const media = await quotedMedia(ctx, { allowDocument: false });
      let response;
      try {
        response = await fetch("https://image.photoroom.com/api/v1/removeBackground", {
          method: "POST",
          headers: { "x-api-key": key, "content-type": "image/jpeg", accept: "image/png" },
          body: media.buffer,
          signal: AbortSignal.timeout(90000)
        });
      } catch {
        throw new Error("the background service could not be reached");
      }
      if (!response.ok) throw new Error("the background service refused the request (" + response.status + ")");
      const buffer = Buffer.from(await response.arrayBuffer());
      await ctx.send({ image: buffer, caption: "Background removed. ✂️" });
    }
  }
];
