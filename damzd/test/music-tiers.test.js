import test from "node:test";
import assert from "node:assert/strict";

// The v2.3.1 music-tier pick logic. These guards are what keep the
// cloud-safe tiers honest: a DJ's remix, a 30-second label snippet, or an
// encrypted-HLS-only upload must NEVER stand in for the real full track.
import {
  artistMatches,
  pickAudiusTrack,
  pickSoundcloudTrack
} from "../lib/render-music.js";

test("artistMatches: the official artist matches its own uploads", () => {
  assert.ok(artistMatches("Burna Boy", "Burna Boy"));
  assert.ok(artistMatches("Burna Boy", "Burna Boy Official"));
  assert.ok(artistMatches("Asake", "asake"));
  assert.ok(artistMatches("Wizkid", "Wizkid Naija")); // shared real word
});

test("artistMatches: remix DJs and covers are rejected", () => {
  assert.equal(artistMatches("Burna Boy", "DJ RyanFlossy"), false);
  assert.equal(artistMatches("Asake", "TOMO"), false);
  assert.equal(artistMatches("Burna Boy", ""), false);
  assert.equal(artistMatches("", "Anyone"), false);
  // substring match is deliberate: official handles like Rema's "heisrema"
  // embed the artist name — that IS the artist's own upload.
  assert.ok(artistMatches("Rema", "heisrema"));
});

test("pickAudiusTrack: full-length track by the artist wins", () => {
  const tracks = [
    { id: "1", title: "Last Last (WYFL RIDDIM)", user: { name: "DJ RyanFlossy" }, duration: 151 },
    { id: "2", title: "Last Last", user: { name: "Burna Boy" }, duration: 148 }
  ];
  const hit = pickAudiusTrack(tracks, "Burna Boy");
  assert.ok(hit);
  assert.equal(hit.id, "2");
  assert.equal(hit.artist, "Burna Boy");
});

test("pickAudiusTrack: snippets and remixes never picked", () => {
  assert.equal(pickAudiusTrack(
    [{ id: "1", title: "Teaser", user: { name: "Burna Boy" }, duration: 45 }],
    "Burna Boy"
  ), null, "under 90s is a snippet, not the song");
  assert.equal(pickAudiusTrack(
    [{ id: "1", title: "Remix", user: { name: "Some DJ" }, duration: 300 }],
    "Burna Boy"
  ), null, "uploader must match the artist");
  assert.equal(pickAudiusTrack(null, "Burna Boy"), null);
  assert.equal(pickAudiusTrack([], "Burna Boy"), null);
});

test("pickSoundcloudTrack: progressive full upload by the artist wins", () => {
  const items = [
    { kind: "user", username: "Asake" }, // search mixes users in — skipped
    {
      kind: "track",
      title: "Last Last",
      duration: 30000, // 30s label snippet — skipped
      user: { username: "Burna Boy" },
      media: { transcodings: [{ format: { protocol: "progressive" }, url: "https://x" }] }
    },
    {
      kind: "track",
      title: "On The Low",
      duration: 213000,
      user: { username: "Burna Boy" },
      media: { transcodings: [
        { format: { protocol: "hls" }, url: "https://h" },
        { format: { protocol: "progressive" }, url: "https://p" }
      ] }
    }
  ];
  const hit = pickSoundcloudTrack(items, "Burna Boy");
  assert.ok(hit);
  assert.equal(hit.title, "On The Low");
  assert.equal(hit.duration, 213);
});

test("pickSoundcloudTrack: encrypted-hls-only and foreign uploads rejected", () => {
  // Asake on SoundCloud: hls-only + encrypted — no progressive, skip honestly
  assert.equal(pickSoundcloudTrack([
    {
      kind: "track",
      title: "Lonely At The Top",
      duration: 158000,
      user: { username: "Asake" },
      media: { transcodings: [
        { format: { protocol: "cbc-encrypted-hls" }, url: "https://e1" },
        { format: { protocol: "ctr-encrypted-hls" }, url: "https://e2" }
      ] }
    }
  ], "Asake"), null, "no progressive transcoding — cannot fetch");
  assert.equal(pickSoundcloudTrack([
    {
      kind: "track",
      title: "Cover",
      duration: 240000,
      user: { username: "Cover Band" },
      media: { transcodings: [{ format: { protocol: "progressive" }, url: "https://x" }] }
    }
  ], "Burna Boy"), null, "uploader must match the artist");
});
