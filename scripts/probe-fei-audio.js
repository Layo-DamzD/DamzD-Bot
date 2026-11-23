// Probe the bot's own FEI root (api-rebix.vercel.app) for a working
// ytmp3/audio route — the video route (ytv) works, maybe audio does too.
const BASE = "https://api-rebix.vercel.app/api";
const results = {};

// discover routes: try the root and common names
for (const route of ["", "ytmp3", "yta", "audio", "play", "song", "downloader", "dl"]) {
  try {
    const r = await fetch(BASE + "/" + route, { signal: AbortSignal.timeout(10000) });
    const text = await r.text().catch(() => "");
    results[route || "root"] = r.status + " " + text.slice(0, 120).replace(/\n/g, " ");
  } catch (error) {
    results[route || "root"] = "ERR " + String(error?.message || error).slice(0, 60);
  }
}

// ytv with a real video — check if it returns an audio field too
try {
  const r = await fetch(BASE + "/ytv?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D421w1j87fEM", { signal: AbortSignal.timeout(90000) });
  const data = await r.json().catch(() => null);
  const d = data?.results || data?.result || data?.data || {};
  results.ytvKeys = r.status + " keys:" + Object.keys(d).join(",");
  results.ytvUrls = JSON.stringify({ download: (d.downloadUrl || d.download || d.url || "").slice(0, 60), quality: d.quality, title: (d.title || "").slice(0, 40), medias: Array.isArray(d.medias) ? d.medias.map(m => m.type || m.mimeType).join(",") : null }).slice(0, 200);
} catch (error) {
  results.ytvError = String(error?.message || error).slice(0, 80);
}

console.log(JSON.stringify(results, null, 2));
