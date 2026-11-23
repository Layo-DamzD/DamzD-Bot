// AI & info extras: AI-text estimation, AI video info, TTS voice list,
// voice-note transcription (optional API key), bot info cards and the
// owner's runtime prefix control.
import { unicodeBox, withPoweredFooter } from "../lib/api-client.js";
import { getContextInfo, numberFromJid } from "../lib/message-utils.js";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import {
  getActivePrefix,
  resetActivePrefix,
  setActivePrefix
} from "../src/damzd/prefix-store.js";

const AI_PHRASES = [
  "in conclusion", "it is important to note", "furthermore", "moreover", "delve into",
  "in today's world", "landscape", "testament to", "navigate the", "unlock the",
  "as an ai", "certainly", "i'd be happy to", "here is a", "let's explore",
  "it's worth noting", "overall", "additionally", "ultimately", "robust", "seamless"
];

function sentences(text) {
  return text.split(/[.!?]+(?:\s|$)/).map(part => part.trim()).filter(Boolean);
}

// A transparent heuristic estimate: bursts of uniform sentences, AI stock
// phrases, low contraction use and a tidy structure push the score up.
function aiLikeness(text) {
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  const list = sentences(text);
  const lengths = list.map(sentence => sentence.split(/\s+/).length);
  const average = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  const variance = lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / (lengths.length || 1);
  const burstiness = Math.sqrt(variance) / (average || 1);

  const lower = text.toLowerCase();
  const phraseHits = AI_PHRASES.filter(phrase => lower.includes(phrase)).length;
  const contractions = (lower.match(/\w['’]\w/g) || []).length / (words.length || 1);
  const commas = (text.match(/,/g) || []).length / (list.length || 1);
  const humanBits = (text.match(/[\u0021-\u0040]{2,}|lol|lmao|omg|fr|ngl|tbh|\bty\b|\bplz\b/gi) || []).length;

  let score = 42;
  if (list.length >= 3) score += Math.max(0, 18 - burstiness * 36); // too-uniform rhythm
  score += Math.min(22, phraseHits * 9);
  if (contractions < 0.004 && words.length > 60) score += 8;
  if (commas > 1.6 && average > 18) score += 6;
  if (humanBits > 0) score -= Math.min(26, humanBits * 9);
  if (words.length < 35) score -= 10; // tiny samples are unreliable
  return Math.max(2, Math.min(97, Math.round(score)));
}

async function transcribeAudio(buffer, mimetype) {
  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const endpoint = groqKey
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : openaiKey
      ? "https://api.openai.com/v1/audio/transcriptions"
      : "";
  const key = groqKey || openaiKey;
  if (!endpoint) {
    throw new Error("Voice-note transcription needs a free Whisper API key.\n" +
      "1. Create one at https://console.groq.com (free tier) — or use an OpenAI key.\n" +
      "2. Add it as the GROQ_API_KEY (or OPENAI_API_KEY) environment variable.\n" +
      "3. Restart DamzD, then reply to the voice note with .vn2text again.");
  }
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype || "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-large-v3");
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: form,
      signal: AbortSignal.timeout(60000)
    });
  } catch (error) {
    throw new Error("The transcription service could not be reached (" +
      String(error?.message || error).slice(0, 120) + ").");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.text) {
    throw new Error("Transcription failed (HTTP " + response.status + "): " +
      String(payload?.error?.message || payload?.error || "unknown").slice(0, 180));
  }
  return String(payload.text).trim();
}

