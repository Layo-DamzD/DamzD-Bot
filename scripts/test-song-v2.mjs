// Prove the full .song pipeline with crypto-js (pure JS, works on Render +
// Termux — Node 24's OpenSSL dropped DES-ECB): Apple identifies the track →
// JioSaavn search → DES-ECB decrypt media URL → verify the audio URL streams.
import CryptoJS from "/home/z/my-project/damzd/node_modules/crypto-js/index.js";

const KEY = CryptoJS.enc.Utf8.parse("38346591");
const SAAVN = "https://www.jiosaavn.com/api.php";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const VARIANT = /karaoke|instrumental|cover|tribute|originally performed|made famous|sped up|slowed|nightcore|8d audio|bass boosted|reverb|lofi|lo-fi|remix/i;

function decryptSaavnUrl(encrypted) {
  const raw = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(String(encrypted || "")) },
    KEY, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
  ).toString(CryptoJS.enc.Utf8);
  return raw.replace(/[^\x20-\x7e]/g, "");
}

async function appleIdentify(query) {
  const res = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(query) +
    "&limit=1&media=music&entity=song", { signal: AbortSignal.timeout(15000) });
  const hit = (await res.json())?.results?.[0];
  return hit ? { artist: hit.artistName, track: hit.trackName } : null;
}

async function saavnSearch(q, n = 20) {
  const url = SAAVN + "?__call=search.getResults&q=" + encodeURIComponent(q) +
    "&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=" + n + "&p=1";
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  const data = await res.json();
  return (data?.results || []).map(r => ({
    title: String(r.title || "").replace(/&quot;/g, '"'),
    artist: String(r.more_info?.primary_artists?.map(a => a.name).join(", ") ||
      r.more_info?.singers || r.subtitle || "?").replace(/&quot;/g, '"'),
    encrypted: r.more_info?.encrypted_media_url || r.encrypted_media_url || ""
  }));
}

async function youtubeIdentify(query) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20250312.04.00", hl: "en", gl: "NG" } },
      query
    }),
    signal: AbortSignal.timeout(25000)
  });
  const j = await res.json();
  let hit = null;
  (function walk(node) {
    if (!node || typeof node !== "object" || hit) return;
    if (node.videoRenderer?.videoId) {
      hit = {
        id: node.videoRenderer.videoId,
        title: node.videoRenderer.title?.runs?.[0]?.text || "",
        author: node.videoRenderer.ownerText?.runs?.[0]?.text ||
          node.videoRenderer.longBylineText?.runs?.[0]?.text || ""
      };
    }
    for (const value of Object.values(node)) walk(value);
  })(j);
  return hit;
}

async function prefer320(url) {
  if (/_96\.mp4$/.test(url)) {
    const up = url.replace(/_96\.mp4$/, "_320.mp4");
    try {
      const head = await fetch(up, { method: "GET", headers: { range: "bytes=0-1" }, signal: AbortSignal.timeout(15000) });
      if (head.status === 200 || head.status === 206) return up;
    } catch { /* 320 unavailable — keep 96 */ }
  }
  return url;
}

async function pickSong(query) {
  let identity = await appleIdentify(query).catch(() => null);
  let viaYouTube = false;
  if (!identity) {
    const yt = await youtubeIdentify(query).catch(() => null);
    if (yt) {
      const m = String(yt.title).match(/^\s*(.+?)\s*[-–—]\s*(.+?)\s*(?:\[|\(|$)/);
      if (m) identity = { artist: m[1].trim(), track: m[2].trim() };
      else identity = { artist: String(yt.author).replace(/\s*-\s*Topic$/, ""), track: yt.title };
      viaYouTube = true;
    }
  }
  const strategies = identity
    ? [identity.artist + " " + identity.track, identity.track, query]
    : [query];
  const want = String(identity?.artist || "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
  for (const q of strategies) {
    const rows = await saavnSearch(q).catch(() => []);
    const clean = rows.filter(r => !VARIANT.test(r.title + " " + r.artist));
    const verified = want.length ? clean.find(r => {
      const have = (r.artist + " " + r.title).toLowerCase();
      return want.some(w => have.includes(w));
    }) : clean[0];
    const hit = verified || clean[0];
    if (hit?.encrypted) {
      return {
        query: q,
        title: hit.title,
        artist: hit.artist,
        url: await prefer320(decryptSaavnUrl(hit.encrypted)),
        viaApple: Boolean(identity) && !viaYouTube,
        viaYouTube,
        verified: Boolean(verified)
      };
    }
  }
  return { notFound: true, identity, viaYouTube };
}

for (const q of process.argv.slice(2).length ? process.argv.slice(2) : ["altare bye"]) {
  const song = await pickSong(q);
  if (song.notFound) {
    console.log(q, "→ NOT FOUND on Saavn | identity:", song.identity, "| viaYouTube:", song.viaYouTube);
    continue;
  }
  console.log("query:", q, "→ strategy:", song.query, "| apple:", song.viaApple, "| yt:", song.viaYouTube, "| verified:", song.verified);
  console.log("found:", song.artist, "—", song.title);
  console.log("audio url:", song.url.slice(0, 90));
  const head = await fetch(song.url, { method: "GET", headers: { range: "bytes=0-1024" }, signal: AbortSignal.timeout(20000) });
  console.log("stream check: HTTP", head.status, "| type:", head.headers.get("content-type"),
    "| range bytes:", head.headers.get("content-range") || "-");
}
