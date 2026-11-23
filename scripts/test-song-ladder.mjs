// LIVE end-to-end: run searchYouTubeAudio (the exact .song entry) on real
// queries and print which rung answered + a byte-range fetch of the audio.
import { searchYouTubeAudio } from "/home/z/my-project/damzd/lib/youtube-play.js";

const queries = process.argv.slice(2).length ? process.argv.slice(2) : [
  "Burna Boy Last Last",
  "Asake Lonely At The Top",
  "Rema Calm Down"
];

for (const q of queries) {
  const line = { query: q };
  try {
    const r = await searchYouTubeAudio(q);
    line.source = r.source;
    line.full = r.full;
    line.title = r.title;
    line.youtube = r.youtubeUrl || "(none)";
    if (r.audioUrl) {
      const head = await fetch(r.audioUrl, {
        headers: { "user-agent": "Mozilla/5.0", range: "bytes=0-262143" },
        signal: AbortSignal.timeout(30000)
      });
      const buf = await head.arrayBuffer();
      line.stream = head.status + " " + buf.byteLength + "B " + (head.headers.get("content-type") || "?");
      const total = head.headers.get("content-range") || "";
      line.totalBytes = total.split("/")[1] || String(head.headers.get("content-length") || "?");
      const b = Buffer.from(buf.slice(0, 4));
      line.sniff = b[0] === 0xff ? "mp3-frame" : b.slice(0, 3).toString() === "ID3" ? "mp3-id3" : b.toString("hex");
    }
  } catch (error) {
    line.error = String(error?.message || error).slice(0, 120);
  }
  console.log(JSON.stringify(line));
}
