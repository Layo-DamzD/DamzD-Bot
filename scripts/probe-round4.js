// Round 4 — the last full-track options:
//  a) youtubei WEB client player (the same client that powers our working
//     innertube SEARCH — maybe its player still hands out direct URLs)
//  b) piped instances (proxy YouTube streams, keyless)
//  c) iOS innertube client (different pool, sometimes still open)
const results = {};

// a) WEB client player
try {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", origin: "https://www.youtube.com" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20250312.04.00", hl: "en", gl: "NG" } },
      videoId: "421w1j87fEM"
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await r.json().catch(() => null);
  const status = data?.playabilityStatus?.status;
  const formats = [...(data?.streamingData?.formats || []), ...(data?.streamingData?.adaptiveFormats || [])];
  const audio = formats.filter(f => (f.type || "").startsWith("audio/"));
  results.webPlayer = status + " | " + audio.length + " audio fmt | " +
    (audio.some(f => f.url) ? "DIRECT URL YES" : "cipher only");
  if (audio[0]?.url) {
    const head = await fetch(audio[0].url, { headers: { range: "bytes=0-65535", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
    const buf = await head.arrayBuffer();
    results.webPlayerStream = head.status + " " + buf.byteLength + "B " + (head.headers.get("content-type") || "?");
  }
} catch (error) {
  results.webPlayer = "ERR " + String(error?.message || error).slice(0, 70);
}

// b) piped instances
for (const inst of ["pipedapi.kavin.rocks", "pipedapi.adminforge.de", "api.piped.private.coffee", "pipedapi.reallyaweso.me"]) {
  try {
    const r = await fetch("https://" + inst + "/streams/421w1j87fEM", {
      headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) { results["piped:" + inst] = "HTTP " + r.status; continue; }
    const data = await r.json();
    const audio = (data.audioStreams || [])[0];
    if (audio?.url) {
      results["piped:" + inst] = "audio: " + (audio.mimeType || "").slice(0, 24);
      const head = await fetch(audio.url, { headers: { range: "bytes=0-65535", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
      const buf = await head.arrayBuffer();
      results["piped:" + inst + "Stream"] = head.status + " " + buf.byteLength + "B " + (head.headers.get("content-type") || "?");
    } else {
      results["piped:" + inst] = "no audio streams";
    }
  } catch (error) {
    results["piped:" + inst] = "ERR " + String(error?.message || error).slice(0, 50);
  }
}

// c) iOS client
try {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)" },
    body: JSON.stringify({
      context: { client: { clientName: "IOS", clientVersion: "19.09.3", deviceModel: "iPhone14,3", hl: "en", gl: "NG" } },
      videoId: "421w1j87fEM"
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await r.json().catch(() => null);
  const status = data?.playabilityStatus?.status;
  const audio = (data?.streamingData?.adaptiveFormats || []).filter(f => (f.type || "").startsWith("audio/"));
  results.iosPlayer = (status || "?") + " | " + audio.length + " audio fmt | " +
    (audio.some(f => f.url) ? "DIRECT URL YES" : "cipher only");
} catch (error) {
  results.iosPlayer = "ERR " + String(error?.message || error).slice(0, 70);
}

console.log(JSON.stringify(results, null, 2));
