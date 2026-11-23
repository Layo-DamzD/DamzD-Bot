// SoundCloud round 3 — two questions:
//  1) does /search (not /search/tracks) return progressive transcodings?
//  2) is the Go+ encrypted-hls actually playable without a key (some
//     transcodings are only "encrypted" for Go+ tracks; free tracks
//     usually expose plain hls AND progressive)?
// Also test /tracks/{id}/streams and /tracks/{id}/download endpoints.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CLIENT_ID = "BzENOQHynNEEqrW7hjR3mefOi7JYXB3s";
const results = {};

async function j(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
  return { status: r.status, data: r.ok ? await r.json().catch(() => null) : null };
}

// /search endpoint (the web app's own query route)
const s1 = await j("https://api-v2.soundcloud.com/search?q=" + encodeURIComponent("Burna Boy Last Last") + "&client_id=" + CLIENT_ID + "&limit=5");
results.search = s1.status;
if (s1.data?.collection) {
  for (const t of s1.data.collection.slice(0, 3)) {
    const kinds = (t.media?.transcodings || []).map(x => x.format?.protocol).join(",");
    results["search:" + String(t.title || "?").slice(0, 30)] = kinds || "no-media";
  }
  // try the first track's streams route directly
  const first = s1.data.collection[0];
  const st = await j("https://api-v2.soundcloud.com/tracks/" + first.id + "/streams?client_id=" + CLIENT_ID);
  results.trackStreamsRoute = st.status + (st.data ? " keys:" + Object.keys(st.data).join(",") : "");
  if (st.data?.progressive?.url) {
    const audio = await fetch(st.data.progressive.url, { headers: { "user-agent": UA, range: "bytes=0-131071" }, signal: AbortSignal.timeout(20000) });
    const buf = await audio.arrayBuffer();
    results.progressiveFetch = audio.status + " " + buf.byteLength + "B " + (audio.headers.get("content-type") || "?");
    results.streamOk = (audio.status === 200 || audio.status === 206) && buf.byteLength > 10000;
  }
  // hls route — if only hls exists, test whether the m3u8 is plain (playable via fetch of segments)
  if (!st.data?.progressive?.url && st.data?.hls?.url) {
    const m3u8 = await fetch(st.data.hls.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) }).then(r => r.ok ? r.text() : "").catch(() => "");
    const segments = m3u8.split("\n").filter(l => l && !l.startsWith("#")).length;
    results.hlsPlaylist = segments + " segments, encrypted=" + /skd:|encryption/.test(m3u8);
  }
  // download route (normally needs auth, but check)
  const dl = await j("https://api-v2.soundcloud.com/tracks/" + first.id + "/download?client_id=" + CLIENT_ID);
  results.downloadRoute = dl.status;
}
console.log(JSON.stringify(results, null, 2));
