import { generateImage, ttsAudio, transcribeAudio } from "../src/apis.js";
import { fetchBuffer } from "../src/apis.js";
import { toVoiceOgg } from "../src/mediautil.js";

// The .tts voice shelf — friendly aliases for the Microsoft Edge neural
// voices (all verified live against Microsoft's voice list). The two
// Nigerian voices come first; ezinne is the default the bot already spoke.
// Any other Edge ShortName works too, e.g. ".tts en-GB-LibbyNeural | hello".
const TTS_VOICES = {
  ezinne: ["en-NG-EzinneNeural", "Nigerian English · female (default)"],
  abeo: ["en-NG-AbeoNeural", "Nigerian English · male"],
  aria: ["en-US-AriaNeural", "American · female"],
  jenny: ["en-US-JennyNeural", "American · warm female"],
  guy: ["en-US-GuyNeural", "American · male"],
  emma: ["en-US-EmmaNeural", "American · calm female"],
  sonia: ["en-GB-SoniaNeural", "British · female"],
  ryan: ["en-GB-RyanNeural", "British · male"]
};

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
    description: "convert text to a voice note (.voices shows the AI voices)",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (!raw) throw new Error("give me the text to read out (say .voices to hear different voices)");
      let text = raw;
      let language = "en";
      let voice = "";
      // ".tts abeo | hello" (alias), ".tts en-GB-RyanNeural | hello" (raw Edge
      // name) or the classic ".tts fr | bonjour" (language for the Google
      // engine). Alias and full neural name win; a bare two-letter code is a
      // language.
      const split = raw.match(/^([a-zA-Z][a-zA-Z-]*)\s*[|,]\s*(.+)$/);
      if (split) {
        const key = split[1].toLowerCase();
        if (TTS_VOICES[key]) {
          voice = TTS_VOICES[key][0];
          text = split[2].trim();
        } else if (/^[a-z]{2}-[a-z]{2}-[a-z]+neural$/i.test(split[1])) {
          voice = split[1];
          text = split[2].trim();
        } else if (key.length === 2) {
          language = key;
          text = split[2].trim();
        }
      }
      await ctx.typing(900);
      const { buffer, truncated } = await ttsAudio(text, language, voice);
      try {
        // A true voice note is OGG/Opus. The service returns MP3 — without
        // conversion the note arrives broken ("wrong with the audio file").
        const voiceNote = await toVoiceOgg(buffer);
        await ctx.send({ audio: voiceNote, mimetype: "audio/ogg; codecs=opus", ptt: true });
      } catch {
        // Host without ffmpeg: a plain audio clip still plays everywhere —
        // a broken voice note never does.
        await ctx.send({ audio: buffer, mimetype: "audio/mpeg", fileName: "tts.mp3", ptt: false });
      }
      if (truncated) {
        await ctx.reply("I read the first 200 characters — that is the limit per voice note.");
      }
    }
  },
  {
    name: "voices",
    category: "AI Media",
    description: "list the AI voices .tts can speak with",
    run: async ctx => {
      const lines = Object.entries(TTS_VOICES).map(([alias, [, label]]) =>
        "• " + ctx.config.prefix + "tts " + alias + " — " + label
      );
      await ctx.reply(
        "My AI voices — use them like " + ctx.config.prefix + "tts abeo | big boys don't pay\n\n" +
        lines.join("\n") +
        "\n\nThe default is ezinne 🇳🇬. Any Edge neural name works too, " +
        "like " + ctx.config.prefix + "tts en-GB-LibbyNeural | hello"
      );
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
