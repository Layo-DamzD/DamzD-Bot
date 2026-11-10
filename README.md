# DamzD 🌿

A personal WhatsApp assistant that **chats like a human** and runs clean commands.
No "powered by" footers. No "you can also connect" spam. No unicode boxes. Every reply is plain, natural text.

Built on Node.js + [Baileys](https://github.com/WhiskeySockets/Baileys) (the same proven library the big bots use), but redesigned so the conversation feels like a person, not a promo machine.

---

## How it behaves

| Situation | What DamzD does |
|---|---|
| You send a normal message in a DM | Replies naturally, like a person texting (remembers the conversation) |
| Someone @-mentions it in a group (or replies to it) | Joins the conversation naturally |
| Ordinary group chatter (no mention) | Stays quiet — never chats uninvited |
| You send a TikTok / YouTube / Instagram / Facebook / X link | Auto-fetches the video or audio, no command needed |
| `.command` | Runs one of the 43 commands below |
| Anything promotional | Never. That was the whole point. |

## The 43 commands

- **General** — `.menu` `.ping` `.about`
- **AI & Chat** — `.ai <question>` (or just talk to it)
- **Downloads** — `.aio` `.tiktok` `.insta` `.fb` `.twitter` `.yt` `.song` `.ytsearch`
- **Games** — `.8ball` `.coinflip` `.dice` `.choose` `.calc` `.trivia` `.riddle` `.poll` `.quote` `.joke` `.activity` `.rate` `.love`
- **Group** — `.kick` `.add` `.promote` `.demote` `.tagall` `.admins` `.groupinfo` `.close` `.open` `.welcome` `.goodbye` `.antilink` `.warn` `.warnlist` `.del`
- **Owner only** — `.mode` (self/public) `.forget` `.broadcast`

---

## How many API keys do you need?

**One.** A free Groq key powers the human-like chat.

1. Go to **https://console.groq.com/keys** → sign up free → create a key.
2. That's it. Everything else (downloads, games, group tools) uses key-free public services.
3. *Optional:* a second free key from https://openrouter.ai/keys works as an automatic backup brain if Groq is ever down. Not required.

## Setup (5 minutes)

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
#    then edit .env:
#      OWNER_NUMBER=2348012345678   ← your WhatsApp number, digits only
#      GROQ_API_KEY=gsk_...         ← your free key from step above

# 3. start
npm start
```

On first start the bot prints a **pairing code**. On the phone you're pairing to:
**WhatsApp → Linked devices → Link a device → Link with phone number instead** → type the code.
That phone number becomes the bot. It stays paired until you log it out.

> Tip: `npm test` runs the full behaviour test with a mocked WhatsApp — no phone needed.

## Settings (.env)

| Variable | Meaning |
|---|---|
| `OWNER_NUMBER` | your number — the bot's boss |
| `ACCESS_MODE` | `self` = only you can use it (default) · `public` = everyone can. You can also flip it anytime with `.mode public` |
| `GROQ_API_KEY` | the free AI brain |
| `OPENROUTER_API_KEY` | optional backup brain |
| `BOT_NAME` / `PREFIX` / `PORT` | cosmetic tweaks |

## Hosting on a free cloud

The bot includes a health endpoint (`/health` on `PORT`) so it works on hosts that require a web port.

- **Render / Koyeb / Railway** — create a service from your repo, set the env vars, use `npm start`. Note free tiers restart services sometimes; your session lives in the `auth/` folder, so attach a persistent disk if the host supports it, otherwise you just pair again (30 seconds).
- **Replit** — import the repo, add the env vars as Secrets, run `npm start`.
- **Your own PC** — `npm start`, always works, sleeps when the PC sleeps.

Whatever the host: **never commit `.env` or `auth/` to GitHub** (already blocked in `.gitignore`).

## Notes worth knowing

- Use a **separate/secondary WhatsApp number** for the bot — pairing your daily SIM means WhatsApp links it as a companion device (allowed, but keep it tidy).
- Downloads rely on public provider APIs; if one provider is down, the bot says so politely instead of spamming links.
- Group tools like kick/add require the bot to be a **group admin**.
- Everything the bot remembers lives in `data/memory.json` — `.forget` wipes it for the current chat.

## Project structure

```
index.js            entry point
src/
  config.js         env settings
  runtime.js        WhatsApp connection + the hybrid chat/command dispatcher
  ai.js             Groq/OpenRouter brain + the calm-assistant persona
  context.js        per-message context (reply, typing, admin checks…)
  loader.js         command discovery
  memory.js         per-chat conversation memory
  downloads.js      link resolvers
  store.js          group settings + warnings
  health.js         /health endpoint for cloud hosts
commands/           general · ai · downloads · fun · group · owner
test/smoke.js       14-check behaviour test (mocked WhatsApp)
```
