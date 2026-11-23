// End-to-end proof of the NEW keyless YouTube audio chain:
//   /search/ytsearch (find official video) → /download/ytmp3 (direct mp3 CDN url)
// then HEAD-checks the mp3 URL is really downloadable with audio bytes.
async function ytSearch(q) {
  const res = await fetch("https://eliteprotech-apis.zone.id/search/ytsearch?q=" + encodeURIComponent(q), {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const data = await res.json();
  const vids = data?.results?.videos || data?.results || [];
  return Array.isArray(vids) ? vids : [];
}

async function ytmp3(url) {
  const res = await fetch("https://eliteprotech-apis.zone.id/download/ytmp3?url=" + encodeURIComponent(url), {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return await res.json();
}

const queries = process.argv.slice(2).length ? process.argv.slice(2) : ["Calm Down Rema", "Last Last Burna Boy"];

for (const q of queries) {
  console.log("\n=== " + q + " ===");
  const vids = await ytSearch(q);
  const top = vids[0];
  if (!top) { console.log("search: no results"); continue; }
  console.log("search top:", top.title, "|", top.url);
  const conv = await ytmp3(top.url);
  const dl = conv?.download?.downloadUrl || conv?.downloadUrl || conv?.download?.url;
  console.log("convert:", conv?.status === true ? "OK" : "FAILED " + JSON.stringify(conv).slice(0, 120));
  if (!dl) continue;
  const head = await fetch(dl, { method: "GET", headers: { Range: "bytes=0-1023", "User-Agent": "Mozilla/5.0" } });
  console.log("mp3 check:", head.status, "|", head.headers.get("content-type"),
    "| total-bytes:", head.headers.get("content-range")?.split("/")[1] || head.headers.get("content-length"));
}
