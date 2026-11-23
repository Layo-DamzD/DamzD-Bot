// Probe the owner-suggested public API endpoints for YouTube→audio:
// Dark Yasiya, Siputzx, Izumi, Gifted Tech. Looking for a ytmp3/yta route
// that returns a real, streamable audio URL from this network.
const V = "agneRtEe-t8";
const YT = "https://www.youtube.com/watch?v=" + V;

function valueAt(payload, paths) {
  for (const path of paths) {
    let value = payload;
    for (const key of path.split(".")) value = value && value[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function probe(label, url, { method = "GET", body = null, headers = {}, paths = [] } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { accept: "application/json", "User-Agent": "Mozilla/5.0", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000)
    });
    const text = await res.text();
    let payload = {};
    try { payload = JSON.parse(text); } catch { /* html */ }
    const audio = valueAt(payload, paths.length ? paths :
      ["result", "data.audio", "data.url", "audio", "url", "download", "downloadUrl", "data.download"]);
    const ok = audio.startsWith("http");
    console.log(label.padEnd(34), "HTTP", res.status, "|", ok ? "AUDIO: " + audio.slice(0, 70) : text.slice(0, 110).replace(/\s+/g, " "));
    return ok ? audio : null;
  } catch (e) {
    console.log(label.padEnd(34), "FAIL", String(e.cause?.code || e.message).slice(0, 60));
    return null;
  }
}

const q = encodeURIComponent(YT);
await probe("siputzx ytmp3", "https://api.siputzx.my.id/api/d/ytmp3?url=" + q, { paths: ["data.audio", "data.url", "url", "result"] });
await probe("siputzx yta", "https://api.siputzx.my.id/api/d/yta?url=" + q);
await probe("darkyasiya ytmp3", "https://api.dark-yasiya-api.site/download/ytmp3?url=" + q, { paths: ["result.dl_link", "data.url", "result", "url"] });
await probe("darkyasiya ytmp4", "https://api.dark-yasiya-api.site/download/ytmp4?url=" + q);
await probe("gifted ytmp3", "https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=" + q, { paths: ["result.download_url", "data.download", "result", "url"] });
await probe("gifted v2", "https://api.giftedtech.co.ke/api/download/dlurl?apikey=gifted&url=" + q);
await probe("izumi ytmp3", "https://api.izumii-official.my.id/api/download/ytmp3?url=" + q);
await probe("izumi alt", "https://izumii-official.my.id/api/dl/ytmp3?url=" + q);
await probe("izumi zenzzx", "https://api.zenzxz.my.id/api/download/ytmp3?url=" + q);
