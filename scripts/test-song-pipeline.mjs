// Song pipeline diagnosis — runs the repo's own song engine stage by stage
// and reports exactly where it succeeds/fails, then tests the NABEES rescue
// with the public free key.
import { downloadSong } from "../damzd/src/saavn.js";
import { searchYouTubeAudio, searchYouTubeNabees, resolveYouTubeAudioNabees } from "../damzd/src/downloads.js";

const queries = process.argv.slice(2).length ? process.argv.slice(2) : ["Calm Down Rema", "Last Last Burna Boy"];

for (const query of queries) {
  console.log("\n=== " + query + " ===");

  // Stage 1+2: JioSaavn (the no-key full-song path)
  try {
    const song = await downloadSong(query);
    console.log("JioSaavn: OK —", song.artist || "", "-", song.title,
      "| artistVerified:", song.artistVerified,
      "| expectedArtist:", song.expectedArtist || "(none)",
      "| buffer:", song.buffer ? Math.round(song.buffer.length / 1024) + " KB" : "MISSING");
  } catch (error) {
    console.log("JioSaavn: FAILED —", String(error?.message || error).slice(0, 120));
  }

  // Stage 3a: keyless YouTube audio route (the one that dies from datacenter IPs)
  try {
    const yt = await searchYouTubeAudio(query);
    console.log("YouTube keyless: OK —", yt.title, "|", String(yt.url).slice(0, 60));
  } catch (error) {
    console.log("YouTube keyless: FAILED —", String(error?.message || error).slice(0, 120));
  }

  // Stage 3b: NABEES rescue with the public free key
  process.env.NABEES_API_KEY = "nabeestech";
  try {
    const found = await searchYouTubeNabees(query);
    console.log("NABEES search: OK —", found.title, "|", found.url);
    try {
      const audio = await resolveYouTubeAudioNabees(found.url);
      console.log("NABEES mp3: OK —", audio.title, "|", String(audio.url).slice(0, 70));
    } catch (error) {
      console.log("NABEES mp3: FAILED —", String(error?.message || error).slice(0, 120));
    }
  } catch (error) {
    console.log("NABEES search: FAILED —", String(error?.message || error).slice(0, 120));
  }
  delete process.env.NABEES_API_KEY;
}
