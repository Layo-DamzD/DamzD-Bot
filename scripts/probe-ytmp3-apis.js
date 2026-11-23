// Round 2 of full-track rungs — public ytmp3 APIs, live-probed with a
// real Nigerian hit (Burna Boy Last Last). Each candidate must return a
// https mp3/m4a URL that actually serves audio bytes.
const VIDEO = "https://www.youtube.com/watch?v=421w1j87fEM";
const results = {};

async function tryJson(name, url, paths, timeout = 30000) {
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(timeout)
    });
    if (!r.ok) { results[name] = "HTTP " + r.status; return; }
    const data = await r.json().catch(() => null);
    let url2 = "";
    for (const p of paths) {
      let v = data;
      for (const k of p.split(".")) v = v && v[k];
      if (typeof v === "string" && /^https:\/\//.test(v)) { url2 = v; break; }
    }
    if (!url2) { results[name] = "no url in: " + JSON.stringify(data).slice(0, 90); return; }
    const head = await fetch(url2, { headers: { range: "bytes=0-65535", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    const buf = await head.arrayBuffer();
    results[name] = "STREAM " + head.status + " " + buf.byteLength + "B " + (head.headers.get("content-type") || "?");
    if ((head.status === 200 || head.status === 206) && buf.byteLength > 10000) results[name + "OK"] = true;
  } catch (error) {
    results[name] = "ERR " + String(error?.message || error).slice(0, 70);
  }
}

// The candidates — public, keyless, known in the WA-bot ecosystem:
await tryJson("cobalt", "https://api.cobalt.tools/api/json", null); // POST-only likely; probe GET first
// cobalt needs POST — do it properly:
try {
  const r = await fetch("https://api.cobalt.tools/", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url: VIDEO, audioFormat: "mp3", downloadMode: "audio" }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await r.json().catch(() => null);
  results.cobaltPost = r.status + " " + JSON.stringify(data).slice(0, 120);
  if (data?.status === "tunnel" || data?.status === "redirect") {
    const head = await fetch(data.url, { headers: { range: "bytes=0-65535" }, signal: AbortSignal.timeout(30000) });
    const buf = await head.arrayBuffer();
    results.cobaltStream = "STREAM " + head.status + " " + buf.byteLength + "B " + (head.headers.get("content-type") || "?");
  }
} catch (error) {
  results.cobaltPost = "ERR " + String(error?.message || error).slice(0, 70);
}

await tryJson("dapahtoi",
  "https://api.dapahtoi.my.id/dl/ytmp3?url=" + encodeURIComponent(VIDEO),
  ["result.url", "result.download", "url", "data.url"]);
await tryJson("nixinowa",
  "https://api.nixinowa.my.id/dl/ytmp3?url=" + encodeURIComponent(VIDEO),
  ["result.url", "data.url", "url"]);
await tryJson("agatz",
  "https://api.agatz.xyz/api/ytmp3?url=" + encodeURIComponent(VIDEO),
  ["data[0].url", "data.url", "result.url"]);
await tryJson("ruka",
  "https://api.ruoka.my.id/dl/ytmp3?url=" + encodeURIComponent(VIDEO),
  ["result.url", "data.url", "url"]);
await tryJson("voxcloud",
  "https://api.voxcloud.my.id/dl/ytmp3?url=" + encodeURIComponent(VIDEO),
  ["result.url", "data.url", "url"]);
await tryJson("fasturl",
  "https://api.fasturl.link/downup/ytdown-v1?url=" + encodeURIComponent(VIDEO),
  ["result.audio", "result.url", "data.audio", "data.url"]);
await tryJson("btch",
  "https://api.btch.my.id/downloader/ytmp3?url=" + encodeURIComponent(VIDEO),
  ["result.url", "data.url", "url"]);

console.log(JSON.stringify(results, null, 2));
