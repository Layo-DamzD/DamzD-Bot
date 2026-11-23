// Round 3 — the bigger, still-maintained public downloaders used by the
// current WA-bot generation, plus invidious instances (which proxy
// YouTube's own streams — datacenter-friendly and keyless).
const VIDEO = "https://www.youtube.com/watch?v=421w1j87fEM";
const results = {};

async function probeStream(url, name) {
  try {
    const head = await fetch(url, { headers: { range: "bytes=0-65535", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    const buf = await head.arrayBuffer();
    results[name + "Stream"] = head.status + " " + buf.byteLength + "B " + (head.headers.get("content-type") || "?");
    if ((head.status === 200 || head.status === 206) && buf.byteLength > 10000) results[name + "Ok"] = true;
  } catch (error) {
    results[name + "Stream"] = "ERR " + String(error?.message || error).slice(0, 60);
  }
}

async function tryJson(name, url, paths, timeout = 45000) {
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(timeout)
    });
    if (!r.ok) { results[name] = "HTTP " + r.status; return null; }
    const data = await r.json().catch(() => null);
    let url2 = "";
    for (const p of paths) {
      let v = data;
      for (const k of p.split(".")) v = v && v[k];
      if (typeof v === "string" && /^https:\/\//.test(v)) { url2 = v; break; }
    }
    results[name] = url2 ? "got url" : "no url: " + JSON.stringify(data).slice(0, 100);
    return url2 || null;
  } catch (error) {
    results[name] = "ERR " + String(error?.message || error).slice(0, 60);
    return null;
  }
}

// 1) velyn.dev — REST wrapper, popular right now
const velyn = await tryJson("velyn",
  "https://api.velyn.dev/v1/downloader/ytdl?url=" + encodeURIComponent(VIDEO) + "&format=mp3",
  ["data.url", "data.audio", "result.url", "url"]);
if (velyn) await probeStream(velyn, "velyn");

// 2)指尖 api.ketsu.tk / axezone / zenkey
await tryJson("zenkey", "https://api.zenkey.my.id/downloader/ytmp3?url=" + encodeURIComponent(VIDEO), ["result.url", "data.url"]);
const zenus = await tryJson("zenus", "https://api.zenius.my.id/downloader/ytmp3?url=" + encodeURIComponent(VIDEO), ["result.url", "data.url"]);
if (zenus) await probeStream(zenus, "zenus");

// 3) invidious — proxy YouTube's own audio stream (keyless)
for (const inst of ["iv.datura.network", "inv.nadeko.net", "invidious.nerdvpn.de"]) {
  try {
    const r = await fetch("https://" + inst + "/api/v1/videos/421w1j87fEM?fields=adaptiveFormats,title", {
      headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) { results["inv:" + inst] = "HTTP " + r.status; continue; }
    const data = await r.json();
    const audio = (data.adaptiveFormats || []).find(f => (f.type || "").startsWith("audio/mp4"));
    if (audio?.url) {
      results["inv:" + inst] = "audio format found (" + Math.round((audio.bitrate || 0) / 1000) + "kbps)";
      // invidious may need local=true to proxy
      const streamUrl = audio.url.startsWith("http") ? audio.url : "https://" + inst + audio.url;
      await probeStream(streamUrl, "inv:" + inst.split(".")[1] || inst);
    } else {
      results["inv:" + inst] = "no audio format";
    }
  } catch (error) {
    results["inv:" + inst] = "ERR " + String(error?.message || error).slice(0, 50);
  }
}

// 4) youtubei player API directly (the innertube ANDROID client often
//    serves direct googlevideo urls without login from datacenter IPs)
try {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip" },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "en", gl: "NG" } },
      videoId: "421w1j87fEM"
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await r.json().catch(() => null);
  const status = data?.playabilityStatus?.status;
  const formats = data?.streamingData?.adaptiveFormats || [];
  const audio = formats.filter(f => (f.type || "").startsWith("audio/"));
  results.innertubeAndroid = status + ", " + audio.length + " audio formats" +
    (audio[0]?.url ? ", direct-url YES" : ", no urls (signatureCipher only)");
  if (audio[0]?.url) {
    await probeStream(audio[0].url, "innertube");
  }
} catch (error) {
  results.innertubeAndroid = "ERR " + String(error?.message || error).slice(0, 60);
}

console.log(JSON.stringify(results, null, 2));
