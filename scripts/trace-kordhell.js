// Why did the Kordhell query fall to link-only? The HLS tier needs the
// artist to match the uploader AND needs the m3u8 transcoding to be
// audio/mp4 mime. Trace each step.
import { soundcloudHlsTrack } from "/home/z/my-project/damzd/lib/render-music.js";

const r = await soundcloudHlsTrack("Kordhell Murder In My Mind", "KORDHELL");
console.log("direct call result:", r ? (r.title + " / " + r.audioBuffer?.length + "B") : "null");

// manual trace: what does search return, and what's in transcodings?
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const cid = "BzENOQHynNEEqrW7hjR3mefOi7JYXB3s";
const search = await fetch("https://api-v2.soundcloud.com/search?q=" + encodeURIComponent("Kordhell Murder In My Mind") + "&client_id=" + cid + "&limit=20", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
const items = (await search.json().catch(() => ({}))).collection || [];
for (const item of items.slice(0, 6)) {
  if (item?.kind !== "track") { console.log("skip kind=" + item?.kind); continue; }
  console.log((item.user?.username || "?").slice(0, 22), "|", String(item.title).slice(0, 30), "|", Math.round((item.duration || 0) / 1000) + "s");
  for (const t of item.media?.transcodings || []) {
    console.log("   ", t.format?.protocol, "|", t.format?.mime_codec, "|", t.url.slice(0, 60));
  }
}
