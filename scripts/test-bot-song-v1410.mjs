// End-to-end test of the BOT's actual song functions after the v1.4.10 fix.
import { searchYouTubeAudio } from "../damzd/src/downloads.js";
import { downloadSong } from "../damzd/src/saavn.js";

const queries = process.argv.slice(2).length ? process.argv.slice(2) : ["Calm Down Rema", "Last Last Burna Boy"];

for (const query of queries) {
  console.log("\n=== " + query + " ===");
  let song = null;
  try {
    song = await downloadSong(query);
    console.log("JioSaavn candidate:", song.artist, "—", song.title, "| verified:", song.artistVerified);
  } catch {
    console.log("JioSaavn: nothing usable (expected for Afrobeats)");
  }
  const rejected = !song || (song.expectedArtist && !song.artistVerified);
  if (rejected) {
    const audio = await searchYouTubeAudio(query);
    console.log("YouTube rescue: OK —", audio.title);
    const head = await fetch(audio.url, { method: "GET", headers: { Range: "bytes=0-1023" } });
    console.log("mp3 verify:", head.status, "|", head.headers.get("content-type"),
      "| bytes:", head.headers.get("content-range")?.split("/")[1]);
  } else {
    console.log("Full song straight from JioSaavn:", Math.round(song.buffer.length / 1024), "KB");
  }
}
