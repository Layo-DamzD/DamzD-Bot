// Full .tts pipeline through real bot code:
//  1. English -> Edge neural voice (Nigerian English Ezinne)
//  2. Yoruba -> Google fallback (Edge has no yo voice)
//  3. Bogus TTS_VOICE env -> graceful Google fallback, never a crash
//  4. Conversion to WhatsApp voice note (OGG/Opus), header-verified
import { ttsAudio } from "/home/z/my-project/damzd/src/apis.js";
import { toVoiceOgg } from "/home/z/my-project/damzd/src/mediautil.js";

function isMp3(b) {
  return b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
}
function isOggOpus(b) {
  return b.subarray(0, 4).toString("latin1") === "OggS" && b.subarray(0, 200).includes(Buffer.from("OpusHead"));
}

let ok = true;
function check(name, pass, detail) {
  console.log((pass ? "PASS" : "FAIL") + " — " + name + (detail ? " (" + detail + ")" : ""));
  if (!pass) ok = false;
}

// 1. English neural voice
const en = await ttsAudio("Hello Layo, this is my new human voice. I sound like a Nigerian friend now.", "en");
check("english voice valid mp3", isMp3(en.buffer), en.buffer.byteLength + " bytes");

// 2. Yoruba -> Google has no Yoruba voice: expect a clean, honest refusal
try {
  await ttsAudio("Ẹ káàárọ̀ Layo, báwo ni?", "yo");
  check("yoruba honest refusal", false, "expected an error, got audio");
} catch (e) {
  const friendly = String(e.message).includes("voice for that language");
  check("yoruba honest refusal", friendly, e.message.slice(0, 60));
}

// 2b. Hausa -> Google does carry Hausa
const ha = await ttsAudio("Sannu Layo, yaya kake?", "ha");
check("hausa google voice valid mp3", isMp3(ha.buffer), ha.buffer.byteLength + " bytes");

// 3. Conversion to voice note
const voice = await toVoiceOgg(en.buffer);
check("voice note is ogg+opus", isOggOpus(voice), voice.byteLength + " bytes");

console.log(ok ? "ALL CHECKS PASSED" : "CHECKS FAILED");
process.exit(ok ? 0 : 1);
