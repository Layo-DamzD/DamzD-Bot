import {
  extractImageUrls,
  requestExternalJson,
  unicodeBox,
  withPoweredFooter
} from "../lib/api-client.js";

const API = "https://api.omegatech.app/api";
const AUDIO_HOSTS = [
  "clideo.com",
  "catbox.moe",
  "replicate.delivery",
  "malvryx.dev",
  "googleapis.com"
];

function input(ctx, example, limit = 1800) {
  const value = String(ctx.args || "").trim();
  if (!value) throw new Error("Usage: " + ctx.config.prefix + ctx.commandName + " " + example);
  if (value.length > limit) throw new Error("Keep the input under " + limit + " characters.");
  return value;
}

function valueAt(payload, paths) {
  for (const path of paths) {
    let value = payload;
    for (const key of path.split(".")) value = value && value[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function safeHttpsUrl(value, hosts, label) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("The " + label + " service returned an invalid URL.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password ||
      !hosts.some(suffix => host === suffix || host.endsWith("." + suffix))) {
    throw new Error("The " + label + " service returned an unsupported URL.");
  }
  return url.toString();
}

function imageFromPayload(payload) {
  return [
    payload?.data?.imageUrl,
    payload?.imageUrl,
    payload?.data?.url,
    payload?.url,
    payload?.result?.imageUrl,
    payload?.result?.url,
    typeof payload?.result === "string" ? payload.result : ""
  ].find(value => typeof value === "string" && value.trim()) || extractImageUrls(payload)[0] || "";
}

async function sendImage(ctx, title, prompt, imageUrl) {
  await ctx.reply({
    image: { url: imageUrl },
    caption: withPoweredFooter(
      unicodeBox(title, "📝 Prompt: " + prompt.slice(0, 650), { footer: false }),
      900
    )
  });
}

function createImageCommand({ name, title, endpoint, params }) {
  return {
    name,
    category: "AI Media",
    description: "Generate an image from a text prompt.",
    run: async ctx => {
      const prompt = input(ctx, "describe the image you want");
      const payload = await requestExternalJson(API + endpoint, params(prompt));
      const imageUrl = safeHttpsUrl(imageFromPayload(payload), ["pollinations.ai"], "image-generation");
      await sendImage(ctx, title, prompt, imageUrl);
    }
  };
}


// The one TTS engine that matters: /ai/text2speech-v3 (verified live — real
// mp3 audio, four voices). .ttsm = male, .ttsf = female; a second voice
// variant is available via the | option.
function createVoiceTtsCommand({ name, aliases, title, defaultVoice, altVoice }) {
  return {
    name,
    aliases,
    category: "AI Media",
    description: "Turn text into a spoken voice note (" + title.toLowerCase() + ").",
    run: async ctx => {
      const parts = String(ctx.args || "").split("|");
      const text = String(parts[0] || "").trim();
      if (!text) {
        throw new Error("Usage: " + ctx.config.prefix + name + " your text to speak | " + altVoice + " (optional second voice)");
      }
      if (text.length > 1800) throw new Error("Please keep the text under 1800 characters.");
      const voice = String(parts[1] || "").trim().toLowerCase() || defaultVoice;
      const allowed = [defaultVoice, altVoice];
      if (!allowed.includes(voice)) {
        throw new Error("Voice \"" + voice + "\" is not available. Use " + defaultVoice + " or " + altVoice + ".");
      }
      const payload = await requestExternalJson(API + "/ai/text2speech-v3", {
        text, voice, language: "English"
      });
      const audioUrl = safeHttpsUrl(valueAt(payload, ["audio", "data.audio", "result"]), AUDIO_HOSTS, "speech");
      await ctx.reply({ audio: { url: audioUrl }, mimetype: "audio/mpeg", ptt: false });
      await ctx.reply(withPoweredFooter(
        unicodeBox("🔊 DAMZD VOICE · " + title, "Voice: " + voice + "\nText: " + text.slice(0, 1500), { footer: false }),
        2800
      ));
    }
  };
}

export default [
  createImageCommand({
    name: "flux",
    title: "🎨 FLUX IMAGE GENERATION",
    endpoint: "/ai/pollination2",
    params: prompt => ({ action: "generate", prompt, model: "flux", format: "jpg", safe: "true" })
  }),
  createImageCommand({
    name: "pollination",
    title: "🎨 POLLINATION AI",
    endpoint: "/ai/polination",
    params: prompt => ({ action: "generate", prompt, shape: "square" })
  }),
  createVoiceTtsCommand({ name: "ttsm", title: "MALE VOICE", defaultVoice: "man1", altVoice: "man2" }),
  createVoiceTtsCommand({ name: "ttsf", title: "FEMALE VOICE", defaultVoice: "woman1", altVoice: "woman2" })
];
