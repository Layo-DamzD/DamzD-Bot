// Free, keyless public APIs used by the command set. Every helper throws
// friendly English errors so commands can show calm messages instead of stack
// traces. Nothing here contains promotional content.

import { fetchJson } from "./utils.js";

export async function fetchBuffer(url, { timeoutMs = 90000, label = "service", headers } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { ...(headers || {}) },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long to respond. Try again in a moment.");
    }
    throw new Error("Could not reach the " + label + ". Please try again later.");
  }
  if (!response.ok) {
    throw new Error("The " + label + " answered with an error (" + response.status + "). Try again shortly.");
  }
  const raw = await response.arrayBuffer();
  if (!raw || raw.byteLength < 100) {
    throw new Error("The " + label + " returned an empty file. Try again in a moment.");
  }
  return Buffer.from(raw);
}

export async function fetchText(url, { timeoutMs = 60000, label = "service", headers } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "*/*", "user-agent": "Mozilla/5.0 (DamzD bot)", ...(headers || {}) },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(label + " took too long to respond. Try again in a moment.");
    }
    throw new Error("Could not reach the " + label + ". Please try again later.");
  }
  if (!response.ok) {
    throw new Error("The " + label + " answered with an error (" + response.status + ").");
  }
  return response.text();
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------- news

const NEWS_SOURCES = Object.freeze({
  aljazeera: "Al Jazeera",
  bbc: "BBC News",
  cnn: "CNN",
  guardian: "The Guardian",
  npr: "NPR",
  nytimes: "New York Times",
  foxnews: "Fox News",
  skynews: "Sky News",
  dw: "Deutsche Welle",
  france24: "France 24",
  washingtonpost: "Washington Post",
  timesofindia: "Times of India",
  punch: "Punch Nigeria",
  abc: "ABC News"
});

export function newsSourceList() {
  return Object.entries(NEWS_SOURCES).map(([key, label]) => key + " — " + label);
}

export async function fetchHeadlines(sourceKey) {
  const label = NEWS_SOURCES[sourceKey];
  if (!label) throw new Error("unknown news source");
  const query = encodeURIComponent("\"" + label + "\" when:2d");
  const url = "https://news.google.com/rss/search?q=" + query + "&hl=en-NG&gl=NG&ceid=NG:en";
  const xml = await fetchText(url, { timeoutMs: 45000, label: label + " news feed" });
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map(entry => {
    const block = entry[1];
    const rawTitle = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const date = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    return {
      title: decodeEntities(rawTitle).replace(/\s+-\s+[^-]+$/, "").trim(),
      link: link.trim(),
      date: date ? new Date(date).toISOString().slice(0, 10) : ""
    };
  }).filter(item => item.title);
  if (!items.length) throw new Error("no fresh headlines came back from " + label);
  return { label, items };
}

// ---------------------------------------------------------------- fun & facts

export async function randomJoke() {
  try {
    const joke = await fetchJson("https://official-joke-api.appspot.com/random_joke", { timeoutMs: 20000, label: "joke service" });
    if (joke?.setup && joke?.punchline) return joke.setup + "\n\n…" + joke.punchline;
  } catch {
    /* fall through to the backup service */
  }
  const joke = await fetchJson("https://v2.jokeapi.dev/joke/Any?safe-mode", {
    timeoutMs: 20000,
    label: "joke service"
  });
  if (joke?.type === "twopart" && joke?.setup && joke?.delivery) return joke.setup + "\n\n…" + joke.delivery;
  if (joke?.joke) return joke.joke;
  throw new Error("the joke service had nothing for me");
}

export async function dadJoke() {
  const joke = await fetchJson("https://icanhazdadjoke.com/", {
    label: "dad joke service",
    headers: { accept: "application/json", "user-agent": "DamzD (https://github.com)" }
  });
  return String(joke?.joke || "").trim();
}

export async function chuckJoke() {
  const joke = await fetchJson("https://api.chucknorris.io/jokes/random", { label: "joke service" });
  return String(joke?.value || "").trim();
}

export async function programmingJoke() {
  const list = await fetchJson("https://official-joke-api.appspot.com/jokes/programming/random", { label: "joke service" });
  const joke = Array.isArray(list) ? list[0] : null;
  if (!joke?.setup) throw new Error("the joke service had nothing for me");
  return joke.setup + "\n\n…" + joke.punchline;
}

export async function uselessFact() {
  const fact = await fetchJson("https://uselessfacts.jsph.pl/api/v2/facts/random", { label: "facts service" });
  return String(fact?.text || "").trim();
}

export async function catFact() {
  const fact = await fetchJson("https://catfact.ninja/fact", { label: "cat facts" });
  return String(fact?.fact || "").trim();
}

