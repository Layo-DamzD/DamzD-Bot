// SoundCloud round 4 — the /search route (web app's own) DOES return
// progressive transcodings for official uploads ("Last Last" showed
// "hls,progressive"). Prove the full chain end-to-end on two Nigerian
// tracks: search → progressive url → real audio bytes.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CLIENT_ID = "BzENOQHynNEEqrW7hjR3mefOi7JYXB3s";
const results = {};

async function resolve(query) {
  const out = {};
  try {
    const search = await fetch(
      "https://api-v2.soundcloud.com/search?q=" + encodeURIComponent(query) + "&client_id=" + CLIENT_ID + "&limit=12",
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    const items = (await search.json().catch(() => null))?.collection || [];
    // prefer tracks (skip users/playlists), official-ish uploaders first
    const tracks = items.filter(t => t?.kind === "track" && t?.media?.transcodings);
    const pick = tracks.find(t => t.media.transcodings.some(x => x.format?.protocol === "progressive")) || tracks[0];
    if (!pick) return { error: "no tracks" };
    out.top = pick.title + " [" + (pick.user?.username || "?") + "] " + Math.round((pick.duration || 0) / 1000) + "s" +
      " protocols=" + pick.media.transcodings.map(x => x.format?.protocol).join(",");
    const progressive = pick.media.transcodings.find(x => x.format?.protocol === "progressive");
    if (!progressive) return { ...out, error: "hls-only" };
    const meta = await fetch(progressive.url + "?client_id=" + CLIENT_ID, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) }).then(r => r.json()).catch(() => null);
    if (!meta?.url) return { ...out, error: "no stream url" };
    const audio = await fetch(meta.url, { headers: { "user-agent": UA, range: "bytes=0-262143" }, signal: AbortSignal.timeout(25000) });
    const buf = await audio.arrayBuffer();
    out.stream = audio.status + " " + buf.byteLength + "B " + (audio.headers.get("content-type") || "?");
    out.total = audio.headers.get("content-range") || audio.headers.get("content-length") || "?";
    out.ok = (audio.status === 200 || audio.status === 206) && buf.byteLength > 50000;
    // sniff mp3 header
    const head = Buffer.from(buf.slice(0, 4));
    out.sniff = head[0] === 0xff && (head[1] & 0xe0) === 0xe0 ? "mp3-frame" : (head.slice(0, 3).toString() === "ID3" ? "mp3-id3" : head.toString("hex"));
  } catch (error) {
    out.error = String(error?.message || error).slice(0, 100);
  }
  return out;
}

results.burna = await resolve("Burna Boy Last Last");
results.asake = await resolve("Asake Lonely At The Top");
results.rema = await resolve("Rema Calm Down");
results.burnaWedding = await resolve("Burna Boy On The Low");
console.log(JSON.stringify(results, null, 2));
