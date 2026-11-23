// Probe Edge neural TTS: which voices exist for Nigeria, and does synthesis
// actually work keyless from a datacenter IP?
const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");

try {
  const probe = new MsEdgeTTS();
  const voices = await probe.getVoices();
  const ng = voices.filter(v => String(v.Locale || v.locale || "").includes("-NG"));
  console.log("Nigerian voices found:", ng.length);
  for (const v of ng) {
    console.log(" -", v.ShortName, "|", v.DisplayName, "|", v.Gender);
  }
} catch (e) {
  console.log("voice list failed:", e.message);
}

for (const voice of ["en-NG-EzinneNeural", "en-NG-AbeoNeural", "yo-NG-EzinneNeural"]) {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream("Hello Layo, how are you doing today? I hope your day is going well.");
    const chunks = [];
    for await (const c of audioStream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const head = buf.subarray(0, 3).toString("latin1");
    const valid = head === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    console.log(voice, "->", buf.byteLength, "bytes | mp3 valid:", valid);
  } catch (e) {
    console.log(voice, "-> FAILED:", String(e.message).slice(0, 120));
  }
}
process.exit(0);