export async function advice() {
  const slip = await fetchJson("https://api.adviceslip.com/advice?t=" + Date.now(), { label: "advice service" });
  return String(slip?.slip?.advice || "").trim();
}

export async function zenQuote() {
  const list = await fetchJson("https://zenquotes.io/api/random", { label: "quotes service" });
  const quote = Array.isArray(list) ? list[0] : null;
  if (!quote?.q) throw new Error("the quotes service had nothing for me");
  return "❝ " + quote.q + " ❞\n— " + (quote.a || "Unknown");
}

export async function numberFact() {
  const fact = await fetchText("https://numbersapi.com/random/trivia?json", { label: "number facts" });
  const parsed = JSON.parse(fact);
  return String(parsed?.text || "").trim();
}

export async function historyToday() {
  const now = new Date();
  const url = "https://numbersapi.com/" + (now.getMonth() + 1) + "/" + now.getDate() + "/date";
  return String(await fetchText(url, { label: "history service" })).trim();
}

export async function dogImage() {
  const data = await fetchJson("https://dog.ceo/api/breeds/image/random", { label: "dog service" });
  return String(data?.message || "");
}

export async function catImage() {
  const list = await fetchJson("https://api.thecatapi.com/v1/images/search", { label: "cat service" });
  return String(list?.[0]?.url || "");
}

export async function foxImage() {
  const data = await fetchJson("https://randomfox.ca/floof/", { label: "fox service" });
  return String(data?.image || "");
}

// ---------------------------------------------------------------- knowledge

export async function wikipediaRandom() {
  const page = await fetchJson("https://en.wikipedia.org/api/rest_v1/page/random/summary", {
    label: "Wikipedia",
    headers: { "user-agent": "DamzD-Bot/1.1 (personal WhatsApp assistant)" }
  });
  return {
    title: String(page?.title || "").trim(),
    extract: String(page?.extract || "").trim(),
    url: page?.content_urls?.desktop?.page || ""
  };
}

export async function nasaToday() {
  const data = await fetchJson("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY", { label: "NASA" });
  if (data?.media_type !== "image") throw new Error("today's NASA feature is not an image");
  return {
    title: String(data.title || "").trim(),
    explanation: String(data.explanation || "").trim().slice(0, 900),
    url: String(data.url || "")
  };
}

export async function pokemonInfo(nameOrId) {
  const query = String(nameOrId || "").trim().toLowerCase().replace(/\s+/g, "-");
  const target = /^[a-z0-9-]+$/.test(query) && query ? query : String(Math.floor(Math.random() * 1025) + 1);
  const data = await fetchJson("https://pokeapi.co/api/v2/pokemon/" + target, { label: "Pokédex" });
  return {
    name: String(data?.name || "").replace(/(^|\s|-)\S/g, c => c.toUpperCase()),
    id: data?.id,
    types: (data?.types || []).map(slot => slot?.type?.name).filter(Boolean).join(" / "),
    abilities: (data?.abilities || []).map(entry => entry?.ability?.name).slice(0, 3).filter(Boolean).join(", "),
    height: data?.height != null ? (data.height / 10).toFixed(1) + " m" : "",
    weight: data?.weight != null ? (data.weight / 10).toFixed(1) + " kg" : "",
    sprite: data?.sprites?.front_default || ""
  };
}

export async function bibleVerse(reference) {
  const clean = String(reference || "").trim();
  if (!clean) throw new Error("give me a reference, e.g. John 3:16");
  const data = await fetchJson("https://bible-api.com/" + encodeURIComponent(clean) + "?translation=kjv", {
    label: "Bible service"
  });
  if (!data?.text) throw new Error("I could not find that passage — check the reference");
  return "*" + String(data.reference || clean).trim() + "* (KJV)\n\n" + String(data.text).trim();
}

// ---------------------------------------------------------------- translate

const LANGUAGES = Object.freeze({
  english: "en", french: "fr", spanish: "es", german: "de", portuguese: "pt",
  italian: "it", chinese: "zh-CN", japanese: "ja", korean: "ko", russian: "ru",
  arabic: "ar", hindi: "hi", hausa: "ha", yoruba: "yo", igbo: "ig", swahili: "sw",
  dutch: "nl", turkish: "tr", indonesian: "id", swedish: "sv", polish: "pl"
});

export function resolveLanguageCode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "en";
  if (/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(raw)) return raw;
  return LANGUAGES[raw] || "";
}

export async function translateText(text, targetLanguage) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("give me something to translate");
  const target = resolveLanguageCode(targetLanguage) || "en";
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
    encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(clean.slice(0, 4000));
  const payload = await fetchJson(url, { label: "translation service" });
  const chunks = Array.isArray(payload?.[0]) ? payload[0].map(part => part?.[0] || "") : [];
  const translated = chunks.join("").trim();
  if (!translated) throw new Error("the translation came back empty");
  return translated;
}

