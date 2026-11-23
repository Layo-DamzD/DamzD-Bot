import {
  requestExternalJson,
  unicodeBox,
  withPoweredFooter
} from "../lib/api-client.js";

const LYRICS_API = "https://api.omegatech.app/api/tools/lyrics";
const LYRICS_HOSTS = new Set(["azlyrics.com", "genius.com", "musixmatch.com"]);

function safeLyricsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password ||
        !Array.from(LYRICS_HOSTS).some(root => host === root || host.endsWith("." + root))) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function safeText(value, limit, fallback) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
}

export default {
  name: "lyrics",
  category: "Media & Tools",
  description: "Find a song's artist and official lyrics page with only a short excerpt.",
  run: async ctx => {
    const query = String(ctx.args || "").trim();
    if (!query) throw new Error("Usage: " + ctx.config.prefix + "lyrics song title or artist");
    if (query.length > 180) throw new Error("Keep the song search under 180 characters.");

    const payload = await requestExternalJson(LYRICS_API, { query }, 15000);
    if (payload && payload.found === false) throw new Error("No matching song was found. Try the title and artist.");

    const title = safeText(payload && payload.title, 180, query);
    const artist = safeText(payload && payload.artist, 180, "Unknown artist");
    const rawLyrics = String(payload && payload.lyrics || "").replace(/\s+/g, " ").trim();
    const excerpt = rawLyrics ? rawLyrics.slice(0, 90) + (rawLyrics.length > 90 ? "…" : "") : "";
    const source = safeLyricsUrl(payload && payload.url);
    const lines = [
      "🎵 *Title:* " + title,
      "🎤 *Artist:* " + artist,
      excerpt ? "Short excerpt: “" + excerpt + "”" : "",
      source ? "Lyrics page: " + source : "No official lyrics page was returned."
    ].filter(Boolean);

    await ctx.reply(withPoweredFooter(unicodeBox("🎼 LYRICS SEARCH", lines.join("\n"), { footer: false }), 1800));
  }
};
