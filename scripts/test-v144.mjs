// v1.4.4 checks — smarter song engine, .help full list, NABEES AI fallback.
import { loadCommands } from "../src/loader.js";
import { searchSong, artistMatches } from "../src/saavn.js";
import { identifyTrack } from "../src/apis.js";

let passed = 0;
let failed = 0;
function ok(label, condition) {
  if (condition) {
    passed++;
    console.log("  ok  " + label);
  } else {
    failed++;
    console.log("  FAIL " + label);
  }
}

console.log("v1.4.4 — song engine, help, AI fallback");

ok("artistMatches accepts the real artist", artistMatches("Alan Walker", "Alan Walker, Ina Wroldsen") === true);
ok("artistMatches rejects a cover artist", artistMatches("Alan Walker", "Veronica Bravo, Le Bober") === false);
ok("artistMatches handles empty input safely", artistMatches("", "anyone") === false);

const identified = await identifyTrack("Alan Walker Faded");
ok("iTunes identification returns the official track", !!identified && /faded/i.test(identified.track) && /walker/i.test(identified.artist));
ok("iTunes identification includes a preview URL", typeof identified?.preview === "string" && identified.preview.startsWith("https://"));

const verified = await searchSong("Alan Walker Faded");
ok("searchSong returns a song object", !!verified?.title && !!verified?.url320);
ok("searchSong marks verification status", typeof verified?.artistVerified === "boolean");
ok("searchSong carries the expected artist", "expectedArtist" in verified);

const commands = await loadCommands(new URL("../commands", import.meta.url).pathname);
const help = commands.find(c => c.name === "help");
ok(".help is registered with aliases", !!help && help.aliases.includes("commands"));
const sent = [];
const ctx = { args: "", commands, config: { prefix: "." }, reply: async t => sent.push(t) };
await help.run(ctx);
ok(".help lists every visible command", sent[0].includes("Everything I can do"));
ok(".help groups by category", sent[0].includes("Downloads") && sent[0].includes("General"));
ok(".help shows descriptions with prefixes", sent[0].includes(".song —"));

sent.length = 0;
await help.run({ ...ctx, args: "song" });
ok(".help <name> explains one command", sent[0]?.includes(".song") && sent[0]?.includes(".play"));

const menu = commands.find(c => c.name === "menu");
sent.length = 0;
await menu.run(ctx);
ok(".menu still shows the section overview", sent[0]?.toLowerCase().includes("sections"));

const ai = await import("../src/ai.js");
ok("askAI exists and accepts messages", typeof ai.askAI === "function");

const downloads = await import("../src/downloads.js");
ok("NABEES YouTube search resolver exists", typeof downloads.searchYouTubeNabees === "function");
ok("NABEES audio converter resolver exists", typeof downloads.resolveYouTubeAudioNabees === "function");
ok("NABEES resolvers stay keyless-safe without a key", await downloads.searchYouTubeNabees("x").catch(() => "no-key") === "no-key");

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