// ---------------------------------------------------------------- media & tools

export async function lyricsFor(query) {
  const clean = String(query || "").trim();
  if (!clean) throw new Error("tell me the song title (and artist if you can)");
  const list = await fetchJson("https://lrclib.net/api/search?q=" + encodeURIComponent(clean.slice(0, 200)), {
    timeoutMs: 45000,
    label: "lyrics service"
  });
  const track = (Array.isArray(list) ? list : []).find(item => item?.plainLyrics);
  if (!track) throw new Error("I could not find lyrics for that one");
  const lyrics = String(track.plainLyrics || "").trim();
  return {
    track: String(track.trackName || clean),
    artist: String(track.artistName || "").trim(),
    lyrics: lyrics.length > 2200 ? lyrics.slice(0, 2200) + "\n\n…(trimmed)" : lyrics
  };
}

export async function screenshotOf(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("send a full website link starting with http");
  const shot = "https://s.wordpress.com/mshots/v1/" + encodeURIComponent(url) + "?w=1280&h=800";
  await fetchBuffer(shot, { timeoutMs: 30000, label: "screenshot service" });
  await new Promise(resolve => setTimeout(resolve, 2500));
  return fetchBuffer(shot, { timeoutMs: 45000, label: "screenshot service" });
}

export async function shortenUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("send a full link starting with http");
  const short = await fetchText("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(url), {
    timeoutMs: 30000,
    label: "link shortener"
  });
  if (!short.startsWith("http")) throw new Error("the shortener refused that link");
  return short.trim();
}

export async function tiktokStalk(username) {
  const clean = String(username || "").trim().replace(/^@/, "").replace(/https?:\/\/\S*tiktok\.com\/@?/i, "").replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9._]{2,30}$/.test(clean)) throw new Error("give me a TikTok username, e.g. damzd");
  try {
    const data = await fetchJson("https://api.tiklydown.eu.org/api/stalk?user=" + encodeURIComponent(clean), {
      timeoutMs: 45000,
      label: "TikTok lookup"
    });
    const user = data?.user || data?.data?.user || data || {};
    const stats = data?.stats || data?.data?.stats || user;
    return {
      username: user.uniqueId || user.username || clean,
      nickname: user.nickname || user.name || clean,
      followers: stats.followerCount ?? stats.followers ?? "",
      following: stats.followingCount ?? stats.following ?? "",
      likes: stats.heartCount ?? stats.hearts ?? stats.likes ?? "",
      videos: stats.videoCount ?? stats.videos ?? "",
      avatar: user.avatar || user.avatarLarger || user.photo || ""
    };
  } catch (error) {
    const data = await fetchJson("https://www.tikwm.com/api/user/posts?unique_id=" + encodeURIComponent(clean), {
      timeoutMs: 45000,
      label: "TikTok lookup"
    });
    const user = data?.data?.user || {};
    const stats = data?.data?.stats || {};
    if (!user.uniqueId) throw new Error("I could not find that TikTok account");
    return {
      username: user.uniqueId,
      nickname: user.nickname || clean,
      followers: stats.followerCount ?? "",
      following: stats.followingCount ?? "",
      likes: stats.heartCount ?? "",
      videos: stats.videoCount ?? "",
      avatar: user.avatar || ""
    };
  }
}

export async function spotifyPreview(query) {
  const clean = String(query || "").trim();
  if (!clean) throw new Error("tell me the track name");
  const data = await fetchJson("https://api.deezer.com/search?q=" + encodeURIComponent(clean.slice(0, 200)), {
    timeoutMs: 45000,
    label: "music search"
  });
  const track = (Array.isArray(data?.data) ? data.data : []).find(item => item?.preview);
  if (!track) throw new Error("I could not find that track");
  return {
    title: String(track.title || "").trim(),
    artist: String(track.artist?.name || "").trim(),
    album: String(track.album?.title || "").trim(),
    preview: String(track.preview || ""),
    link: String(track.link || "")
  };
}

export async function generateImage(prompt) {
  const clean = String(prompt || "").trim();
  if (!clean) throw new Error("describe the image you want");
  if (clean.length > 500) throw new Error("keep the description under 500 characters");
  const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(clean) +
    "?width=1024&height=1024&nologo=true&seed=" + Math.floor(Math.random() * 100000);
  const buffer = await fetchBuffer(url, { timeoutMs: 120000, label: "image generator" });
  return buffer;
}

