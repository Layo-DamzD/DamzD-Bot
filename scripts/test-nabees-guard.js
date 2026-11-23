// Verify the poisoned-env guard: NABEES_API_KEY set to the base URL (the
// user's Render mix-up) must NOT break the YouTube rescue route — the bot
// falls back to the shared public key instead.
process.env.NABEES_API_KEY = "https://apis.nabeestech.com/api/v1";

const { searchYouTubeNabees, resolveYouTubeAudioNabees } = await import("/home/z/my-project/damzd/src/downloads.js");

const found = await searchYouTubeNabees("altare bye");
console.log("SEARCH OK:", found.title, "|", found.url);
const audio = await resolveYouTubeAudioNabees(found.url);
console.log("RESOLVE OK:", String(audio.title).slice(0, 60));
console.log("GUARD PASSED — URL-in-key-slot self-heals to the public key.");
