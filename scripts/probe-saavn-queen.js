// DES-ECB decrypt via crypto-js (pure JS — OpenSSL 3 refuses raw DES,
// exactly why v1.4.44 shipped crypto-js). Then: does the REAL Queen track
// stream full audio from JioSaavn?
import CryptoJS from "/home/z/my-project/damzd/node_modules/crypto-js/index.js";

const KEY = CryptoJS.enc.Utf8.parse("38346591");
function decryptMediaUrl(encoded) {
  const raw = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(String(encoded || "")) },
    KEY,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
  ).toString(CryptoJS.enc.Utf8);
  return raw.replace(/[\x00-\x1f\x7f\s]+/g, "");
}

const r = await fetch("https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&p=1&q=" + encodeURIComponent("Queen Bohemian Rhapsody"), {
  headers: { accept: "*/*", "user-agent": "Mozilla/5.0", origin: "https://www.jiosaavn.com", referer: "https://www.jiosaavn.com/" },
  signal: AbortSignal.timeout(15000)
});
const songs = (await r.json()).results || [];
const queen = songs.find(s => String(s.singers || "").includes("Queen") && !/karaoke|piano|2024/i.test(s.title));
console.log("queen track:", queen ? queen.title + " / " + queen.singers + " / " + queen.more_info?.duration + "s" : "not found");
if (queen) {
  const base = decryptMediaUrl(queen.more_info.encrypted_media_url);
  console.log("decrypted:", base.slice(0, 90));
  for (const [label, variant] of [["96", base], ["320", base.replace("_96.mp4", "_320.mp4")], ["160", base.replace("_96.mp4", "_160.mp4")]]) {
    try {
      const h = await fetch(variant, { headers: { range: "bytes=0-0", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      const total = (h.headers.get("content-range") || "").split("/")[1] || h.headers.get("content-length") || "?";
      console.log(label + "kbps →", h.status, total, h.headers.get("content-type"));
    } catch (e) { console.log(label, "ERR", String(e?.message || e).slice(0, 60)); }
  }
}
