// ffmpeg-backed media conversions. Resolves a binary in order: system ffmpeg,
// then the bundled slim build from @ffmpeg-installer/ffmpeg (ships on linux
// x64 hosts like Render; skipped on the phone). Every helper degrades
// gracefully with a clear error when conversion is not possible on the host.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

async function withTempDir(work) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "damzd-"));
  try {
    return await work(dir);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

let ffmpegChecked = false;
let ffmpegPath = null;

// Binary resolution order:
//   1. system ffmpeg (Termux via `pkg install ffmpeg`, some hosts preinstall it)
//   2. the bundled slim binary from @ffmpeg-installer/ffmpeg — an optional
//      dependency that only ships where a prebuilt exists (linux x64 = Render).
//      Android arm64 has no prebuilt, so npm skips it on the phone: no bloat.
//   3. null — helpers then degrade gracefully and commands fall back to
//      plain-audio sends that WhatsApp can always play.
async function resolveFfmpeg() {
  if (ffmpegChecked) return ffmpegPath;
  ffmpegChecked = true;
  try {
    await run("ffmpeg", ["-version"], { timeout: 10000 });
    ffmpegPath = "ffmpeg";
    return ffmpegPath;
  } catch { /* not on PATH — try the bundled one */ }
  try {
    const bundled = require("@ffmpeg-installer/ffmpeg");
    await run(bundled.path, ["-version"], { timeout: 10000 });
    ffmpegPath = bundled.path;
  } catch { ffmpegPath = null; }
  return ffmpegPath;
}

export async function ffmpegAvailable() {
  return (await resolveFfmpeg()) !== null;
}

async function convert(inputBuffer, inputName, outputName, args) {
  const bin = await resolveFfmpeg();
  if (!bin) {
    throw new Error("my host does not have ffmpeg installed — media conversion is unavailable");
  }
  return withTempDir(async dir => {
    const input = path.join(dir, inputName);
    const output = path.join(dir, outputName);
    await fs.writeFile(input, inputBuffer);
    await run(bin, ["-y", "-i", input, ...args, output], { timeout: 120000 });
    const result = await fs.readFile(output);
    if (result.byteLength < 500) throw new Error("the converted file came out empty");
    return result;
  });
}

export function gifToMp4(buffer) {
  return convert(buffer, "in.gif", "out.mp4", [
    "-movflags", "faststart",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2:force_original_aspect_ratio=decrease,pad=trunc(iw/2)*2:trunc(ih/2)*2"
  ]);
}

export function toStickerWebp(buffer, { isVideo = false, durationSeconds = 6 } = {}) {
  const fit = "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=white";
  const args = isVideo
    ? ["-t", String(durationSeconds), "-vf", fit + ",fps=12", "-c:v", "libwebp", "-q:v", "60", "-an", "-loop", "0"]
    : ["-vf", fit, "-c:v", "libwebp", "-q:v", "80", "-an", "-loop", "0"];
  return convert(buffer, isVideo ? "in.mp4" : "in.img", "out.webp", args);
}

export function videoToMp3(buffer) {
  return convert(buffer, "in.mp4", "out.mp3", ["-vn", "-b:a", "128k"]);
}

// WhatsApp voice notes must be OGG/Opus. An MP3 sent as ptt arrives as a
// "voice note" bubble that most phones refuse to play ("something is wrong
// with the audio file"). Opus 64k mono is close to what WhatsApp itself
// records at, so the note plays and streams like any native voice message.
export function toVoiceOgg(buffer) {
  return convert(buffer, "in.mp3", "out.ogg", [
    "-vn",
    "-c:a", "libopus",
    "-b:a", "64k",
    "-vbr", "on",
    "-application", "voip"
  ]);
}
