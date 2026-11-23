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

function createTtsCommand({ name, title, endpoint, params, audioPaths, optionDefaults = [] }) {
  return {
    name,
    category: "AI Media",
    description: "Convert text to audio using " + title + ".",
    run: async ctx => {
      const parts = String(ctx.args || "").split("|");
      const text = String(parts[0] || "").trim();
      if (!text) {
        throw new Error("Usage: " + ctx.config.prefix + name + " your text to speak" +
          (optionDefaults.length ? " | " + optionDefaults.join(" | ") : ""));
      }
      if (text.length > 1800) throw new Error("Please keep the text under 1800 characters.");
      const options = optionDefaults.map((fallback, index) => String(parts[index + 1] || fallback).trim());
      const payload = await requestExternalJson(API + endpoint, params(text, options));
      const audioUrl = safeHttpsUrl(valueAt(payload, audioPaths), AUDIO_HOSTS, "speech");
      await ctx.reply({ audio: { url: audioUrl }, mimetype: "audio/mpeg", ptt: false });
      await ctx.reply(withPoweredFooter(
        unicodeBox("🔊 " + title, "Text: " + text.slice(0, 1800), { footer: false }),
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
  createTtsCommand({
    name: "tts",
    title: "TEXT TO SPEECH",
    endpoint: "/ai/clideo",
    params: (text, options) => ({ action: "generate", text, mood: options[0] || "NORMAL" }),
    audioPaths: ["data.previewUrl", "previewUrl"],
    optionDefaults: ["NORMAL"]
  }),
  createTtsCommand({
    name: "tts2",
    title: "GEMINI TEXT TO SPEECH",
    endpoint: "/ai/Gemini-tts",
    params: text => ({ text }),
    audioPaths: ["result", "data.result", "audio"]
  }),
  createTtsCommand({
    name: "tts3",
    title: "TEXT2SPEECH V3",
    endpoint: "/ai/text2speech-v3",
    params: (text, options) => ({ text, voice: options[0] || "woman1", language: options[1] || "English" }),
    audioPaths: ["audio", "data.audio", "result"],
    optionDefaults: ["woman1", "English"]
  }),
  createTtsCommand({
    name: "tts4",
    title: "TEXT TO SPEECH V2",
    endpoint: "/ai/text-to-speech2",
    params: (text, options) => ({ text, voice: options[0] || "NORMAL MALE" }),
    audioPaths: ["result", "data.result", "audio"],
    optionDefaults: ["NORMAL MALE"]
  }),
  createTtsCommand({
    name: "tts5",
    title: "MULTI TEXT TO SPEECH",
    endpoint: "/ai/Multi-Text-to-speech",
    params: text => ({ action: "tts", text }),
    audioPaths: ["data.audio_url", "audio_url", "result"]
  })
];
