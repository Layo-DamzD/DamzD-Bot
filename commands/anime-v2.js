import {
  POWERED_FOOTER,
  unicodeBox,
  withPoweredFooter,
  validateHttpUrl
} from "../lib/api-client.js";

const ANILIST = "https://graphql.anilist.co";
const NEKOS_ROOT = "https://nekos.best/api/v2";
const APP_HEADERS = {
  "user-agent": "BenfeiAnime (https://benfeitech.com)",
  accept: "application/json"
};
const TIMEOUT_MS = 20000;

export const ANIME_REACTION_NAMES = Object.freeze([
  "angry",
  "baka",
  "bleh",
  "blowkiss",
  "blush",
  "bored",
  "carry",
  "clap",
  "confused",
  "cry",
  "cuddle",
  "dance",
  "facepalm",
  "feed",
  "handhold",
  "handshake",
  "happy",
  "highfive",
  "hug",
  "kabedon",
  "kiss",
  "lappillow",
  "laugh",
  "lurk",
  "nod",
  "nom",
  "nope",
  "nya",
  "pat",
  "peck",
  "poke",
  "pout",
  "run",
  "salute",
  "shake",
  "shocked",
  "shrug",
  "sip",
  "sleep",
  "smile",
  "smug",
  "spin",
  "stare",
  "teehee",
  "think",
  "thumbsup",
  "tickle",
  "wag",
  "wave",
  "wink",
  "yawn",
  "yeet"
]);

const C_INFO = "Anime Info";
const C_RANK = "Anime Rankings";
const C_RANDOM = "Anime Random";
const C_TOOLS = "Anime Tools";
const C_IMAGES = "Anime Images";
const C_GIFS = "Anime GIFs";

const MEDIA_FIELDS = [
  "id siteUrl format status episodes chapters volumes season seasonYear averageScore popularity favourites genres isAdult",
  "description(asHtml: false)",
  "title { romaji english native }",
  "coverImage { extraLarge large }",
  "bannerImage",
  "startDate { year month day }",
  "endDate { year month day }",
  "studios(isMain: true) { nodes { name } }"
].join(" ");

const LIST_QUERY = "query($t: MediaType, $sort: [MediaSort], $page: Int, $per: Int, " +
  "$st: MediaStatus, $season: MediaSeason, $year: Int, $g: String) {" +
  " Page(page: $page, perPage: $per) {" +
  "  media(type: $t, sort: $sort, status: $st, season: $season, seasonYear: $year, genre: $g," +
  "        isAdult: false, genre_not_in: [\"Hentai\", \"Ecchi\"]) {" + MEDIA_FIELDS + "}" +
  " }" +
  "}";

let registeredCommands = [];

export function cleanAnimeText(value, limit = 600) {
  let text = String(value == null ? "" : value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/~![\s\S]*?!~/g, "[spoiler hidden]")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const cp = Number.parseInt(n, 16);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    })
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number.parseInt(n, 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > limit) text = text.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
  return text;
}

function safeHttpsUrl(value, label = "media") {
  try {
    const parsed = new URL(validateHttpUrl(String(value || ""), label));
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function titleName(title) {
  title = title || {};
  return title.english || title.romaji || title.native || "Unknown";
}

function score(media) {
  return media && media.averageScore ? (media.averageScore / 10).toFixed(1) : "N/A";
}

function pretty(value) {
  return String(value || "?").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function dateText(date) {
  if (!date || !date.year) return "?";
  const parts = [String(date.year)];
  if (date.month) parts.push(String(date.month).padStart(2, "0"));
  if (date.day) parts.push(String(date.day).padStart(2, "0"));
  return parts.join("-");
}

function secondsText(value) {
  let seconds = Math.max(0, Math.floor(Number(value) || 0));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  return [days ? days + "d" : "", hours ? hours + "h" : "", minutes + "m"].filter(Boolean).join(" ");
}

function cover(media) {
  const image = media && media.coverImage;
  return safeHttpsUrl(image && (image.extraLarge || image.large), "anime cover image");
}

function formatMedia(media, synopsisLimit = 600) {
  const title = media && media.title || {};
  const size = [];
  if (media.episodes) size.push(media.episodes + " eps");
  if (media.chapters) size.push(media.chapters + " ch");
  if (media.volumes) size.push(media.volumes + " vol");

  const studios = media.studios && media.studios.nodes
    ? media.studios.nodes.map(studio => studio.name).filter(Boolean).join(", ")
    : "";
  const lines = ["*" + titleName(title) + "*"];
  if (title.native) lines.push("🇯🇵 " + cleanAnimeText(title.native, 100));
  lines.push(
    "⭐ Score: " + score(media) + "   ❤️ Favorites: " + (Number(media.favourites) || 0).toLocaleString("en-US"),
    "📺 " + pretty(media.format) + " • " + (size.join(" • ") || "?") + " • " + pretty(media.status),
    "📅 " + dateText(media.startDate) + " → " + dateText(media.endDate)
  );
  if (studios) lines.push("🎬 " + cleanAnimeText(studios, 180));
  if (Array.isArray(media.genres) && media.genres.length) lines.push("🎭 " + media.genres.join(", "));
  lines.push("", cleanAnimeText(media.description, synopsisLimit) || "No synopsis available.", "");
  const url = safeHttpsUrl(media.siteUrl, "AniList page");
  if (url) lines.push("🔗 " + url);
  return lines.join("\n");
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = TIMEOUT_MS, headers = {}, ...fetchOptions } = options;
  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers: { ...APP_HEADERS, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow"
    });
  } catch (error) {
    throw new Error(error && error.name === "TimeoutError"
      ? "The anime service took too long to respond."
      : "Could not reach the anime service. Try again later.");
  }

  if (!response.ok) {
    if (response.status === 429) throw new Error("The service rate limit was reached. Wait a little and try again.");
    throw new Error("The service returned HTTP " + response.status + ".");
  }

  try {
    return await response.json();
  } catch {
    throw new Error("The anime service returned unreadable data.");
  }
}

