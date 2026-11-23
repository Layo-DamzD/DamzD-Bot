// SoundCloud genre matrix — phonk artists distribute natively there, so
// this should be the phonk tier. Also re-test western/jazz/rock with the
// FULL guard chain (artist-match via official identify + ≥90s + progressive).
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CLIENT_ID = "BzENOQHynNEEqrW7hjR3mefOi7JYXB3s";
const results = {};

async function resolve(query, expectedArtist) {
  const out = {};
  try {
    const search = await fetch(
      "https://api-v2.soundcloud.com/search?q=" + encodeURIComponent(query) + "&client_id=" + CLIENT_ID + "&limit=20",
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    const items = (await search.json().catch(() => null))?.collection || [];
    const want = expectedArtist.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const item of items) {
      if (item?.kind !== "track" || !item?.media?.transcodings) continue;
      const uploader = String(item.user?.username || "");
      const dur = Math.round((Number(item.duration) || 0) / 1000);
      if (dur < 90) continue;
      if (!want.some(w => uploader.toLowerCase().includes(w))) continue;
      const progressive = item.media.transcodings.find(t => t.format?.protocol === "progressive");
      if (!progressive?.url) continue;
      const meta = await fetch(progressive.url + "?client_id=" + CLIENT_ID, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => null);
      if (!meta?.url) continue;
      const head = await fetch(meta.url, { headers: { "user-agent": UA, range: "bytes=0-0" }, signal: AbortSignal.timeout(20000) });
      const total = Number((head.headers.get("content-range") || "").split("/")[1] || 0);
      out.pick = uploader + " — " + item.title.slice(0, 34) + " (" + dur + "s)";
      out.stream = head.status + " " + (total / 1048576).toFixed(1) + "MB";
      out.fullOk = head.status === 206 && total > 500000;
      return out;
    }
    out.delivers = false;
    out.top = items.filter(i => i?.kind === "track").slice(0, 3).map(i => (i.user?.username || "?").slice(0, 22) + "/" + String(i.title || "?").slice(0, 28) + "/" + Math.round((i.duration || 0) / 1000) + "s");
  } catch (error) {
    out.error = String(error?.message || error).slice(0, 70);
  }
  return out;
}

results.phonk_kordhell = await resolve("Kordhell Scorpion Genghis", "Kordhell");
results.phonk_playa = await resolve("PlayaPhonk Why Not", "PlayaPhonk");
results.phonk_moon = await resolve("Moon Riding With The Moonlight", "Moon");
results.western_weeknd = await resolve("The Weeknd Blinding Lights", "The Weeknd");
results.western_dua = await resolve("Dua Lipa Levitating", "Dua Lipa");
results.rock_nirvana = await resolve("Nirvana Smells Like Teen Spirit", "Nirvana");
results.jazz_miles = await resolve("Miles Davis So What", "Miles Davis");
results.rock_zeppelin = await resolve("Led Zeppelin Stairway to Heaven", "Led Zeppelin");

console.log(JSON.stringify(results, null, 1));
