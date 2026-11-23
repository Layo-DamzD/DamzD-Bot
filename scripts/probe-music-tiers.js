// LIVE probe of the two cloud-safe music tiers for .song v2.3.1:
//   Tier 1: Audius public API — bootstrap hosts, search, stream URL + a
//           real byte-range fetch of the stream to prove it plays.
//   Tier 2: SoundCloud — try the public web patterns: search page's
//           __next_data or oEmbed, then the progressive stream URL that
//           the web player itself uses. Everything without a login.
import fs from "node:fs";
const envPath = "/home/z/my-project/download/puter-token-for-render.txt";
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^(PUTER_AUTH_TOKEN)=([A-Za-z0-9._,-]+)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const APP = "DamzD-Bot";
const results = {};

// ---------- Tier 1: Audius ----------
async function audiusProbe() {
  try {
    const boot = await fetch("https://api.audius.co", { signal: AbortSignal.timeout(8000) });
    const hosts = (await boot.json()).data || [];
    results.audiusBootstrap = hosts.length + " hosts";
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    const search = await fetch(
      host + "/v1/tracks/search?query=" + encodeURIComponent("Burna Boy Last Last") + "&app_name=" + APP,
      { signal: AbortSignal.timeout(10000) });
    const tracks = (await search.json()).data || [];
    const top = tracks[0];
    results.audiusSearch = top ? top.title + " — " + (top.user?.name || "?") + " (" + (top.duration || 0) + "s)" : "no tracks";
    if (top) {
      const streamUrl = host + "/v1/tracks/" + top.id + "/stream?app_name=" + APP;
      const head = await fetch(streamUrl, { headers: { range: "bytes=0-65535" }, signal: AbortSignal.timeout(15000) });
      const buf = await head.arrayBuffer();
      results.audiusStream = "HTTP " + head.status + ", " + buf.byteLength + " bytes, type " + (head.headers.get("content-type") || "?") + ", final-host " + (head.url || "").split("/")[2];
      results.audiusStreamOk = head.status === 200 || head.status === 206;
      // Nigerian/afrobeats coverage check
      const search2 = await fetch(
        host + "/v1/tracks/search?query=" + encodeURIComponent("Asake Lonely At The Top") + "&app_name=" + APP,
        { signal: AbortSignal.timeout(10000) });
      const t2 = (await search2.json()).data || [];
      results.audiusAsake = t2[0] ? t2[0].title + " — " + (t2[0].user?.name || "?") : "none";
    }
  } catch (error) {
    results.audiusError = String(error?.message || error).slice(0, 100);
  }
}

// ---------- Tier 2: SoundCloud ----------
async function soundcloudProbe() {
  // a) oEmbed — needs a known track URL; try the public search page first.
  try {
    const page = await fetch(
      "https://soundcloud.com/search?q=" + encodeURIComponent("Burna Boy Last Last"),
      { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" }, signal: AbortSignal.timeout(12000) });
    results.scSearchPage = "HTTP " + page.status;
    const html = await page.text();
    // soundcloud serves either hydrations JSON or a redirect chain
    const hydrateMatch = html.match(/window\.__sc_hydration\s*=\s*(\[.*?\]);/s);
    if (hydrateMatch) {
      const hydration = JSON.parse(hydrateMatch[1]);
      const track = hydration.find(h => h.hydratable === "sound" && h.data?.permalink_url);
      results.scHydration = track ? track.data.title + " | " + track.data.permalink_url : "no sound in hydration";
      if (track?.data?.urn || track?.data?.id) {
        results.scUrn = JSON.stringify({ urn: track.data.urn, id: track.data.id, media: track.data.media?.transcodings?.map(t => t.format?.protocol + "/" + t.format?.mime_codec) });
      }
    } else {
      results.scHydration = "no hydration block (" + html.length + " bytes)";
    }
  } catch (error) {
    results.scSearchError = String(error?.message || error).slice(0, 100);
  }

  // b) the api-v2 search with the public web client_id (discoverable from the app bundle)
  try {
    const assets = await fetch("https://soundcloud.com", { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" }, signal: AbortSignal.timeout(12000) });
    const html = await assets.text();
    const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
    results.scAssets = scripts.length + " script bundles";
    let clientId = null;
    for (const script of scripts.slice(0, 4)) {
      const js = await fetch(script, { signal: AbortSignal.timeout(12000) }).then(r => r.text()).catch(() => "");
      const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{30,40})"/);
      if (m) { clientId = m[1]; break; }
    }
    results.scClientId = clientId ? clientId.slice(0, 6) + "…" + " (found)" : "not found";
    if (clientId) {
      const search = await fetch(
        "https://api-v2.soundcloud.com/search/tracks?q=" + encodeURIComponent("Burna Boy Last Last") +
        "&client_id=" + clientId + "&limit=3",
        { signal: AbortSignal.timeout(12000) });
      const data = await search.json();
      const track = data?.collection?.[0];
      results.scApiSearch = track ? track.title + " — " + (track.user?.username || "?") + " (" + Math.round((track.duration || 0) / 1000) + "s)" : "HTTP " + search.status;
      if (track) {
        const progressive = track.media?.transcodings?.find(t => t.format?.protocol === "progressive");
        if (progressive) {
          const stream = await fetch(progressive.url + "?client_id=" + clientId, { signal: AbortSignal.timeout(12000) });
          const streamJson = await stream.json();
          const url = streamJson?.url;
          if (url) {
            const audio = await fetch(url, { headers: { range: "bytes=0-65535" }, signal: AbortSignal.timeout(15000) });
            const buf = await audio.arrayBuffer();
            results.scStream = "HTTP " + audio.status + ", " + buf.byteLength + " bytes, " + (audio.headers.get("content-type") || "?");
            results.scStreamOk = (audio.status === 200 || audio.status === 206) && buf.byteLength > 1000;
          }
        } else {
          results.scStream = "no progressive transcoding (hls only?)";
        }
      }
    }
  } catch (error) {
    results.scApiError = String(error?.message || error).slice(0, 100);
  }
}

await audiusProbe();
await soundcloudProbe();
console.log(JSON.stringify(results, null, 2));
