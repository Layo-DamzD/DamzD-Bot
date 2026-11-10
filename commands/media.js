import { generateImage, ttsAudio, transcribeAudio } from "../src/apis.js";
import { fetchBuffer } from "../src/apis.js";

async function quotedVoiceBuffer(ctx) {
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  const quoted = info?.quotedMessage;
  if (!quoted) throw new Error("reply to a voice note with " + ctx.config.prefix + "vn2text");
  const target = quoted.audioMessage || quoted.viewOnceMessageV2?.message?.audioMessage || quoted.documentMessage;
  if (!target) throw new Error("that is not a voice note — reply to an audio message");
  const { downloadContentFromMessage } = await import("baileys");
  const stream = await downloadContentFromMessage(target, "audio");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default [
  {
    name: "flux",
    aliases: ["pollination", "image"],
    category: "AI Media",
    description: "generate an image from a description",
    run: async ctx => {
      const prompt = String(ctx.args || "").trim();
      if (!prompt) throw new Error("describe the image, e.g. " + ctx.config.prefix + "flux a calm beach at sunset");
      await ctx.typing(2500);
      const buffer = await generateImage(prompt);
      await ctx.send({ image: buffer, caption: "*" + prompt.slice(0, 120) + "*" });
    }
  },
  {
    name: "sora",
    category: "AI Media",
    description: "AI video generation info",
    run: async ctx => {
      await ctx.reply(
        "Text-to-video is not something I can do on free services yet — the reliable providers all charge for it.\n" +
        "For images I am fully ready though: try " + ctx.config.prefix + "flux with any description."
      );
    }
  },
  {
    name: "tts",
    aliases: ["tts2", "tts3", "tts4", "tts5"],
    category: "AI Media",
    description: "convert text to a voice note",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (!raw) throw new Error("give me the text to read out");
      let text = raw;
      let language = "en";
      const match = raw.match(/^([a-z]{2})\s*[|,]\s*(.+)$/i);
      if (match) {
        language = match[1].toLowerCase();
        text = match[2].trim();
      }
      await ctx.typing(900);
      const { buffer, truncated } = await ttsAudio(text, language);
      await ctx.send({ audio: buffer, mimetype: "audio/mpeg", ptt: true, fileName: "tts.mp3" });
      if (truncated) {
        await ctx.reply("I read the first 200 characters — that is the limit per voice note.");
      }
    }
  },
  {
    name: "vn2text",
    category: "AI Media",
    description: "transcribe a voice note (reply to it)",
    run: async ctx => {
      await ctx.typing(1500);
      const buffer = await quotedVoiceBuffer(ctx);
      const text = await transcribeAudio(buffer, { filename: "voice.ogg", mimetype: "audio/ogg" });
      await ctx.reply("🗣 Here is what I heard:\n\n_" + text.slice(0, 3000) + "_");
    }
  },
  {
    name: "ssweb",
    category: "AI Media",
    description: "screenshot a website",
    run: async ctx => {
      const url = String(ctx.args || "").trim();
      if (!url) throw new Error("send the website link, e.g. " + ctx.config.prefix + "ssweb https://example.com");
      await ctx.typing(1500);
      const { screenshotOf } = await import("../src/apis.js");
      const buffer = await screenshotOf(url);
      await ctx.send({ image: buffer, caption: "*" + url.slice(0, 120) + "*" });
    }
  }
];