const commands = [
  {
    name: "aidetect",
    category: "AI & Chat",
    description: "Estimate if a text looks AI-generated.",
    run: async ctx => {
      let text = String(ctx.args || "").trim();
      const info = getContextInfo(ctx.msg?.message);
      if (!text && info?.quotedMessage) {
        text = (info.quotedMessage.conversation ||
          info.quotedMessage.extendedTextMessage?.text || "").trim();
      }
      if (!text) throw new Error("Paste the text to analyse, or reply to it with " + ctx.config.prefix + "aidetect.");
      if (text.length > 4000) text = text.slice(0, 4000);
      const score = aiLikeness(text);
      const verdict = score >= 75 ? "Very likely AI-generated 🤖"
        : score >= 55 ? "Lean AI-generated — polished and uniform"
        : score >= 35 ? "Mixed signals; can't call it 🤷"
        : "Likely human-written ✍️";
      await ctx.reply(withPoweredFooter(unicodeBox("🧪 AI-LIKENESS ESTIMATE", [
        "Score: " + score + "/100",
        "Verdict: " + verdict,
        "",
        "Signals: phrase patterns, sentence rhythm, punctuation balance and human markers.",
        "This is an estimate, not proof — keep that in mind before accusing anyone."
      ].join("\n"), { footer: false }), 1800));
    }
  },
  {
    name: "sora",
    category: "AI Media",
    description: "AI video generation info.",
    run: async ctx => {
      await ctx.reply(withPoweredFooter(unicodeBox("🎬 AI VIDEO GENERATION", [
        "What it is: text-to-video models (OpenAI's Sora family and rivals) turn a",
        "written scene description into a short generated clip.",
        "",
        "In DamzD right now:",
        "• .flux and .pollination generate AI images from text",
        "• Text-to-speech voices live under .tts and .voices",
        "• AI video generation is not wired into this build yet — when a",
        "  stable provider is available it will land here.",
        "",
        "Tip: craft a video prompt now — subject, action, lighting, camera move —",
        "and paste it straight in when the feature ships."
      ].join("\n"), { footer: false }), 2200));
    }
  },
  {
    name: "voices",
    category: "AI Media",
    description: "List the AI voices .tts can speak with.",
    run: async ctx => {
      await ctx.reply(withPoweredFooter(unicodeBox("🎙️ TTS VOICES", [
        ".tts3 <text> | <voice> | <language>",
        "  Voices: woman1 woman2 man1 man2 girl1 girl2 boy1 boy2",
        "  Languages: English, French, Italian, Spanish, German, …",
        "",
        ".tts2 <text> — preset voice (option: NORMAL, FAST)",
        ".tts4 <text> — deep voice (option: NORMAL MALE)",
        ".tts5 <text> — multi-voice presets",
        ".tts <text> — the default voice",
        "",
        "Example: .tts3 good morning | woman2 | English"
      ].join("\n"), { footer: false }), 2000));
    }
  },
  {
    name: "vn2text",
    category: "AI Media",
    description: "Transcribe a voice note (reply to it).",
    run: async ctx => {
      const info = getContextInfo(ctx.msg?.message);
      if (!info?.stanzaId || !info?.quotedMessage) {
        throw new Error("Reply to the voice note with " + ctx.config.prefix + "vn2text.");
      }
      const body = info.quotedMessage.audioMessage || info.quotedMessage.pttMessage;
      if (!body) throw new Error("The replied-to message is not a voice note.");
      const buffer = await downloadMediaMessage(
        { key: { remoteJid: ctx.jid, id: String(info.stanzaId) }, message: info.quotedMessage },
        "buffer",
        {},
        { reuploadRequest: ctx.sock.updateMediaMessage }
      );
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("WhatsApp returned no audio data.");
      await ctx.reply("🎧 Transcribing the voice note ...");
      const text = await transcribeAudio(buffer, body.mimetype);
      await ctx.reply(withPoweredFooter("📝 *TRANSCRIPTION*\n\n" + (text || "(silence)"), 3800));
    }
  },
  {
    name: "about",
    category: "General",
    description: "Who I am.",
    run: async ctx => {
      const count = (ctx.commands || []).filter(command => !command.hidden).length;
      await ctx.reply(withPoweredFooter(unicodeBox("🤖 ABOUT " + String(ctx.config.name || "DamzD").toUpperCase(), [
        String(ctx.config.name || "DamzD") + " — your WhatsApp assistant.",
        "",
        "Version: " + String(ctx.config.version || "2.0"),
        "Owner: " + String(ctx.config.ownerName || "DamzD") + " (+" +
          String(ctx.config.ownerNumber || "").replace(/\D/g, "") + ")",
        "Mode: " + String(ctx.config.defaultMode || "public").toUpperCase(),
        "Prefix: " + String(ctx.config.prefix || "."),
        "Commands loaded: " + count,
        "",
        "I answer normal language too — ask, and I do my best."
      ].join("\n"), { footer: false }), 2200));
    }
  },
  {
    name: "channel",
    category: "General",
    description: "Info about this assistant.",
    run: async ctx => {
      await ctx.reply(withPoweredFooter(unicodeBox("📢 THIS ASSISTANT", [
        "Name: " + String(ctx.config.name || "DamzD"),
        "Engine: Baileys WhatsApp Web, self-hosted",
        "Version: " + String(ctx.config.version || "2.0"),
        "Dashboard: " + (String(ctx.config.botUrl || "").trim() || "the pairing URL your host provides"),
        "",
        "Start with " + String(ctx.config.prefix || ".") + "menu to see every command."
      ].join("\n"), { footer: false }), 1600));
    }
  },
  {
    name: "channeljid",
    category: "General",
    description: "Get the JID of this chat or a channel link.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (raw) {
        const match = raw.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
        if (match) {
          try {
            const meta = await ctx.sock.newsletterMetadata("invite", match[1]);
            await ctx.reply("📢 Channel JID: " + meta?.id +
              (meta?.name ? "\n📣 Name: " + String(meta.name).slice(0, 60) : ""));
            return;
          } catch {
            throw new Error("WhatsApp did not recognise that channel link.");
          }
        }
      }
      await ctx.reply("🆔 This chat's JID: *" + ctx.jid + "*" +
        (ctx.jid.endsWith("@g.us") ? "\n👥 Type: group" : "\n💬 Type: private chat"));
    }
  },
  {
    name: "vcf",
    category: "General",
    description: "Save my owner's contact card.",
    run: async ctx => {
      const owner = String(ctx.config.ownerNumber || "").replace(/\D/g, "");
      if (!owner) throw new Error("No owner number is configured.");
      const name = String(ctx.config.ownerName || "DamzD").replace(/[;\n]/g, " ").slice(0, 60);
      const vcard = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:" + name,
        "TEL;type=CELL;type=VOICE;waid=" + owner + ":+" + owner,
        "END:VCARD"
      ].join("\n");
      await ctx.send({ contacts: { displayName: name, contacts: [{ displayName: name, vcard }] } });
    }
  },
  {
    name: "prefix",
    category: "Owner",
    description: "Change my command mark — .prefix ! makes !menu work.",
    run: async ctx => {
      if (!ctx.owner) {
        await ctx.reply("⛔ Only the configured bot owner can change the command mark.");
        return;
      }
      const raw = String(ctx.args || "").trim();
      const current = await getActivePrefix(ctx.config);
      if (!raw) {
        await ctx.reply("🏷️ Current command mark: *" + current + "*\n" +
          "Change it: " + current + "prefix !\n" +
          "Reset to the default: " + current + "prefix reset");
        return;
      }
      if (raw.toLowerCase() === "reset") {
        const fallback = await resetActivePrefix(ctx.config);
        await ctx.reply("✅ Command mark reset to *" + fallback + "*.");
        return;
      }
      const next = await setActivePrefix(raw);
      await ctx.reply("✅ Command mark changed to *" + next + "*\n" +
        "From now on: " + next + "menu, " + next + "ping, " + next + "help …");
    }
  }
];

export default commands;
