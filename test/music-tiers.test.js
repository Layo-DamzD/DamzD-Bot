import test from "node:test";
import assert from "node:assert/strict";

// The v2.3.2 music-tier pick logic. These guards are what keep the
// cloud-safe tiers honest: a DJ's remix, a 30-second label snippet, an
// encrypted-HLS-only upload, a tribute band, or a DJ medley must NEVER
// stand in for the real full track.
import {
  artistMatches,
  pickAudiusTrack,
  pickSoundcloudTrack,
  titleMatches,
  scUploaderOk,
  uploaderIsTheArtist,
  amUploaderOk,
  pickAudiomackSong,
  isAfricanMusic
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

test("titleMatches: medleys and DJ blends are rejected outright", () => {
  assert.equal(titleMatches("Levitating", "One Kiss / Whatcha Doing / Levitating (DJ Set)"), false);
  assert.equal(titleMatches("So What", "So What vs. Giant Steps (Mashup)"), false);
  assert.equal(titleMatches("Take Five", "Jazz Classics Medley"), false);
  // real single titles still match
  assert.ok(titleMatches("Last Last", "Last Last"));
  assert.ok(titleMatches("Lonely At The Top", "Lonely At The Top (Remix)")); // variant labels checked separately
  assert.ok(titleMatches("", "Anything"), "no known title means artist check alone");
  // v2.3.3: release metadata on the WANTED title is stripped before matching
  assert.ok(titleMatches("Last Last (Official Music Video)", "Last Last"));
  assert.ok(titleMatches("So What [Remastered 2011]", "So What"));
});

test("titleMatches: a different song by the same artist never matches (v2.3.3)", () => {
  // one shared generic word is not the song — this was the old bug
  assert.equal(titleMatches("Lonely At The Top", "Baszz To The Top"), false);
  assert.equal(titleMatches("Last Last", "On The Low"), false);
  assert.equal(titleMatches("Bohemian Rhapsody", "Another One Bites The Dust"), false);
  // every significant word of the wanted title must appear
  assert.ok(titleMatches("Bohemian Rhapsody", "Bohemian Rhapsody - Remastered 2011"));
  assert.ok(titleMatches("Murder In My Mind", "Murder In My Mind (Explicit)"));
});

test("scUploaderOk: tribute bands never stand in for a verified act", () => {
  const items = [
    { kind: "track", user: { username: "Killer Queen Band Page", verified: false, followers_count: 85 } },
    { kind: "track", user: { username: "Queen Official", verified: true, followers_count: 500000 } }
  ];
  assert.equal(scUploaderOk(items, "Queen", items[0].user), false);
  assert.ok(scUploaderOk(items, "Queen", items[1].user));
});

test("scUploaderOk: indie artists pass on their own strictly-named account", () => {
  const indie = [{ kind: "track", user: { username: "Feli Nuna", verified: false, followers_count: 800 } }];
  assert.ok(scUploaderOk(indie, "Feli Nuna", indie[0].user));
  const fanPage = [{ kind: "track", user: { username: "Feli Nuna Fan Page", verified: false, followers_count: 20 } }];
  assert.equal(scUploaderOk(fanPage, "Feli Nuna", fanPage[0].user), false);
});

test("uploaderIsTheArtist: tribute words and partial names fail", () => {
  assert.ok(uploaderIsTheArtist("Feli Nuna", { username: "Feli Nuna" }));
  assert.ok(uploaderIsTheArtist("Feli Nuna", { username: "feli nuna official" }));
  assert.equal(uploaderIsTheArtist("Led Zeppelin", { username: "Boot Led Zeppelin" }), false);
  assert.equal(uploaderIsTheArtist("Queen", { username: "Queen Band Tribute" }), false);
  // multi-word artist: every word must be in the account name
  assert.equal(uploaderIsTheArtist("Burna Boy", { username: "Burna" }), false);
});

// ---- Audiomack tier (v2.3.3) — field shapes mirror the live API dump ----

test("amUploaderOk: the artist's own verified account passes", () => {
  // live shape: Asake's official account
  assert.ok(amUploaderOk({ uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } }, "Asake"));
  assert.ok(amUploaderOk({ uploader: { url_slug: "miles-davis", name: "Miles Davis", verified: "yes" } }, "Miles Davis"));
  assert.ok(amUploaderOk({ uploader: { url_slug: "drake", name: "Drake", verified: "yes" } }, "Drake"));
});

