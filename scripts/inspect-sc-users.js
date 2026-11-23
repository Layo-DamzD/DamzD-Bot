// Inspect verified / followers_count on the candidate tracks — the signal
// that separates an official account from a tribute band.
const UA = "Mozilla/5.0";
const cid = "BzENOQHynNEEqrW7hjR3mefOi7JYXB3s";
for (const q of ["Queen Bohemian Rhapsody", "Led Zeppelin Stairway", "KORDHELL Murder In My Mind"]) {
  try {
    const r = await fetch("https://api-v2.soundcloud.com/search?q=" + encodeURIComponent(q) + "&client_id=" + cid + "&limit=12", {
      headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000)
    });
    const data = await r.json().catch(() => ({}));
    const items = data?.collection || [];
    console.log("=== " + q + " (" + items.length + " items, status " + r.status + ")");
    for (const i of items.filter(x => x?.kind === "track").slice(0, 6)) {
      console.log("  " + (i.user?.username || "?").slice(0, 26).padEnd(26) +
        " verified=" + (i.user?.verified ? "Y" : "n") +
        " followers=" + String(i.user?.followers_count || 0).padStart(9) +
        " | " + String(i.title).slice(0, 30));
    }
  } catch (e) {
    console.log("=== " + q + " ERR " + String(e?.message || e).slice(0, 70));
  }
}
