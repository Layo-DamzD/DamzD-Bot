# DamzD Bot — v2.0.1

A personal WhatsApp assistant on the **FEI-XMD engine** (the father repo's
codebase is the foundation — every runtime, command file and download engine
here is theirs, untouched) with the **DamzD skin and command list on top**.

## What is DamzD on top of the base

- **DamzD identity** — name, owner, menu layout, `✦ POWERED BY GREAT DAMZD`
  footers, no foreign pairing portal or newsletter anywhere.
- **The pairing dashboard** — the same website as the old deploy. `/` shows
  the live pairing code (Copy / New code ↻ / QR fallback / full reset),
  `/status` feeds it, `/health` is the uptime probe. Open the service URL on
  Render and pair from there; the terminal pairing flow still works too.
- **Ggs** (`.ggs`, alias `.gg`) — typing GGs with nothing quoted is just a
  good-game reply; with a view-once photo/video quoted, the recovery runs
  **silently**: the media lands in the owner's own chat, no trace in the
  original chat. **🔓 reactions** on any remembered view-once recover it the
  same way — no prefix needed.
- **`.vvinfo`** — replies with what the stash knows about a quoted view-once
  (captured bytes on disk or withheld content).
- **Capture-on-arrival** — every view-once the account receives is stashed
  and the bytes are saved within ~1.2s (before anyone opens it), 72h window,
  80MB budget, survives restarts.
- **`.onlineusers` / `.ghost` / `.top`** — persistent group activity with
  honest LID resolution; `onlineusers` and `ghost` also answer **without the
  dot**.
- **`.song` / `.play2`** ride the base's play2 engine (YouTube MP3);
  **`.yt` / `.ytmp4` / `.ytdl`** ride the all-in-one downloader, with
  **`.tiktok2`** as a second TikTok provider.
- **Menu = everything** — 16 sections, all 281 commands (the deployed
  v1.4.45 list merged with the FEI base, deduped). Nothing is hidden from
  `.menu`; the same list ships as `download/DamzD-Commands.txt`.
- **New in 2.1.0** — the full Channel (cfollow/cpost/creact/…), Privacy
  (pin/mute/archive/star/block/antiedit/…), Status presence (typing/
  recording/online/pres), sticker, ssweb, bible, couplepp, pp, shortenurl,
  word-chain lobby and AI-router sets, all registered on the same loader.

## The Baileys patch

`patches/@whiskeysockets+baileys+7.0.0-rc14.patch` (applied by patch-package
on `npm install`) stops the library from skipping `view_once_unavailable_fanout`
placeholder resends. Without it, WhatsApp never re-serves view-once media to
a linked device and view-once recovery cannot exist. View-once privacy is
still enforced at the source: the primary phone only re-serves **un-opened**
view-onces.

## Run

```bash
npm install       # installs deps and applies the Baileys patch
npm start         # node index.js
```

Pair on the dashboard (or type the number in the terminal). Copy `.env.example`
to `.env` and set at least `OWNER_NUMBER`; `PORT` is provided by the host
(default 3000).

## Deploy on Render

`render.yaml` is a Blueprint: Render Dashboard → New → Blueprint → pick the
repo. Set `OWNER_NAME`, `OWNER_NUMBER`, optionally `GROQ_API_KEY` and
`NABEES_API_KEY`; after the first deploy set `BOT_URL` to the service URL so
`.menu` and the connect card show your dashboard. The free plan's disk is
ephemeral — a redeploy re-pairs.

## Commands

Send `.menu` in chat. The dotless triggers `onlineusers` and `ghost` answer
without the prefix, and 🔓 reactions work anywhere a remembered view-once
lives.
