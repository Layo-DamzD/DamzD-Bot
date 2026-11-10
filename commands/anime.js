import { fetchBuffer } from "../src/apis.js";
import { gifToMp4 } from "../src/mediautil.js";

// waifu.pics categories (SFW)
const AVAILABLE = new Set([
  "waifu", "neko", "shinobu", "megumin", "bully", "cuddle", "cry", "hug", "awoo",
  "kiss", "lick", "pat", "smug", "bonk", "yeet", "blush", "smile", "wave",
  "highfive", "handhold", "nom", "bite", "glomp", "slap", "kill", "kick",
  "happy", "wink", "poke", "dance", "cringe"
]);

// FEI-style reaction name → closest available category
const REACTIONS = Object.freeze({
  hug: "hug", kabedon: "slap", kick2: "kick", kiss: "kiss", lappillow: "cuddle",
  laugh: "happy", lurk: "cringe", nod: "smile", nom: "nom", nope: "wave",
  nya: "neko", pat: "pat", peck: "kiss", poke: "poke", pout: "blush",
  punch: "slap", run: "dance", salute: "wave", shake: "dance", shoot: "bite",
  shocked: "cry", shrug: "smug", sip: "smug", slap: "slap", sleep: "shinobu",
  smile: "smile", smug: "smug", spin: "dance", stare: "smug", tableflip: "bonk",
  teehee: "blush", think: "smug", thumbsup: "highfive", tickle: "poke",
  wag: "dance", wave: "wave", wink: "wink", yawn: "smile", yeet: "yeet",
  waifu: "waifu"
});

const CAPTIONS = Object.freeze({
  hug: "sending a warm hug", kiss: "a little kiss for you", pat: "*pats*",
  slap: "*slap!*", punch: "ouch — that one connected", bonk: "BONK.",
  yeet: "yeeted.", wave: "waving hello", wink: ";)", poke: "*poke poke*",
  dance: "dance mode on", happy: "pure joy", cry: "someone needs a minute",
  cuddle: "cozy cuddles", nom: "nom nom nom", neko: "nya~", waifu: "a random waifu",
  smile: "a gentle smile", smug: "smug energy", blush: "aww, blushing",
  kick: "a friendly kick", highfive: "high five!", bite: "*chomp*",
  cringe: "yikes", shinobu: "shinobu time", megumin: "explosion imminent",
  awoo: "awoo!", lick: "*lick*", glomp: "flying hug incoming", kill: "dramatic much?",
  handhold: "handhold wholesome hour", bully: "light teasing", awoo2: "awoo"
});

async function sendReactionGif(ctx, category) {
  await ctx.typing(1000);
  const payload = await (await fetch("https://api.waifu.pics/sfw/" + category, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30000)
  })).json();
  const url = String(payload?.url || "");
  if (!url) throw new Error("the reaction shelf was empty — try again in a moment");
  const caption = CAPTIONS[category] || "";
  if (url.endsWith(".gif")) {
    try {
      const buffer = await fetchBuffer(url, { timeoutMs: 60000, label: "reaction service" });
      const mp4 = await gifToMp4(buffer);
      await ctx.send({ video: mp4, gifPlayback: true, mimetype: "video/mp4", caption });
      return;
    } catch {
      await ctx.send({ image: { url }, caption: caption || "here you go" });
      return;
    }
  }
  await ctx.send({ image: { url }, caption });
}

function reactionCommand(name, aliases) {
  const category = REACTIONS[name];
  return {
    name,
    aliases: aliases || [],
    category: "Anime",
    description: "send an anime " + name + " reaction",
    run: async ctx => sendReactionGif(ctx, AVAILABLE.has(category) ? category : "hug")
  };
}

export default Object.entries(REACTIONS).map(([name]) =>
  reactionCommand(name, name === "waifu" ? [] : [])
);
