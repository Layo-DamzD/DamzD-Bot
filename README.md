# DamzD 🤖

A personal WhatsApp assistant that chats like a human and runs a full command toolkit — **with zero promotional footers**. No "powered by", no ads, no pairing links pasted under every reply. Just help.

Built on Node.js + [Baileys](https://github.com/WhiskeySockets/Baileys) (linked-device connection, exactly like the big bot panels use).

## Why DamzD exists

Most free WhatsApp bots staple an advertisement onto every single message. DamzD was built to do the opposite:

- 🗣 **Chats like a real person** — natural language, short replies, memory of the conversation, calm manners.
- 🚫 **Never advertises** — the whole reply pipeline is covered by a smoke test that fails if any promo text sneaks in.
- 🧰 **Full toolkit** — 200 commands across 13 sections: downloads, AI, news, games, group management, stickers, privacy tools and more — every fake-screenshot generator removed.
- 🔒 **Private by default** — self mode: only you (the owner) can use it. Flip to public with one command if you want.

## Requirements

- Node.js **20.9+**
- `ffmpeg` on the host (optional — needed for stickers and GIF reactions)

## 5-minute setup

```bash
git clone https://github.com/Layo-DamzD/DamzD-Bot.git
cd DamzD-Bot
npm install

# configure
cp .env.example .env
nano .env          # set OWNER_NUMBER (international format, no +) — optional

# run
npm start
```

On first start the bot prints an **8-character pairing code**:

```
┌─────────────────────────────┐
│  Pair this code in WhatsApp │
│        48219037             │
│  WhatsApp → Linked devices  │
│  → Link with phone number   │
└─────────────────────────────┘
```

On your phone: **WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead"** and type the code **within ~30 seconds of it appearing** — pairing codes expire after about a minute, and every new code kills the previous one. DamzD therefore issues a **fresh random 8-digit code for every request** (the same format WhatsApp itself uses) and shows its age on the dashboard, so a dead code is always visible instead of looking identical forever. If WhatsApp says "check if the code is correct", the code simply died: tap **New code ↻** on the dashboard and type the new one. **When the phone shows "Logging in…", leave both the phone and the dashboard untouched until it finishes** — requesting another code during that window cancels the registration.

> **Why a patched Baileys?** In late July 2026 WhatsApp changed its pairing protocol (`companion_reg_refresh`) and stock Baileys pairing codes started getting rejected with "check if the code is correct". DamzD runs a patched fork (`doryani-ai/Baileys#fix/companion-reg-refresh`) that handles the new protocol. WhatsApp also throttles rapid pairing attempts — after 2–3 misses, rest about 10 minutes before trying again.

> **Notes**
> - Pairing links DamzD to your WhatsApp as a *linked device* — the same way WhatsApp Web works. You stay in control and can unlink anytime from Settings → Linked devices.
> - WhatsApp allows a limited number of linked devices per account; free a slot if linking fails.
> - If you left `OWNER_NUMBER` empty, the number that pairs first becomes the owner automatically.
> - The pairing session is stored in `auth/` — **never commit or share that folder**. Anyone with it controls your WhatsApp.

## AI brain (all free)

| Layer | Key needed | Notes |
|---|---|---|
| Groq (llama-3.3-70b) | `GROQ_API_KEY` — free at [console.groq.com](https://console.groq.com) | fast, smart, recommended |
| OpenRouter (backup) | `OPENROUTER_API_KEY` — free tier | used if Groq fails |
| Pollinations (keyless) | none | always-on fallback, so the bot chats even with zero keys |
| NABEES AI (GPT-5 Luna / DeepSeek) | `NABEES_API_KEY` — free | last-resort brain; same key powers video downloads |

Voice notes are transcribed with Groq Whisper (`.vn2text`) — needs `GROQ_API_KEY`.

## Optional keys

`.song` works out of the box. `NABEES_API_KEY` (free — sign up at [apis.nabeestech.com](https://apis.nabeestech.com), or use the public free key `nabeestech`, ~100 requests/day) adds: real YouTube copies of songs the music library only has covers of, YouTube/TikTok/Instagram **video** downloads, and the backup AI models. `PUTER_AUTH_TOKEN` (free token from your Puter account) unlocks the **real flagship brains** — `.claude` becomes actual Claude Sonnet, `.chatgpt` actual GPT, `.gemini` actual Gemini — with automatic fallback to the built-in chain when it's absent. `.removebg` optionally takes `PHOTOROOM_API_KEY`. Without any keys every other command still works — the bot says so plainly instead of failing silently.

## What DamzD can do

`.menu` shows live sections; `.menu news` opens a section. `.help` (or `.commands`) prints **every command with what it does**; `.help song` explains one command. Highlights:

- **🤖 General** — menu, ping, alive, owner card (.vcf), time/date, jid, version
- **💬 AI & Chat** — `.ai` plus **real per-model brains**: `.chatgpt` (real GPT via Puter key, else open GPT-OSS), `.llama` (real Llama 3.3 70B on Groq), `.luna` (GPT-5 Luna) and `.deepseek` (DeepSeek V4 Flash) via the NABEES studio, `.claude` (real Claude Sonnet via Puter key) and `.gemini` (real Gemini via Puter key) — plus styled companions `.grok`, `.qwen`, `.fable5`, `.wormgpt`, `.mathgpt`, `.aidetect`, `.translate`. Real brains are labelled real; styles are labelled styles — never passed off as models they are not
- **🎨 AI Media** — `.flux` image generation, `.tts` voice notes, `.vn2text` transcription, `.ssweb` screenshots
- **📰 News** — BBC, CNN, Al Jazeera, Guardian, Punch Nigeria and 9 more desks
- **📥 Downloads** — `.song`/`.play` send **full songs** (real-artist verification: the engine identifies the official recording via Apple's catalogue, pulls the verified track from JioSaavn at up to 320kbps and never passes a cover or karaoke version off as the song; for tracks JioSaavn's catalogue lacks — most Afrobeats included — she finds the official video and converts it to full MP3 via a keyless route that works from datacenter hosts, with the optional NABEES key below as an extra fallback, and the official 30-second preview only as the honest last resort), TikTok, Instagram, Facebook, X/Twitter, YouTube (video + audio via the optional key below), Spotify previews, `.ytsearch`
- **👥 Groups** — in self mode the owner just talks and she answers (no @ needed); she also answers @-mentions, and every command works in groups — the ⚡ reaction confirms she received it
- **🎮 Games** — trivia, riddles, 8ball, dice, polls, calculator, multiplayer Word Chain (`.wcg`)
- **🎉 Fun** — jokes (dad, Chuck Norris, programming), facts, animals, quotes, history
- **👥 Group** — kick/add/promote, tagall, welcome/goodbye, antilink with 3-strike warnings, `.tldr`, `.lore`, `.roast`, `.top`, `.ghost`, invite links. **Group stats are honest**: member numbers are resolved to real phone numbers (never WhatsApp privacy-LID digits), activity is tracked on disk so restarts don't wipe it, `.ghost` tells you exactly how long it has been watching and refuses to judge before it has enough chat history, and the bot itself never appears in its own lists
- **🛠 Tools** — `.sticker`, `.vv` **silent** view-once recovery (media lands in your own "Message yourself" chat — no reply, no reaction, no trace in the original chat), `.save`, TikTok stalk, lyrics, Bible, wiki, NASA, Pokémon, URL shortener
- **🔒 Privacy** — anti-delete/anti-edit alerts, pin/archive/mute/star chats, disappearing messages, block/unblock, message edit/unsend/forward
- **📱 Status** — post statuses (text/media/mentions), auto-view + auto-react statuses, typing/recording presence
- **📢 Channel** — follow/unfollow channels, react to posts, post to your own channel
- **👑 Owner** — mode, ban/unban, broadcast, setprefix, anticall, autoreact, restart, settings, `.pause`/`.resume` (go completely silent and back, right from WhatsApp)

**Remote kill switch:** `src/flags.js` holds a `HARD_PAUSED` switch — flip it in the repo and the deploy silences the bot entirely (dashboard keeps running and explains why) even with no access to the Render dashboard.

## Running on your phone (Termux)

Works. npm 12+ refuses git dependencies by default (EALLOWGIT) — the repo ships an `.npmrc` with `allow-git=root`, so a plain `npm install` succeeds. Keys live in a `.env` file next to the code (dotenv loads it automatically). There is no native-canvas dependency anymore, so nothing degrades on Android — every command runs exactly as on Render.

## Dashboard

Open your bot's URL (locally `http://localhost:3000`, on Render `https://<your-app>.onrender.com`) and you get a live status page:

- **Waiting for pairing** — shows the current pairing code in big type with a **freshness countdown** (fresh → getting old → expired), a copy button, the exact linking steps and a **live pairing log** of everything WhatsApp answers. The page polls live, so a refreshed code appears automatically — no more digging through logs.
- **Three ways to link** — type the rotating code on the phone while the countdown is green, scan the on-page QR, or type ANY phone number in the box and get a code generated for exactly that phone — handy when pairing a secondary number.
- **QR scan mode** — the *Switch to QR scan mode* button pauses every background pairing-code request (each request silently invalidates the QR on screen), shows a big QR with a live freshness line, and walks you through the one rule that matters: the QR must be displayed on a **second screen** (laptop, friend's phone, cybercafé PC) because a phone cannot scan a QR shown on itself.
- **Start completely over ↻** — wipes a half-registered session left behind by cancelled logins, clears the repeated-rejection lockdown, and comes back with a genuinely fresh QR in ~15 seconds. No server restart needed.
- **Online** — green status pill, linked number, uptime, command count, access mode and AI-brain state.

Endpoints: `/` dashboard · `/status` live JSON feeding it · `/health` liveness JSON for uptime pingers.

## Deploying on Render (free tier works)

DamzD ships with a `render.yaml` blueprint and exposes `GET /health` (port `PORT`, default 3000).

1. Push this repo to GitHub. On [render.com](https://render.com): **New → Web Service → Build and deploy from a Git repository** and pick the repo. Render reads `render.yaml` automatically — otherwise set: runtime **Node**, build `npm install`, start `npm start`.
2. Fill in the environment variables when prompted: `OWNER_NUMBER` (e.g. `2348000000000`), `OWNER_NAME`, `GROQ_API_KEY`. `ACCESS_MODE` ships as `public` in `render.yaml` — set it to `self` in the dashboard if you want the bot to answer you only. You can also flip live anytime with the `.public` / `.private` owner commands.
3. First boot: open **your app URL** (or the Logs tab) — the pairing code shows on the dashboard and refreshes itself until used. On your phone: **WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead"**, type the code.
4. **Keep it awake** — free Render services sleep after ~15 minutes without HTTP traffic. Create a free monitor at [uptimerobot.com](https://uptimerobot.com) or cron-job.org hitting `https://<your-app>.onrender.com/health` every 5–10 minutes and DamzD stays online 24/7.
5. **Free-tier caveat** — the disk is wiped on every restart/redeploy, so `auth/` is lost and you re-pair (new code appears in the logs). A paid instance with a persistent disk keeps the session forever.
6. **Never** commit or share your `auth/` folder — anyone holding it controls your WhatsApp.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `BOT_NAME` | DamzD | how the bot introduces itself |
| `OWNER_NAME` | DamzD | the bot calls you this |
| `OWNER_NUMBER` | *(empty)* | international format, no `+`; empty = first paired number owns the bot |
| `ACCESS_MODE` | self | `self` = owner only, `public` = everyone (render.yaml ships `public`; flip live with `.public` / `.private`) |
| `PREFIX` | `.` | command prefix (`.setprefix` also works live) |
| `AUTO_DL` | true | auto-fetch media when a social link is sent |
| `GROQ_API_KEY` | *(empty)* | free AI key, recommended |
| `OPENROUTER_API_KEY` | *(empty)* | optional backup |
| `PHOTOROOM_API_KEY` | *(empty)* | enables `.removebg` |

## Development

```bash
npm run check   # syntax-check every file
npm test        # 20 behaviour checks with a mocked WhatsApp socket
```

The test suite asserts, among other things, that **no reply ever contains promotional content**.

## Safety & fair play

- Automating your WhatsApp account with unofficial libraries (this includes every "XMD"-style bot) technically violates WhatsApp's Terms of Service and can get an account banned. Use a number you can afford to lose, keep the bot in self mode, and avoid spammy behaviour.
- Keep `.env` and `auth/` private. If you ever paste a token or password somewhere public, rotate it immediately.
