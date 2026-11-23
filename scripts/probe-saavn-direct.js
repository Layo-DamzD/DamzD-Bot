// JioSaavn direct — the official site's own internal API. The web player
// hits these endpoints from jiosaavn.com itself; they need no auth.
// song.search for the catalog, song.getDetails for encrypted media URLs.
const results = {};

async function j(url, origin = "https://www.jiosaavn.com") {
  const r = await fetch(url, {
    headers: { accept: "*/*", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", origin, referer: origin + "/" },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// JioSaavn's own base64-ish decoder for the encrypted URLs
function decodeUrl(enc) {
  if (!enc) return "";
  if (!/^http/.test(enc)) {
    try {
      let s = Buffer.from(enc, "base64").toString("utf8");
      s = s.replace("_96.mp4", "_96.mp3"); // the swap the web player does
      return s;
    } catch { return ""; }
  }
  return enc;
}

try {
  const search = await j("https://www.jiosaavn.com/api.php?__call=search.getResults&q=" +
    encodeURIComponent("Blinding Lights The Weeknd") + "&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=3");
  const songs = search?.results || [];
  results.searchStatus = Array.isArray(songs) ? songs.length + " results" : "shape: " + Object.keys(search || {}).join(",");
  if (songs[0]) {
    const s = songs[0];
    results.first = JSON.stringify({
      title: s.title, singer: (s.singers || "").slice(0, 40), duration: s.duration,
      moreInfo: s.more_info?.duration, encrypted: (s.more_info?.encrypted_media_url || "").slice(0, 40) + "…",
      vlink: (s.more_info?.vlink || "").slice(0, 30)
    });
    const enc = s.more_info?.encrypted_media_url;
    if (enc) {
      const details = await j("https://www.jiosaavn.com/api.php?__call=song.getDetails&p=" + encodeURIComponent(enc) + "_format=json&_marker=0&api_version=4&ctx=web6dot0");
      const mediaUrls = Object.entries(details || {})
        .filter(([k, v]) => /^https?:/.test(String(v)) && /mp3|mp4|aac/.test(String(v)))
        .map(([k, v]) => k + "=" + String(v).slice(0, 60));
      results.detailKeys = Object.keys(details || {}).slice(0, 15).join(",");
      results.mediaUrls = mediaUrls.slice(0, 6);
    }
  }
} catch (error) {
  results.error = String(error?.message || error).slice(0, 100);
}

console.log(JSON.stringify(results, null, 2));