test("amUploaderOk: re-uploaders, banned and unverified accounts fail", () => {
  // live shapes from the catalog probes: re-uploaders carrying real songs
  assert.equal(amUploaderOk({ uploader: { url_slug: "the-mixer", name: "The Mixer", verified: "banned" } }, "Drake"), false, "banned account");
  assert.equal(amUploaderOk({ uploader: { url_slug: "bianca-martins-3", name: "Bianca Martins", verified: "" } }, "Queen"), false, "unverified re-uploader");
  assert.equal(amUploaderOk({ uploader: { url_slug: "djlandlord", name: "Dj Landlord", verified: "banned" } }, "Asake"), false, "DJ mix account");
  assert.equal(amUploaderOk({ uploader: { url_slug: "axxel-phonky", name: "PHXNKY ZXNT", verified: "authenticated-declined" } }, "Kordhell"), false, "declined verification");
  assert.equal(amUploaderOk({}, "Asake"), false, "no uploader object");
});

test("amUploaderOk (v2.3.4 strict): a shared word is NOT enough", () => {
  // the exact leak the user hit: "The Weeknd" must not match any verified
  // "The ..." Naija account — the strict gate needs most of the artist name
  assert.equal(amUploaderOk({ uploader: { url_slug: "the-naija-sound", name: "The Naija Sound", verified: "yes" } }, "The Weeknd"), false, "shared 'the' only");
  assert.equal(amUploaderOk({ uploader: { url_slug: "the-official-queen", name: "The Official Queen", verified: "yes" } }, "The Weeknd"), false, "verified but different act");
  // embedded longest word still passes (official handles embed the name)
  assert.ok(amUploaderOk({ uploader: { url_slug: "heisrema", name: "Rema", verified: "yes" } }, "Rema"), "heisrema IS Rema");
  assert.ok(amUploaderOk({ uploader: { url_slug: "burnaboy", name: "Burna Boy", verified: "yes" } }, "Burna Boy"), "burnaboy IS Burna Boy");
  // multi-word artist: an account carrying just one word is not the act
  assert.equal(amUploaderOk({ uploader: { url_slug: "boy-genius", name: "Boy Genius", verified: "yes" } }, "Burna Boy"), false, "'boy' alone is not Burna Boy");
});

test("isAfricanMusic: Apple genre decides, Western genres skip the rung", () => {
  // African genres from Apple's oracle
  assert.ok(isAfricanMusic("Afrobeats", "Asake"));
  assert.ok(isAfricanMusic("Worldwide", "Burna Boy"));
  assert.ok(isAfricanMusic("Amapiano", "Kabza De Small"));
  // Western genres → NOT African → Audiomack rung skipped
  assert.equal(isAfricanMusic("Pop", "The Weeknd"), false, "The Weeknd is Pop");
  assert.equal(isAfricanMusic("Alternative", "Tame Impala"), false);
  assert.equal(isAfricanMusic("Hip-Hop/Rap", "Travis Scott"), false);
  assert.equal(isAfricanMusic("Rock", "Queen"), false);
  // generic/missing genre + a known African artist name → gate opens
  assert.ok(isAfricanMusic("", "Asake"));
  assert.ok(isAfricanMusic("Pop", "Wizkid"), "known African act under a generic genre label");
  assert.ok(isAfricanMusic("Hip-Hop/Rap", "Olamide"));
  // Western artist, no genre → stays closed
  assert.equal(isAfricanMusic("", "The Weeknd"), false);
  assert.equal(isAfricanMusic("", "Dua Lipa"), false);
});

test("pickAudiomackSong: official full upload wins, everything else is skipped", () => {
  const songs = [
    // re-uploader first on purpose — rank must not beat the gates
    { id: 1, type: "song", title: "Lonely At The Top", artist: "Asake", duration: 158, status: "complete",
      uploader: { url_slug: "djlandlord", name: "Dj Landlord", verified: "banned" } },
    // under 90s = snippet
    { id: 2, type: "song", title: "Lonely At The Top", artist: "Asake", duration: 45, status: "complete",
      uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } },
    // remix label in the title
    { id: 3, type: "song", title: "Lonely At The Top (Remix)", artist: "Asake", duration: 160, status: "complete",
      uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } },
    // wrong song entirely
    { id: 4, type: "song", title: "Baszz To The Top", artist: "Asake", duration: 160, status: "complete",
      uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } },
    // album/live entries are not songs
    { id: 5, type: "album", title: "Lonely At The Top EP", artist: "Asake", duration: 0, live: true,
      uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } },
    // premium-only (label locked)
    { id: 6, type: "song", title: "Lonely At The Top", artist: "Asake", duration: 160, status: "complete", premium_user_only: "yes",
      uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } },
    // the real one
    { id: 7, type: "song", title: "Lonely At The Top", artist: "Asake", duration: 158, status: "complete",
      uploader: { url_slug: "asakemusic", name: "Asake", verified: "yes" } }
  ];
  const hit = pickAudiomackSong(songs, "Asake", "Lonely At The Top");
  assert.ok(hit);
  assert.equal(hit.id, "7");
  assert.equal(pickAudiomackSong(songs, "Fireboy DML", "Lonely At The Top"), null, "artist must match");
  assert.equal(pickAudiomackSong(null, "Asake", "x"), null);
  assert.equal(pickAudiomackSong([], "Asake", "x"), null);
});
