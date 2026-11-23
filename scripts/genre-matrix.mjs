// THE genre matrix — end-to-end through searchYouTubeAudio (the exact
// .song path) with NO NABEES key set. This answers the owner's question:
// which of afrobeats / western / phonk / jazz / rock deliver FULL audio?
import { searchYouTubeAudio } from "/home/z/my-project/damzd/lib/youtube-play.js";

delete process.env.NABEES_API_KEY;

const MATRIX = [
  ["afrobeats", "Burna Boy Last Last"],
  ["afrobeats", "Asake Lonely At The Top"],
  ["afrobeats", "Wizkid Essence"],
  ["afrobeats", "Feli Nuna Wanted"],
  ["western", "The Weeknd Blinding Lights"],
  ["western", "Dua Lipa Levitating"],
  ["western", "Ed Sheeran Shape of You"],
  ["phonk", "Kordhell Murder In My Mind"],
  ["phonk", "PlayaPhonk Why Not"],
  ["jazz", "Miles Davis So What"],
  ["jazz", "Dave Brubeck Take Five"],
  ["rock", "Queen Bohemian Rhapsody"],
  ["rock", "Led Zeppelin Stairway to Heaven"],
  ["rock", "Nirvana Smells Like Teen Spirit"]
];

for (const [genre, q] of MATRIX) {
  const line = { genre, q };
  const t0 = Date.now();
  try {
    const r = await searchYouTubeAudio(q);
    line.ms = Date.now() - t0;
    line.source = r.source;
    line.full = r.full;
    line.title = (r.title || "").slice(0, 44);
    if (r.audioBuffer?.length) {
      line.bytes = r.audioBuffer.length;
      line.mime = r.mimetype;
      const b = r.audioBuffer.slice(0, 4);
      line.sniff = b[0] === 0xff ? "mp3" : "mp4-atom(" + b.toString("latin1").replace(/[^\x20-\x7e]/g, ".") + ")";
    } else if (r.audioUrl) {
      const head = await fetch(r.audioUrl, { headers: { range: "bytes=0-2047", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
      const buf = await head.arrayBuffer();
      const total = Number((head.headers.get("content-range") || "").split("/")[1] || 0);
      line.bytes = total;
      line.mime = head.headers.get("content-type") || "?";
      const b = Buffer.from(buf.slice(0, 4));
      line.sniff = b[0] === 0xff ? "mp3" : b.slice(0, 3).toString() === "ID3" ? "mp3" : b.toString("latin1").replace(/[^\x20-\x7e]/g, ".").slice(0, 8);
      line.streamOk = (head.status === 200 || head.status === 206) && buf.byteLength > 1000;
    } else {
      line.link = r.youtubeUrl ? "link-only" : "nothing";
    }
  } catch (error) {
    line.error = String(error?.message || error).slice(0, 80);
  }
  console.log(JSON.stringify(line));
}