function looksLikeMp3(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  if (buffer.subarray(0, 3).toString("latin1") === "ID3") return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0; // MPEG frame sync
}

// Human-sounding neural speech from Edge's public read-aloud service — the
// same voices the Edge browser uses, keyless. It carries real Nigerian
// English voices (Ezinne, Abeo), so the assistant can sound like home instead
// of a robot. Languages Edge does not carry (Yoruba, Igbo, Hausa...) still go
// to Google further down.
const TTS_VOICE = String(process.env.TTS_VOICE || "en-NG-EzinneNeural");

async function neuralVoice(text, voiceName) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName || TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = [];
  for await (const chunk of audioStream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!looksLikeMp3(buffer)) throw new Error("the neural voice returned no audio");
  return buffer;
}

export async function ttsAudio(text, language = "en", voice = "") {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("give me the text to read out");
  const spoken = clean.slice(0, 200);
  const truncated = clean.length > 200;

  // An explicit voice choice (.tts abeo | ...) always goes to the Edge neural
  // engine first — that is where the voice personality lives. Google still
  // catches the fall if the neural service refuses.
  if (voice) {
    try {
      return { buffer: await neuralVoice(spoken, voice), truncated };
    } catch { /* Edge refused or rate-limited — Google still speaks below */ }
  }

  // Human neural voice first for English — this is the voice people hear.
  if (String(language).startsWith("en")) {
    try {
      return { buffer: await neuralVoice(spoken), truncated };
    } catch { /* Edge refused or rate-limited — Google still speaks below */ }
  }

  // Google's voice is robotic but universal: it covers Yoruba, Igbo, Hausa
  // and friends, and it is the fallback when the neural service refuses.
  // The free endpoint occasionally answers with an error page instead of
  // audio when it is rate limiting. Never let fake audio through — one calm
  // retry, then an honest error the owner can act on.
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
    encodeURIComponent(language) + "&q=" + encodeURIComponent(spoken);
  const opts = {
    timeoutMs: 45000,
    label: "text-to-speech service",
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  };
  let buffer;
  try {
    buffer = await fetchBuffer(url, opts);
    if (!looksLikeMp3(buffer)) {
      buffer = await fetchBuffer(url, opts);
      if (!looksLikeMp3(buffer)) {
        throw new Error("the voice service refused me just now — try again in a minute");
      }
    }
  } catch (error) {
    // The endpoint answers 400 for languages it has no voice for (Yoruba and
    // Igbo are missing there) — say that plainly instead of a raw status code.
    if (String(error?.message || "").includes("(400)")) {
      throw new Error("I do not have a voice for that language yet — my English is the clearest one for now");
    }
    throw error;
  }
  return { buffer, truncated };
}

export async function transcribeAudio(buffer, { filename = "voice.ogg", mimetype = "audio/ogg" } = {}) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("voice transcription needs a free Groq key — set GROQ_API_KEY in .env");
  }
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), filename);
  form.append("model", "whisper-large-v3");
  form.append("response_format", "json");
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: "Bearer " + apiKey },
      body: form,
      signal: AbortSignal.timeout(90000)
    });
  } catch {
    throw new Error("the transcription service could not be reached");
  }
  if (!response.ok) throw new Error("the transcription service refused that audio (" + response.status + ")");
  const payload = await response.json().catch(() => null);
  const text = String(payload?.text || "").trim();
  if (!text) throw new Error("I could not make out any words in that recording");
  return text;
}

// Identify the official recording behind a free-form query via Apple's public
// iTunes search — keyless, dependable from datacenter hosts. The song engine
// uses this to separate the real "Alan Walker - Faded" from the many covers
// that flood other libraries. Returns { artist, track, preview } or null.
export async function identifyTrack(query) {
  const term = String(query || "").trim().slice(0, 120);
  if (!term) return null;
  try {
    const payload = await fetchJson(
      "https://itunes.apple.com/search?term=" + encodeURIComponent(term) +
      "&limit=3&media=music&entity=song",
      { timeoutMs: 15000, label: "music library" }
    );
    const hit = Array.isArray(payload?.results)
      ? payload.results.find(item => item?.trackName && item?.artistName)
      : null;
    if (!hit) return null;
    return {
      artist: String(hit.artistName || "").trim(),
      track: String(hit.trackName || "").trim(),
      preview: /^https:\/\//.test(String(hit.previewUrl || "")) ? String(hit.previewUrl) : ""
    };
  } catch {
    return null;
  }
}

export async function defineWord(word) {
  const clean = String(word || "").trim().toLowerCase();
  if (!/^[a-z-]{2,30}$/.test(clean)) return false;
  try {
    const list = await fetchJson("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(clean), {
      timeoutMs: 15000,
      label: "dictionary"
    });
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}
