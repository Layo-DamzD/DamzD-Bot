// SoundCloud deep probe — round 2. The web bundles hide the client_id
// differently now; try every bundle, plus the known api-mobile id, plus
// oEmbed resolve (which redirects to the canonical track URL for a
// soundcloud:// URI), then the api-v2 search + progressive stream.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const results = {};

async function findClientId() {
  const html = await fetch("https://soundcloud.com", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) }).then(r => r.text());
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  results.bundles = scripts.length;
  // every pattern npm's soundcloud-key-fetchers use, across ALL bundles
  const patterns = [
    /client_id\s*[:=]\s*"([a-zA-Z0-9]{28,40})"/,
    /client_id=([a-zA-Z0-9]{28,40})/,
    /"clientId"\s*:\s*"([a-zA-Z0-9]{28,40})"/
  ];
  for (const script of scripts) {
    const js = await fetch(script, { signal: AbortSignal.timeout(15000) }).then(r => r.text()).catch(() => "");
    for (const p of patterns) {
      const m = js.match(p);
      if (m) return m[1];
    }
  }
  return null;
}

const clientId = await findClientId();
results.clientId = clientId || "not-found";

if (clientId) {
  try {
    const search = await fetch(
      "https://api-v2.soundcloud.com/search/tracks?q=" + encodeURIComponent("Asake Lonely At The Top") +
      "&client_id=" + clientId + "&limit=5&offset=0",
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    const data = await search.json().catch(() => null);
    const items = data?.collection || [];
    results.asakeSearch = search.status + " → " + (items.map(t => (t.title + " [" + (t.user?.username || "?") + "] " + Math.round((t.duration || 0) / 1000) + "s").slice(0, 60)).join(" | ") || "empty");
    const track = items[0];
    if (track?.media?.transcodings) {
      results.transcodings = track.media.transcodings.map(t => t.format?.protocol + " " + t.format?.mime_codec?.split(";")[0]).join(", ");
      const progressive = track.media.transcodings.find(t => t.format?.protocol === "progressive");
      if (progressive) {
        const streamMeta = await fetch(progressive.url + "?client_id=" + clientId, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) }).then(r => r.json()).catch(() => null);
        if (streamMeta?.url) {
          const audio = await fetch(streamMeta.url, { headers: { "user-agent": UA, range: "bytes=0-131071" }, signal: AbortSignal.timeout(20000) });
          const buf = await audio.arrayBuffer();
          results.stream = "HTTP " + audio.status + " " + buf.byteLength + "B " + (audio.headers.get("content-type") || "?");
          results.streamOk = (audio.status === 200 || audio.status === 206) && buf.byteLength > 10000;
          results.fullLength = audio.headers.get("content-range") || audio.headers.get("content-length") || "?";
        }
      }
    }
  } catch (error) {
    results.apiError = String(error?.message || error).slice(0, 120);
  }
}

// oEmbed route — works without client_id for a known track URL
try {
  const known = "https://soundcloud.com/burnaboyofficial/last-last";
  const oe = await fetch("https://soundcloud.com/oembed?format=json&url=" + encodeURIComponent(known), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
  results.oembed = oe.status + " " + (oe.ok ? "json" : "");
} catch (error) {
  results.oembedError = String(error?.message || error).slice(0, 80);
}

console.log(JSON.stringify(results, null, 2));
