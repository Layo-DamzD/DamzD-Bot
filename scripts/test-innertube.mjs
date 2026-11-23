// Probe YouTube's internal (Innertube) API for search + audio streams.
// If this works from this sandbox, .song can use it directly with no
// third-party provider in the middle.
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"; // android client key

async function ytSearch(query) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search?key=" + ANDROID_KEY, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11)" },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "en", gl: "NG" } },
      query
    }),
    signal: AbortSignal.timeout(30000)
  });
  const j = await res.json();
  const videos = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      videos.push({
        id: v.videoId,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || "Untitled",
        author: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "",
        duration: v.lengthText?.simpleText || ""
      });
    }
    for (const value of Object.values(node)) walk(value);
  })(j);
  return videos.slice(0, 5);
}

async function ytPlayer(videoId) {
  const res = await fetch("https://www.youtubei/v1/player?key=" + ANDROID_KEY, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11)" },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "en", gl: "NG" } },
      videoId
    }),
    signal: AbortSignal.timeout(30000)
  });
  const j = await res.json();
  const status = j.playabilityStatus?.status;
  const formats = j.streamingData?.adaptiveFormats || [];
  const audio = formats
    .filter(f => f.mimeType?.startsWith("audio/") && f.url)
    .map(f => ({ itag: f.itag, mime: f.mimeType.split(";")[0], bitrate: f.bitrate, url: f.url.slice(0, 60) + "…" }));
  return { status, audioCount: formats.filter(f => f.mimeType?.startsWith("audio/")).length, audio, reasons: j.playabilityStatus?.reason || "" };
}

const videos = await ytSearch(process.argv[2] || "altare bye");
console.log("search results:", videos.length);
videos.slice(0, 3).forEach(v => console.log("  -", v.id, "|", v.title, "|", v.author, "|", v.duration));
if (videos[0]) {
  const p = await ytPlayer(videos[0].id);
  console.log("player status:", p.status, p.reasons);
  console.log("audio streams:", p.audioCount);
  p.audio.forEach(a => console.log("  itag", a.itag, a.mime, a.bitrate));
}
