import { requestExternalJson, validateHttpsUrl } from "./api-client.js";

const YOUTUBE_PLAY_API = "https://api.ikyyxd.my.id/search/ytplayv2";

export async function searchYouTubeAudio(query) {
  const search = String(query || "").trim();
  if (!search) throw new Error("Enter a song title or artist name.");
  if (search.length > 200) throw new Error("Keep the song search under 200 characters.");

  const payload = await requestExternalJson(YOUTUBE_PLAY_API, { q: search }, 90000);
  const result = payload?.result || payload?.data?.result || payload?.data || {};
  const audioValue = result?.audio?.url || result?.audioUrl || result?.url;
  const audioUrl = validateHttpsUrl(audioValue, "audio download");
  return {
    title: String(result.title || result.name || search).trim().slice(0, 180) || search,
    audioUrl,
    duration: Number.isFinite(Number(result.duration)) && Number(result.duration) > 0
      ? Number(result.duration)
      : 0,
    source: String(result.source || "")
  };
}
