import test from "node:test";
import assert from "node:assert/strict";

// The JioSaavn tier's pick logic — the guards that keep the licensed
// catalog honest. Verified against real search payloads from today:
// Queen and Dave Brubeck pass; ZZang KARAOKE / Nightcore / "Mera Na"
// (Burna featured on somebody else's song) are rejected.
import { pickSaavnTrack, decryptMediaUrl } from "../lib/saavn-music.js";

function saavnSong({ title, singers, duration, artists, enc = "x" }) {
  return {
    title,
    singers,
    more_info: {
      duration,
      encrypted_media_url: enc,
      artistMap: artists ? { primary_artists: artists.map(name => ({ name })) } : undefined
    }
  };
}

test("pickSaavnTrack: real licensed track wins", () => {
  const songs = [
    saavnSong({ title: "Bohemian Rhapsody (Piano Version)", singers: "Chris Miggells", duration: 368 }),
    saavnSong({ title: "Bohemian Rhapsody", singers: "Queen", duration: 218 })
  ];
  const hit = pickSaavnTrack(songs, "Queen", "Bohemian Rhapsody");
  assert.ok(hit);
  assert.equal(hit.artist, "Queen");
  assert.equal(hit.duration, 218);
});

test("pickSaavnTrack: karaoke and cover variants rejected", () => {
  assert.equal(pickSaavnTrack([
    saavnSong({ title: "Bohemian Rhapsody (2024) (By Queen)", singers: "ZZang KARAOKE", duration: 361 })
  ], "Queen", "Bohemian Rhapsody"), null, "karaoke label");
  assert.equal(pickSaavnTrack([
    saavnSong({ title: "Blinding Lights (Nightcore)", singers: "Nøvacore", duration: 137 })
  ], "The Weeknd", "Blinding Lights"), null, "nightcore label");
  assert.equal(pickSaavnTrack([
    saavnSong({ title: "Essence (Originally Perfomed By Wizkid)", singers: "ZZang KARAOKE", duration: 267 })
  ], "Wizkid", "Essence"), null, "originally performed label");
  assert.equal(pickSaavnTrack([
    saavnSong({ title: "Levitating (lofi)", singers: "Covers Unplugged", duration: 201 })
  ], "Dua Lipa", "Levitating"), null, "cover/lofi label");
});

test("pickSaavnTrack: featured-artist trap needs the title too", () => {
  // "Mera Na" is Sidhu Moose Wala feat. Burna Boy — the real Burna track
  // "Last Last" is NOT on JioSaavn, so this must NOT be picked.
  assert.equal(pickSaavnTrack([
    saavnSong({ title: "Mera Na", singers: "Sidhu Moose Wala, Burna Boy", duration: 200 })
  ], "Burna Boy", "Last Last"), null, "artist matches but wrong song");
  // same artist, right title — passes
  const hit = pickSaavnTrack([
    saavnSong({ title: "Last Last", singers: "Burna Boy", duration: 148 })
  ], "Burna Boy", "Last Last");
  assert.ok(hit);
});

test("pickSaavnTrack: artistMap primary_artists are read", () => {
  const hit = pickSaavnTrack([
    saavnSong({ title: "Take Five", singers: "", duration: 319, artists: ["The Dave Brubeck Quartet"] })
  ], "Dave Brubeck", "Take Five");
  assert.ok(hit);
  assert.equal(hit.artist, "The Dave Brubeck Quartet");
});

test("pickSaavnTrack: duration and snippet guards", () => {
  assert.equal(pickSaavnTrack([
    saavnSong({ title: "So What", singers: "Miles Davis", duration: 45 })
  ], "Miles Davis", "So What"), null, "under 90s");
  assert.equal(pickSaavnTrack(null, "Queen", "x"), null);
});

test("decryptMediaUrl: round-trips the site's DES scheme", () => {
  // A real encrypted_media_url fetched live today (Queen — Bohemian Rhapsody).
  const enc = "ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyKwJLhwRZWP4Q9bj4N0hhhVykscCIFUWvdkK+UKTfTg1HDc+ZhPLU8hw7tS9a8Gtq";
  const url = decryptMediaUrl(enc);
  assert.ok(/^https:\/\/aac\.saavncdn\.com\//.test(url), "decrypts to a saavncdn url");
  assert.ok(url.includes("_96.mp4"), "the decrypted copy is the 96kbps one");
  // malformed/truncated ciphertext must never crash the ladder
  assert.equal(decryptMediaUrl("not-a-real-encrypted-string!!"), "");
  assert.equal(decryptMediaUrl(""), "");
});