export async function anilistQuery(query, variables = {}) {
  let response;
  try {
    response = await fetch(ANILIST, {
      method: "POST",
      headers: { ...APP_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(error && error.name === "TimeoutError"
      ? "AniList took too long to respond."
      : "Could not connect to AniList. Try again later.");
  }

  if (response.status === 429) throw new Error("AniList rate limit reached. Wait a minute and try again.");
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("AniList returned an unreadable response.");
  }
  if (payload.errors && payload.errors.length) {
    const first = payload.errors[0];
    const message = String(first.message || "AniList request failed.");
    if (first.status === 429) throw new Error("AniList rate limit reached. Wait a minute and try again.");
    if (first.status === 404 || /not found/i.test(message)) throw new Error("Nothing found for that search.");
    throw new Error("AniList: " + message.slice(0, 180));
  }
  if (!response.ok) throw new Error("AniList returned HTTP " + response.status + ".");
  if (!payload.data) throw new Error("AniList did not return the requested data.");
  return payload.data;
}

export async function findAnimeMedia(search, type = "ANIME", extra = "") {
  const query = "query($s: String, $t: MediaType) { Media(search: $s, type: $t, isAdult: false, " +
    "genre_not_in: [\"Hentai\", \"Ecchi\"]) { " + MEDIA_FIELDS + " " + extra + " } }";
  const data = await anilistQuery(query, { s: search, t: type });
  if (!data.Media || data.Media.isAdult) throw new Error("No suitable result was found for that search.");
  return data.Media;
}

async function mediaList(kind = "ANIME", sort = "POPULARITY_DESC", per = 10, page = 1, extra = {}) {
  const variables = { t: kind, sort: [sort], page, per, st: null, season: null, year: null, g: null };
  if (extra.status) variables.st = extra.status;
  if (extra.season) variables.season = extra.season;
  if (extra.year) variables.year = extra.year;
  if (extra.genre) variables.g = extra.genre;
  const data = await anilistQuery(LIST_QUERY, variables);
  const items = (data.Page && data.Page.media || []).filter(item =>
    item && !item.isAdult && !(item.genres || []).some(genre => ["Hentai", "Ecchi"].includes(genre))
  );
  if (!items.length) throw new Error("No matching anime or manga was found.");
  return items;
}

function result(title, text, image = null, gif = null) {
  return { title, text: String(text || ""), image, gif };
}

async function sendAnimeResult(ctx, data) {
  const title = cleanAnimeText(data.title || "Anime", 140);
  const rawBody = String(data.text || (data.image || data.gif ? "Media attached below." : "No details were returned."));
  const body = rawBody.split(/\r?\n/).map(line => cleanAnimeText(line, 600)).join("\n").slice(0, 3400);
  await ctx.reply(unicodeBox(title, body, { footer: true }), false);

  if (data.image) {
    const url = safeHttpsUrl(data.image, "image");
    if (url) {
      const caption = withPoweredFooter("🖼 *" + title + "*", 800);
      await ctx.send({ image: { url }, caption }, false);
    }
  }
  if (data.gif) {
    const url = safeHttpsUrl(data.gif, "GIF");
    if (url) {
      const caption = withPoweredFooter("🎞 *" + title + "*", 800);
      await ctx.send({ video: { url }, gifPlayback: true, caption }, false);
    }
  }
}

function makeCommand(name, category, description, runner, options = {}) {
  return {
    name,
    category,
    description,
    run: async ctx => {
      const arg = String(ctx.args || "").trim();
      if (options.required && !arg) {
        await ctx.reply("Usage: " + ctx.config.prefix + name + " <" + (options.label || "name") + ">.", false);
        return;
      }
      if (arg.length > (options.maxLength || 180)) {
        await ctx.reply("Please keep the command argument under " + (options.maxLength || 180) + " characters.", false);
        return;
      }
      if (options.progress !== false) {
        await ctx.reply("⏳ _" + (options.progressText || "Fetching anime information") + ". Please wait while the service responds._", false);
      }
      try {
        const data = await runner(arg, ctx);
        await sendAnimeResult(ctx, data);
      } catch (error) {
        console.warn("Anime command ." + name + " failed:", error && error.message ? error.message : error);
        const message = String(error && error.message || "The request could not be completed.").slice(0, 220);
        await ctx.reply("⚠️ " + message + "\n" + POWERED_FOOTER, false);
      }
    }
  };
}

function formatTopList(items) {
  return items.map((media, i) => (i + 1) + ". *" + cleanAnimeText(titleName(media.title), 120) + "* ⭐ " + score(media)).join("\n");
}

const CHAR_FIELDS = [
  "id siteUrl favourites description(asHtml: false) gender age",
  "name { full native } image { large }",
  "media(perPage: 3, sort: POPULARITY_DESC) { nodes { isAdult title { romaji english } } }"
].join(" ");

function formatCharacter(character, limit = 450) {
  const works = (character.media && character.media.nodes || [])
    .filter(item => item && !item.isAdult)
    .map(item => titleName(item.title))
    .filter(Boolean)
    .join(", ") || "N/A";
  const name = character.name || {};
  const lines = ["*" + cleanAnimeText(name.full || "Unknown character", 160) +
    (name.native ? " (" + cleanAnimeText(name.native, 80) + ")" : "") + "*"];
  const meta = [character.gender, character.age ? "Age " + character.age : ""].filter(Boolean).join(" • ");
  if (meta) lines.push("🧬 " + cleanAnimeText(meta, 100));
  lines.push(
    "❤️ Favorites: " + (Number(character.favourites) || 0).toLocaleString("en-US"),
    "🎬 From: " + cleanAnimeText(works, 240),
    "",
    cleanAnimeText(character.description, limit) || "No bio available.",
    ""
  );
  const url = safeHttpsUrl(character.siteUrl, "AniList page");
  if (url) lines.push("🔗 " + url);
  return lines.join("\n");
}

async function findCharacter(search) {
  const data = await anilistQuery("query($s: String) { Character(search: $s) { " + CHAR_FIELDS + " } }", { s: search });
  if (!data.Character) throw new Error("No character found for that search.");
  return data.Character;
}

async function getNekos(category) {
  const response = await fetchJson(NEKOS_ROOT + "/" + encodeURIComponent(category));
  const item = response && Array.isArray(response.results) ? response.results[0] : null;
  if (!item || !item.url) throw new Error("No image or GIF was returned for this category.");
  const url = safeHttpsUrl(item.url, "anime media");
  const host = url ? new URL(url).hostname : "";
  if (!url || (host !== "nekos.best" && !host.endsWith(".nekos.best"))) {
    throw new Error("The anime media service returned an unsupported media URL.");
  }
  return { ...item, url };
}

function buildHelp(prefix) {
  const categories = [C_INFO, C_RANK, C_RANDOM, C_TOOLS, C_IMAGES, C_GIFS];
  return categories.map(category => {
    const names = registeredCommands
      .filter(command => command.category === category && command.name !== "animemenu")
      .map(command => {
        const suffix = ["anime", "manga", "character", "charpic", "staff", "studio", "recommend", "episodes",
          "animechars", "trailer", "pictures", "streaming", "review", "genre", "animequote", "whatanime", "nextep"].includes(command.name)
          ? " <name/url>"
          : command.name === "schedule" ? " [day]" : "";
        return prefix + command.name + suffix;
      });
    return "*" + category + "*\n" + (names.join(", ") || "(none)");
  }).join("\n\n");
}

const commands = [
  {
    name: "animemenu",
    aliases: ["animehelp"],
    category: C_INFO,
    description: "List Anime V2 commands by category.",
    run: async ctx => {
      await ctx.reply(unicodeBox("📖 ᴀɴɪᴍᴇ ᴠ2 ᴍᴇɴᴜ", buildHelp(ctx.config.prefix), { footer: true }), false);
    }
  },

  makeCommand("anime", C_INFO, "Search for anime information.", async arg => {
    const media = await findAnimeMedia(arg);
    return result("📺 ᴀɴɪᴍᴇ ɪɴғᴏ", formatMedia(media), cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("manga", C_INFO, "Search for manga information.", async arg => {
    const media = await findAnimeMedia(arg, "MANGA");
    return result("📚 ᴍᴀɴɢᴀ ɪɴғᴏ", formatMedia(media), cover(media));
  }, { required: true, label: "manga title" }),

  makeCommand("character", C_INFO, "Search for a character's information.", async arg => {
    const character = await findCharacter(arg);
    return result("🧑‍🎤 ᴄʜᴀʀᴀᴄᴛᴇʀ", formatCharacter(character), safeHttpsUrl(character.image && character.image.large, "character image"));
  }, { required: true, label: "character name" }),

  makeCommand("charpic", C_INFO, "Find a character picture.", async arg => {
    const character = await findCharacter(arg);
    return result("🖼 ᴄʜᴀʀᴀᴄᴛᴇʀ ᴘɪᴄᴛᴜʀᴇ", "*" + cleanAnimeText(character.name && character.name.full, 160) + "*", safeHttpsUrl(character.image && character.image.large, "character image"));
  }, { required: true, label: "character name" }),

  makeCommand("staff", C_INFO, "Find a voice actor or anime creator.", async arg => {
    const query = "query($s: String) { Staff(search: $s) {" +
      " name { full native } primaryOccupations yearsActive homeTown favourites siteUrl" +
      " image { large } description(asHtml: false) dateOfBirth { year month day } } }";
    const data = await anilistQuery(query, { s: arg });
    const staff = data.Staff;
    if (!staff) throw new Error("No anime staff member found for that search.");
    const n = staff.name || {};
    const lines = ["*" + cleanAnimeText(n.full || "Unknown", 160) + (n.native ? " (" + cleanAnimeText(n.native, 80) + ")" : "") + "*"];
    if (staff.primaryOccupations && staff.primaryOccupations.length) lines.push("💼 " + staff.primaryOccupations.join(", "));
    if (staff.homeTown) lines.push("🏠 " + cleanAnimeText(staff.homeTown, 160));
    if (staff.dateOfBirth && staff.dateOfBirth.year) lines.push("🎂 " + dateText(staff.dateOfBirth));
    lines.push("❤️ Favorites: " + (Number(staff.favourites) || 0).toLocaleString("en-US"), "", cleanAnimeText(staff.description, 400) || "No biography available.", "");
    const site = safeHttpsUrl(staff.siteUrl, "AniList page");
    if (site) lines.push("🔗 " + site);
    return result("🎤 sᴛᴀғғ ɪɴғᴏ", lines.join("\n"), safeHttpsUrl(staff.image && staff.image.large, "staff image"));
  }, { required: true, label: "staff name" }),

  makeCommand("studio", C_INFO, "Show a studio and its popular works.", async arg => {
    const query = "query($s: String) { Studio(search: $s) {" +
      " name siteUrl favourites isAnimationStudio" +
      " media(sort: POPULARITY_DESC, perPage: 8) { nodes { isAdult averageScore title { romaji english } coverImage { large } } }" +
      " } }";
    const data = await anilistQuery(query, { s: arg });
    const studio = data.Studio;
    if (!studio) throw new Error("No anime studio found for that search.");
    const works = (studio.media && studio.media.nodes || []).filter(item => item && !item.isAdult);
    const lines = [
      "*" + cleanAnimeText(studio.name, 180) + "*",
      "❤️ Favorites: " + (Number(studio.favourites) || 0).toLocaleString("en-US"),
      "",
      "*Popular works:*",
      ...(works.length ? works.map((item, i) => (i + 1) + ". *" + cleanAnimeText(titleName(item.title), 120) + "* ⭐ " + score(item)) : ["No public works listed."])
    ];
    const site = safeHttpsUrl(studio.siteUrl, "AniList page");
    if (site) lines.push("", "🔗 " + site);
    return result("🏢 sᴛᴜᴅɪᴏ", lines.join("\n"), safeHttpsUrl(works[0] && works[0].coverImage && works[0].coverImage.large, "studio work cover"));
  }, { required: true, label: "studio name" }),

  makeCommand("recommend", C_INFO, "Find recommendations for an anime you like.", async arg => {
    const extra = "recommendations(sort: RATING_DESC, perPage: 8) {" +
      " nodes { rating mediaRecommendation { isAdult averageScore title { romaji english } coverImage { large } } } }";
    const media = await findAnimeMedia(arg, "ANIME", extra);
    const recommendations = media.recommendations && media.recommendations.nodes || [];
    const items = recommendations.map(row => row.mediaRecommendation).filter(item => item && !item.isAdult);
    if (!items.length) throw new Error("No suitable recommendations were found.");
    return result("💞 ʀᴇᴄᴏᴍᴍᴇɴᴅᴀᴛɪᴏɴs", "If you liked *" + cleanAnimeText(titleName(media.title), 150) + "*:\n\n" + formatTopList(items), cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("episodes", C_INFO, "Show available episode titles and the next air time.", async arg => {
    const media = await findAnimeMedia(arg, "ANIME", "streamingEpisodes { title } nextAiringEpisode { episode timeUntilAiring }");
    const air = media.nextAiringEpisode;
    let heading = "*" + cleanAnimeText(titleName(media.title), 160) + "*\n📺 " + (media.episodes || "?") + " episodes • " + pretty(media.status);
    if (air) heading += "\n⏰ Ep " + air.episode + " airs in " + secondsText(air.timeUntilAiring);
    const eps = media.streamingEpisodes || [];
    const body = eps.length ? eps.slice(0, 20).map(ep => "• " + cleanAnimeText(ep.title, 90)).join("\n") : "(No episode titles available.)";
    return result("🎞 ᴇᴘɪsᴏᴅᴇs", heading + "\n\n" + body, cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("animechars", C_INFO, "List an anime's main characters.", async arg => {
    const extra = "characters(sort: FAVOURITES_DESC, perPage: 10) { edges { role node { name { full } image { large } } } }";
    const media = await findAnimeMedia(arg, "ANIME", extra);
    const edges = media.characters && media.characters.edges || [];
    if (!edges.length) throw new Error("No characters were listed for this anime.");
    const lines = edges.map((edge, i) => (i + 1) + ". *" + cleanAnimeText(edge.node && edge.node.name && edge.node.name.full, 120) + "* (" + pretty(edge.role) + ")");
    return result("👥 ᴀɴɪᴍᴇ ᴄʜᴀʀᴀᴄᴛᴇʀs", "*" + cleanAnimeText(titleName(media.title), 160) + "* cast:\n\n" + lines.join("\n"), safeHttpsUrl(edges[0].node && edges[0].node.image && edges[0].node.image.large, "character image"));
  }, { required: true, label: "anime title" }),

  makeCommand("trailer", C_INFO, "Find the listed trailer for an anime.", async arg => {
    const media = await findAnimeMedia(arg, "ANIME", "trailer { id site }");
    const trailer = media.trailer;
    if (!trailer || !trailer.id) throw new Error("No trailer is listed for " + titleName(media.title) + ".");
    let url = "";
    if (trailer.site === "youtube") url = "https://youtu.be/" + encodeURIComponent(trailer.id);
    else if (trailer.site === "dailymotion") url = "https://www.dailymotion.com/video/" + encodeURIComponent(trailer.id);
    if (!url) throw new Error("The listed trailer uses an unsupported video platform.");
    return result("🎬 ᴛʀᴀɪʟᴇʀ", "*" + cleanAnimeText(titleName(media.title), 160) + "*\n🎬 " + url, cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("pictures", C_INFO, "Show an anime's cover or banner art.", async arg => {
    const media = await findAnimeMedia(arg);
    const image = safeHttpsUrl(media.bannerImage, "anime banner") || cover(media);
    if (!image) throw new Error("No public cover or banner image is available.");
    return result("🖼 ᴀɴɪᴍᴇ ᴘɪᴄᴛᴜʀᴇ", "*" + cleanAnimeText(titleName(media.title), 160) + "*", image);
  }, { required: true, label: "anime title" }),

  makeCommand("streaming", C_INFO, "Find listed streaming services for an anime.", async arg => {
    const media = await findAnimeMedia(arg, "ANIME", "externalLinks { site url type }");
    const links = (media.externalLinks || []).filter(link => link && link.type === "STREAMING" && safeHttpsUrl(link.url, "streaming link"));
    if (!links.length) throw new Error("No streaming links are listed for that anime.");
    return result("📡 ᴡʜᴇʀᴇ ᴛᴏ ᴡᴀᴛᴄʜ", "*" + cleanAnimeText(titleName(media.title), 160) + "*\n\n" +
      links.slice(0, 8).map(link => "• *" + cleanAnimeText(link.site, 80) + "*: " + safeHttpsUrl(link.url, "streaming link")).join("\n"), cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("review", C_INFO, "Show a highly rated review for an anime.", async arg => {
    const extra = "reviews(limit: 1, sort: RATING_DESC) { nodes { summary body(asHtml: false) score user { name } siteUrl } }";
    const media = await findAnimeMedia(arg, "ANIME", extra);
    const reviews = media.reviews && media.reviews.nodes || [];
    if (!reviews.length) throw new Error("No reviews were found for that anime.");
    const review = reviews[0];
    const lines = [
      "*" + cleanAnimeText(titleName(media.title), 160) + "*",
      "👤 " + cleanAnimeText(review.user && review.user.name || "Unknown user", 80) + "   ⭐ " + (review.score || "?") + "/100",
      "",
      "_" + cleanAnimeText(review.summary, 150) + "_",
      "",
      cleanAnimeText(review.body, 650)
    ];
    const site = safeHttpsUrl(review.siteUrl, "review page");
    if (site) lines.push("", "🔗 " + site);
    return result("📝 ᴀɴɪᴍᴇ ʀᴇᴠɪᴇᴡ", lines.join("\n"), cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("genres", C_INFO, "List public anime genres.", async () => {
    const data = await anilistQuery("{ GenreCollection }");
    const genres = (data.GenreCollection || []).filter(genre => !["hentai", "ecchi"].includes(String(genre).toLowerCase())).sort();
    if (!genres.length) throw new Error("The genre list is unavailable.");
    return result("🎭 ᴀɴɪᴍᴇ ɢᴇɴʀᴇs", "Use *genre <name>* to get a top anime from a genre.\n\n" + genres.join(", "));
  }, { progressText: "Loading anime genres" }),

  makeCommand("genre", C_INFO, "Pick a highly rated anime from a genre.", async (arg, ctx) => {
    const data = await anilistQuery("{ GenreCollection }");
    const genres = (data.GenreCollection || []).filter(genre => !["hentai", "ecchi"].includes(String(genre).toLowerCase()));
    const match = genres.find(genre => genre.toLowerCase() === arg.toLowerCase());
    if (!match) throw new Error("Unknown genre. Use " + ctx.config.prefix + "genres to see the public genre list.");
    const items = await mediaList("ANIME", "SCORE_DESC", 25, Math.floor(Math.random() * 4) + 1, { genre: match });
    const media = items[Math.floor(Math.random() * items.length)];
    return result("🎭 ɢᴇɴʀᴇ ᴘɪᴄᴋ", "🎭 Genre: " + match + "\n\n" + formatMedia(media, 450), cover(media));
  }, { required: true, label: "genre" }),

  ...[
    ["topanime", "ANIME", "SCORE_DESC", "🏆 ᴛᴏᴘ ᴀɴɪᴍᴇ", "Top 10 anime by score", {}],
    ["topmanga", "MANGA", "SCORE_DESC", "🏆 ᴛᴏᴘ ᴍᴀɴɢᴀ", "Top 10 manga by score", {}],
    ["popular", "ANIME", "POPULARITY_DESC", "🔥 ᴍᴏsᴛ ᴘᴏᴘᴜʟᴀʀ", "Most popular anime", {}],
    ["favorite", "ANIME", "FAVOURITES_DESC", "❤️ ғᴀɴ ғᴀᴠᴏʀɪᴛᴇs", "Most favorited anime", {}],
    ["airing", "ANIME", "SCORE_DESC", "📡 ᴛᴏᴘ ᴀɪʀɪɴɢ", "Highly rated anime currently airing", { status: "RELEASING" }],
    ["upcoming", "ANIME", "POPULARITY_DESC", "⏳ ᴜᴘᴄᴏᴍɪɴɢ ᴀɴɪᴍᴇ", "Popular upcoming anime", { status: "NOT_YET_RELEASED" }],
    ["trending", "ANIME", "TRENDING_DESC", "📈 ᴛʀᴇɴᴅɪɴɢ ɴᴏᴡ", "Anime trending on AniList", {}]
  ].map(([name, kind, sort, title, description, extra]) =>
    makeCommand(name, C_RANK, description, async () => {
      const items = await mediaList(kind, sort, 10, 1, extra);
      return result(title, formatTopList(items), cover(items[0]));
    }, { progressText: "Loading anime rankings" })
  ),

  makeCommand("season", C_RANK, "Show popular anime from the current season.", async () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const season = ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor((month - 1) / 3)];
    const items = await mediaList("ANIME", "POPULARITY_DESC", 10, 1, { season, year: now.getFullYear() });
    return result("🌸 " + pretty(season) + " " + now.getFullYear(), formatTopList(items), cover(items[0]));
  }, { progressText: "Loading this season's anime" }),

  makeCommand("topchars", C_RANK, "Show the most favorited characters.", async () => {
    const query = "query { Page(perPage: 10) { characters(sort: FAVOURITES_DESC) { name { full } favourites image { large } } } }";
    const data = await anilistQuery(query);
    const characters = data.Page && data.Page.characters || [];
    if (!characters.length) throw new Error("No popular characters were found.");
    return result("🏆 ᴛᴏᴘ ᴄʜᴀʀᴀᴄᴛᴇʀs", characters.map((character, i) =>
      (i + 1) + ". *" + cleanAnimeText(character.name && character.name.full, 120) + "* ❤️ " +
      (Number(character.favourites) || 0).toLocaleString("en-US")).join("\n"),
      safeHttpsUrl(characters[0].image && characters[0].image.large, "character image"));
  }, { progressText: "Loading popular characters" }),

  makeCommand("schedule", C_RANK, "Show the airing schedule for a weekday.", async arg => {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const now = new Date();
    let offset = 0;
    if (arg) {
      const day = arg.toLowerCase();
      if (!days.includes(day)) throw new Error("Choose a weekday from Monday to Sunday.");
      offset = (days.indexOf(day) - ((now.getDay() + 6) % 7) + 7) % 7;
    }
    const start = new Date(now);
    start.setDate(now.getDate() + offset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const query = "query($a: Int, $b: Int) { Page(perPage: 30) {" +
      " airingSchedules(airingAt_greater: $a, airingAt_lesser: $b, sort: TIME) {" +
      "  airingAt episode media { isAdult title { romaji english } }" +
      " } } }";
    const data = await anilistQuery(query, { a: Math.floor(start.getTime() / 1000), b: Math.floor(end.getTime() / 1000) });
    const items = (data.Page && data.Page.airingSchedules || []).filter(item => item.media && !item.media.isAdult);
    const lines = items.slice(0, 20).map(item =>
      "• " + new Date(item.airingAt * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) +
      "  *" + cleanAnimeText(titleName(item.media.title), 140) + "* (Ep " + item.episode + ")"
    );
    return result("📅 " + start.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "2-digit" }),
      lines.join("\n") || "Nothing is listed on AniList for that day.");
  }, { maxLength: 20, progressText: "Loading airing schedule" }),

  makeCommand("nextep", C_RANK, "Check when an anime's next episode airs.", async arg => {
    const media = await findAnimeMedia(arg, "ANIME", "nextAiringEpisode { episode timeUntilAiring }");
    const next = media.nextAiringEpisode;
    const text = next
      ? "*" + cleanAnimeText(titleName(media.title), 160) + "*\n📺 Episode " + next.episode + " airs in *" + secondsText(next.timeUntilAiring) + "*"
      : "*" + cleanAnimeText(titleName(media.title), 160) + "*\nStatus: " + pretty(media.status) + ". No upcoming episode is listed.";
    return result("⏰ ɴᴇxᴛ ᴇᴘɪsᴏᴅᴇ", text, cover(media));
  }, { required: true, label: "anime title" }),

  makeCommand("randomanime", C_RANDOM, "Show a random popular anime.", async () => {
    const media = (await mediaList("ANIME", "POPULARITY_DESC", 1, Math.floor(Math.random() * 600) + 1))[0];
    return result("🎲 ʀᴀɴᴅᴏᴍ ᴀɴɪᴍᴇ", formatMedia(media, 450), cover(media));
  }, { progressText: "Picking a random anime" }),

  makeCommand("randommanga", C_RANDOM, "Show a random popular manga.", async () => {
    const media = (await mediaList("MANGA", "POPULARITY_DESC", 1, Math.floor(Math.random() * 600) + 1))[0];
    return result("🎲 ʀᴀɴᴅᴏᴍ ᴍᴀɴɢᴀ", formatMedia(media, 450), cover(media));
  }, { progressText: "Picking a random manga" }),

  makeCommand("randomchar", C_RANDOM, "Show a random public character.", async () => {
    const query = "query($p: Int) { Page(page: $p, perPage: 1) { characters(sort: FAVOURITES_DESC) { " + CHAR_FIELDS + " } } }";
    const data = await anilistQuery(query, { p: Math.floor(Math.random() * 800) + 1 });
    const characters = data.Page && data.Page.characters || [];
    if (!characters.length) throw new Error("No character was returned.");
    const character = characters[0];
    return result("🎲 ʀᴀɴᴅᴏᴍ ᴄʜᴀʀᴀᴄᴛᴇʀ", formatCharacter(character, 350),
      safeHttpsUrl(character.image && character.image.large, "character image"));
  }, { progressText: "Picking a random character" }),

  makeCommand("animequote", C_RANDOM, "Get a random anime quote.", async () => {
    const data = await fetchJson("https://api.animechan.io/v1/quotes/random");
    const quote = data && data.data;
    if (!quote || !quote.content) throw new Error("No anime quote was returned.");
    const character = quote.character && quote.character.name || "Unknown";
    const anime = quote.anime && quote.anime.name || "Unknown anime";
    return result("💬 ᴀɴɪᴍᴇ ǫᴜᴏᴛᴇ", "“" + cleanAnimeText(quote.content, 1200) + "”\n\n— *" + cleanAnimeText(character, 120) + "*, _" + cleanAnimeText(anime, 160) + "_");
  }, { progressText: "Fetching an anime quote" }),

  makeCommand("whatanime", C_TOOLS, "Identify anime and episode from a public screenshot URL.", async arg => {
    let screenshot;
    try { screenshot = new URL(validateHttpUrl(arg, "screenshot")); }
    catch { throw new Error("Provide a valid public screenshot URL."); }
    if (screenshot.protocol !== "https:") throw new Error("Use an HTTPS screenshot URL.");
    const endpoint = new URL("https://api.trace.moe/search");
    endpoint.searchParams.set("anilistInfo", "1");
    endpoint.searchParams.set("url", screenshot.href);
    const data = await fetchJson(endpoint.toString(), { timeoutMs: 40000 });
    if (data.error) throw new Error(cleanAnimeText(data.error, 180));
    const match = data.result && data.result[0];
    if (!match) throw new Error("No anime match was found for that screenshot.");
    const media = match.anilist && typeof match.anilist === "object" ? match.anilist : {};
    if (media.isAdult) throw new Error("The match was marked as adult content and was skipped.");
    const title = media.title && (media.title.english || media.title.romaji) || match.filename || "Unknown anime";
    const sceneSeconds = Math.max(0, Math.floor(Number(match.from) || 0));
    const minutes = Math.floor(sceneSeconds / 60);
    const seconds = String(sceneSeconds % 60).padStart(2, "0");
    const similarity = (Number(match.similarity) || 0) * 100;
    const text = "*" + cleanAnimeText(title, 160) + "*\n📺 Episode: " + (match.episode || "N/A") +
      "\n⏱ Scene at " + minutes + ":" + seconds +
      "\n🎯 Match: " + similarity.toFixed(1) + "%" + (similarity < 87 ? "\n⚠️ Low confidence" : "");
    return result("🔎 ᴀɴɪᴍᴇ ɪᴅᴇɴᴛɪғɪᴇᴅ", text, safeHttpsUrl(match.image, "match preview"));
  }, { required: true, label: "HTTPS screenshot URL", maxLength: 1500, progressText: "Checking the screenshot with trace.moe" }),

  ...[
    ["waifu2", "waifu", "💖 ᴡᴀɪғᴜ", "Your waifu 💖"],
    ["husbando", "husbando", "💙 ʜᴜsʙᴀɴᴅᴏ", "Your husbando 💙"],
    ["neko", "neko", "😺 ɴᴇᴋᴏ", "Nyaa~ 🐾"],
    ["kitsune", "kitsune", "🦊 ᴋɪᴛsᴜɴᴇ", "Fox girl 🦊"]
  ].map(([name, endpoint, title, label]) =>
    makeCommand(name, C_IMAGES, "Get a random anime image: " + label + ".", async () => {
      const item = await getNekos(endpoint);
      const lines = [label, "🎨 Artist: " + cleanAnimeText(item.artist_name || "Unknown", 100)];
      const source = safeHttpsUrl(item.source_url, "source page");
      if (source) lines.push("🔗 " + source);
      return result(title, lines.join("\n"), item.url);
    }, { progressText: "Fetching anime art" })
  ),

  ...ANIME_REACTION_NAMES.map(name => {
    // The group moderator already owns .kick, so the anime GIF variant is .kick2.
    const endpoint = name === "kick2" ? "kick" : name;
    return makeCommand(name, C_GIFS, "Send an anime reaction GIF: " + endpoint + ".", async arg => {
      const item = await getNekos(endpoint);
      const lines = ["*" + endpoint.toUpperCase() + "*" + (arg ? " " + cleanAnimeText(arg, 80) : ""),
        "🎞 From: _" + cleanAnimeText(item.anime_name || "Unknown anime", 120) + "_"];
      const source = safeHttpsUrl(item.source_url, "source page");
      if (source) lines.push("🔗 " + source);
      return result("🎞 " + pretty(endpoint), lines.join("\n"), null, item.url);
    }, { maxLength: 80, progressText: "Fetching an anime reaction GIF" });
  })
];

registeredCommands = commands;

export const ANIME_COMMAND_NAMES = Object.freeze(commands.map(command => command.name));
export default commands;
