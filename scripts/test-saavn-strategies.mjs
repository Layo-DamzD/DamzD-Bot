// Proves which JioSaavn query strategy surfaces the ORIGINAL artist track.
// Strategy: Apple (iTunes) first identifies {artist, track}, then we try
// several query shapes against JioSaavn and check who finds the real one.
import CryptoJS from "../damzd/node_modules/crypto-js/index.js";

const KEY = CryptoJS.enc.Utf8.parse("38346591");
const SAAVN = "https://www.jiosaavn.com/api.php";

async function saavnSearch(q, n = 20) {
  const url = SAAVN + "?__call=search.getResults&q=" + encodeURIComponent(q) +
    "&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=" + n + "&p=1";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const data = await res.json();
  return (data?.results || []).map(r => ({
    title: String(r.title || "").replace(/&quot;/g, '"'),
    artist: String(r.more_info?.primary_artists?.map(a => a.name).join(", ") ||
      r.more_info?.singers || r.subtitle || "?"),
    encrypted: r.more_info?.encrypted_media_url || r.encrypted_media_url || ""
  }));
}

function decrypt(encoded) {
  const raw = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(String(encoded || "")) },
    KEY, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
  ).toString(CryptoJS.enc.Utf8);
  return raw.replace(/[\x00-\x1f\x7f\s]+/g, "");
}

async function apple(query) {
  const res = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(query) +
    "&limit=1&media=music&entity=song");
  const data = await res.json();
  const hit = data?.results?.[0];
  return hit ? { artist: hit.artistName, track: hit.trackName } : null;
}

const VARIANT = /karaoke|instrumental|cover|tribute|originally performed|made famous|sped up|slowed|nightcore|8d audio|bass boosted|reverb|lofi|lo-fi/i;

const queries = process.argv.slice(2).length ? process.argv.slice(2) : ["Calm Down Rema", "Last Last Burna Boy"];

for (const q of queries) {
  console.log("\n=== " + q + " ===");
  const id = await apple(q).catch(() => null);
  console.log("Apple identifies:", id ? id.artist + " — " + id.track : "nothing");

  const strategies = id
    ? [[ "full user text", q ], [ "title only", id.track ], [ "artist + title", id.artist + " " + id.track ], [ "track artist reversed", id.track + " " + id.artist ]]
    : [[ "full user text", q ]];

  for (const [label, query] of strategies) {
    const rows = await saavnSearch(query).catch(() => []);
    const clean = rows.filter(r => !VARIANT.test(r.title + " " + r.artist));
    const want = String(id?.artist || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
    const verified = clean.find(r => {
      const have = (r.artist + " " + r.title).toLowerCase();
      return want.some(w => have.includes(w));
    });
    const sample = clean[0] || rows[0] || { title: "nothing", artist: "" };
    console.log("  [" + label + "] " + query + " → " + rows.length + " results, " + clean.length + " clean" +
      (verified ? " | VERIFIED: " + verified.artist + " — " + verified.title +
        " | url: " + decrypt(verified.encrypted).slice(0, 55)
        : " | best unverified: " + sample.artist + " — " + sample.title));
  }
}
