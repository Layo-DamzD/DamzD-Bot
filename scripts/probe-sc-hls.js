// The SoundCloud genre probe exposed label blocks: the official accounts
// (The Weeknd, Dua Lipa, Nirvana, Led Zeppelin) ARE there but serve 30s
// snippets or hls-only. ONE case slipped through needing attention:
// Miles Davis SM (545s) and Led Zeppelin official (483s) show full seconds
// but were skipped — check their transcoding protocols. Maybe protocol
// pick needs to accept hls when it's NOT encrypted (plain hls = fetchable
// segments, concatenable to a full file).
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CLIENT_ID = "BzENOQHynNEEqrW7hjR3mefOi7JYXB3s";
const out = {};

async function j(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
  return r.json();
}

for (const [label, q, want] of [
  ["zeppelin", "Led Zeppelin Stairway to Heaven", "led zeppelin"],
  ["miles", "Miles Davis So What", "miles davis"],
  ["kordhell", "Kordhell Scorpion Genghis", "kordhell"]
]) {
  try {
    const data = await j("https://api-v2.soundcloud.com/search?q=" + encodeURIComponent(q) + "&client_id=" + CLIENT_ID + "&limit=20");
    const items = data?.collection || [];
    for (const item of items) {
      if (item?.kind !== "track" || !item?.media?.transcodings) continue;
      const uploader = String(item.user?.username || "");
      if (!uploader.toLowerCase().includes(want)) continue;
      const dur = Math.round((Number(item.duration) || 0) / 1000);
      const protocols = item.media.transcodings.map(t => t.format?.protocol);
      out[label + ":" + uploader.slice(0, 20) + "/" + dur + "s"] = protocols.join(",");
      // if any hls transcoding exists, fetch its playlist — encrypted or plain?
      const hls = item.media.transcodings.find(t => t.format?.protocol === "hls");
      if (hls) {
        const meta = await j(hls.url + "?client_id=" + CLIENT_ID);
        if (meta?.url) {
          const m3u8 = await fetch(meta.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) }).then(r => r.text()).catch(() => "");
          const segs = m3u8.split("\n").filter(l => l && !l.startsWith("#")).length;
          out[label + ":hls"] = segs + " segments | encrypted=" + (/skd:|encryption/i.test(m3u8) ? "YES" : "no");
          // plain hls: fetch first segment and sniff
          if (!/skd:|encryption/i.test(m3u8) && segs > 0) {
            const first = m3u8.split("\n").find(l => l && !l.startsWith("#"));
            const seg = await fetch(first.startsWith("http") ? first : new URL(first, meta.url).href, { headers: { "user-agent": UA, range: "bytes=0-4095" }, signal: AbortSignal.timeout(15000) });
            const buf = await seg.arrayBuffer();
            out[label + ":seg0"] = seg.status + " " + buf.byteLength + "B " + (seg.headers.get("content-type") || "?");
          }
        }
      }
      if (dur >= 90) break; // one full-length candidate per query is enough
    }
  } catch (e) { out[label + "Error"] = String(e?.message || e).slice(0, 70); }
}
console.log(JSON.stringify(out, null, 1));
