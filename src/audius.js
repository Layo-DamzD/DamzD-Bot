// Audius: the decentralized music network — keyless, datacenter-friendly,
// and many artists upload their real recordings at up to 320 kbps. It can
// never pass off another singer's work: only a track whose UPLOADER matches
// the officially identified artist is accepted, so remixes and covers (which
// flood Audius under other people's names) are rejected here, and the track
// must be long enough to be a real song rather than a teaser.
import { fetchJson } from "./utils.js";
import { artistMatches } from "./saavn.js";

const AUDIUS_BOOTSTRAP = "https://api.audius.co";
const APP_NAME = "DamzD-Bot";
const AUDIUS_FALLBACK_HOSTS = [
  "https://discoveryprovider.audius.co",
  "https://discoveryprovider2.audius.co"
];

// Pure: walks the search results in rank order and returns the first track
// uploaded by the expected artist, long enough to be the real song.
export function pickAudiusTrack(tracks, expectedArtist) {
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const uploader = String(track?.user?.name || track?.user?.handle || "").trim();
    if (!uploader || !track?.id) continue;
    if (!artistMatches(expectedArtist, uploader)) continue;
    if (Number(track?.duration) < 90) continue;
    return { id: String(track.id), title: String(track.title || "Untitled"), artist: uploader, duration: Number(track.duration) };
  }
  return null;
}

async function audiusHosts() {
  try {
    const payload = await fetchJson(AUDIUS_BOOTSTRAP, { timeoutMs: 10000, label: "Audius directory" });
    const hosts = (Array.isArray(payload?.data) ? payload.data : []).filter(host => /^https:\/\//.test(String(host)));
    if (hosts.length) return hosts.slice(0, 3);
  } catch { /* fall back to the well-known discovery hosts */ }
  return AUDIUS_FALLBACK_HOSTS;
}

// Returns { url, title, artist, duration } for the artist's own full track,
// or null when nothing on Audius is genuinely by that artist — never a guess.
export async function audiusFullTrack(query, expectedArtist) {
  if (!String(expectedArtist || "").trim()) return null;
  const hosts = await audiusHosts();
  for (const host of hosts) {
    try {
      const payload = await fetchJson(
        host + "/v1/tracks/search?query=" + encodeURIComponent(String(query || "").slice(0, 120)) + "&app_name=" + APP_NAME,
        { timeoutMs: 20000, label: "Audius search" }
      );
      const hit = pickAudiusTrack(payload?.data, expectedArtist);
      if (hit) {
        return { ...hit, url: host + "/v1/tracks/" + hit.id + "/stream?app_name=" + APP_NAME };
      }
    } catch { /* next host */ }
  }
  return null;
}
