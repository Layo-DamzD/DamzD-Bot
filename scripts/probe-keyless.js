// Probe public Piped + Invidious instances for the keyless YouTube route.
// Prints which respond to a search and a streams lookup right now, so only
// healthy instances go into PIPED_APIS.
const QUERY = "altare bye";
const PIPED = [
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.darkness.services",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.drgns.space",
  "https://piped-api.codespace.cz"
];
const INVIDIOUS = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
  "https://invidious.f5.si",
  "https://id.420129.xyz"
];
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" };

async function probe(base, path, shape) {
  try {
    const r = await fetch(base + path, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return `${r.status}`;
    const j = await r.json();
    return shape(j);
  } catch (e) {
    return "ERR " + String(e.message || e).slice(0, 40);
  }
}

const searchPathPiped = "/search?q=" + encodeURIComponent(QUERY) + "&filter=music_songs";
for (const base of PIPED) {
  const out = await probe(base, searchPathPiped, j => {
    const items = (j?.items || []).filter(i => i?.type === "stream");
    return `OK ${items.length} items, first: ${items[0]?.title?.slice(0, 30) || "-"}`;
  });
  console.log("PIPED    ", base.padEnd(38), out);
}
for (const base of INVIDIOUS) {
  const out = await probe(base, "/api/v1/search?q=" + encodeURIComponent(QUERY) + "&type=video", j => {
    const items = (Array.isArray(j) ? j : []).filter(i => i?.type === "video" || i?.videoId);
    return `OK ${items.length} items, first: ${items[0]?.title?.slice(0, 30) || "-"}`;
  });
  console.log("INVIDIOUS", base.padEnd(38), out);
}
