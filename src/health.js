import http from "node:http";

// Single-file dashboard: no external assets, no build step, no dependencies.
// "/" serves the page, "/status" feeds it live data, "/health" stays a plain
// JSON liveness probe for uptime pingers (UptimeRobot, cron-job.org...).
const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DamzD — dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(1200px 800px at 50% -10%, #10331f 0%, #0b141a 55%) fixed, #0b141a;
    color: #e9edef;
    display: flex; flex-direction: column; align-items: center;
    padding: 28px 16px 20px;
  }
  .wrap { width: 100%; max-width: 430px; display: flex; flex-direction: column; gap: 14px; }
  header { display: flex; align-items: center; gap: 12px; padding: 4px 2px; }
  .avatar {
    width: 46px; height: 46px; border-radius: 50%;
    background: linear-gradient(135deg, #25d366, #128c7e);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 700; color: #06231a; flex: none;
  }
  .title { flex: 1; min-width: 0; }
  .title h1 { font-size: 19px; font-weight: 700; letter-spacing: .2px; }
  .title p { font-size: 13px; color: #8696a0; margin-top: 2px; }
  .pill {
    flex: none; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 999px;
    background: #202c33; color: #8696a0; white-space: nowrap;
  }
  .pill.ok    { background: rgba(37,211,102,.14); color: #25d366; box-shadow: 0 0 14px rgba(37,211,102,.25); }
  .pill.warn  { background: rgba(245,166,35,.14); color: #f5a623; }
  .pill.err   { background: rgba(239,83,80,.14);  color: #ef5350; }
  .deploy {
    display: flex; align-items: center; gap: 8px; align-self: center;
    font-size: 12px; font-weight: 600; color: #8696a0; white-space: nowrap;
    background: rgba(32,44,51,.55); border: 1px solid #223038;
    border-radius: 999px; padding: 7px 14px; max-width: 100%; overflow: hidden;
  }
  .deploy .dot {
    width: 8px; height: 8px; border-radius: 50%; flex: none;
    background: #25d366; box-shadow: 0 0 8px rgba(37,211,102,.65);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: .35; } }
  .card {
    background: #111b21; border: 1px solid #223038; border-radius: 16px;
    padding: 20px; display: flex; flex-direction: column; gap: 14px;
  }
  .label { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #8696a0; }
  .code-row { display: flex; align-items: center; gap: 12px; }
  .btn-row { display: flex; gap: 10px; }
  .btn-row button {
    flex: 1; border: 0; border-radius: 10px; padding: 12px 14px;
    font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .btn-row button:active { transform: scale(.97); }
  #copyBtn { background: #25d366; color: #06231a; }
  #newBtn { background: #202c33; color: #8696a0; border: 1px solid #2a3942; }
  #newBtn:disabled { opacity: .5; cursor: wait; }
  .code {
    flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 34px; font-weight: 700; letter-spacing: 7px; color: #25d366;
    background: #0b141a; border: 1px dashed #2a3942; border-radius: 12px;
    padding: 14px 10px 14px 17px; text-align: center; user-select: all;
  }
  .expires { font-size: 12.5px; font-weight: 700; text-align: center; margin-top: -4px; }
  .expires.fresh { color: #25d366; }
  .expires.stale { color: #f5a623; }
  .expires.dead { color: #ef5350; }
  .log {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px; line-height: 1.7; color: #9db3ba;
    background: #0b141a; border: 1px solid #223038; border-radius: 10px;
    padding: 10px 12px; max-height: 148px; overflow: hidden;
  }
  .log .t { color: #4a5a63; margin-right: 8px; }
  .log div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #copyBtn {
    flex: none; border: 0; border-radius: 10px; padding: 12px 14px;
    background: #25d366; color: #06231a; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  #copyBtn:active { transform: scale(.96); }
  #newBtn:active { transform: scale(.96); }
  .steps { margin-left: 18px; display: flex; flex-direction: column; gap: 7px; color: #d1d7db; font-size: 14px; line-height: 1.45; }
  .hint { font-size: 12px; color: #8696a0; line-height: 1.5; }
  .divider { display: flex; align-items: center; gap: 10px; color: #66787f; font-size: 10px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #223038; }
  .qrbox { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .qrbox img { width: 188px; height: 188px; border-radius: 12px; background: #fff; padding: 6px; }
  .qrbox small { color: #8696a0; font-size: 12px; }
  .numrow { display: flex; gap: 10px; }
  .numrow input {
    flex: 1; min-width: 0; background: #0b141a; border: 1px solid #2a3942; border-radius: 10px;
    padding: 12px; color: #e9edef; font-size: 15px; letter-spacing: .5px;
  }
  .numrow input::placeholder { color: #4a5a63; }
  .numrow input:focus { outline: none; border-color: #25d366; }
  #reqBtn {
    flex: none; border: 1px solid #2a3942; border-radius: 10px; padding: 12px 16px;
    background: #202c33; color: #25d366; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  #reqBtn:disabled { opacity: .5; cursor: wait; }
  #reqBtn:active { transform: scale(.97); }
  .modebtn {
    border: 1px solid #2a3942; border-radius: 10px; padding: 12px 14px;
    background: #202c33; color: #25d366; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .modebtn:active { transform: scale(.97); }
  .qrbox.big img { width: 224px; height: 224px; }
  #resetBtn {
    border: 1px solid rgba(239,83,80,.45); border-radius: 10px; padding: 11px 14px;
    background: rgba(239,83,80,.08); color: #ef5350; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  #resetBtn:disabled { opacity: .5; cursor: wait; }
  #resetBtn:active { transform: scale(.97); }
  .center { align-items: center; gap: 12px; color: #8696a0; font-size: 14px; }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid #223038; border-top-color: #25d366;
    animation: spin 1s linear infinite; margin-top: 4px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hero {
    background: rgba(37,211,102,.1); border: 1px solid rgba(37,211,102,.35);
    border-radius: 14px; padding: 16px; text-align: center; font-size: 15px; color: #d1d7db;
  }
  .hero b { color: #25d366; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat {
    background: #111b21; border: 1px solid #223038; border-radius: 14px;
    padding: 14px; display: flex; flex-direction: column; gap: 4px;
  }
  .stat span { font-size: 19px; font-weight: 700; color: #e9edef; }
  .stat small { font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; color: #8696a0; }
  .sess {
    display: flex; align-items: center; gap: 10px;
    background: #0b141a; border: 1px solid #223038; border-radius: 12px;
    padding: 10px 12px; font-size: 13px;
  }
  .sess .num { font-weight: 700; color: #e9edef; }
  .sess .st { font-size: 11.5px; color: #8696a0; flex: 1; min-width: 100px; text-align: right; }
  .sess .st.ok { color: #25d366; }
  .sess .st.warn { color: #f5a623; }
  .sess .st.err { color: #ff5b5b; }
  .sesscode {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 26px; font-weight: 700; letter-spacing: 5px; color: #25d366;
    background: #0b141a; border: 1px dashed #2a3942; border-radius: 10px;
    padding: 9px 8px 9px 13px; text-align: center; user-select: all; width: 100%;
  }
  .sessbtn {
    border: 1px solid rgba(239,83,80,.45); border-radius: 8px; padding: 7px 10px;
    background: rgba(239,83,80,.08); color: #ef5350; font-weight: 700; font-size: 12px; cursor: pointer; flex: none;
  }
  .sessbtn:disabled { opacity: .5; cursor: wait; }
  .sesscopy {
    border: 1px solid #2a3942; border-radius: 8px; padding: 7px 10px;
    background: #202c33; color: #25d366; font-weight: 700; font-size: 12px; cursor: pointer; width: 100%;
  }
  footer { margin-top: 10px; font-size: 12px; color: #66787f; text-align: center; }
  @media (min-width: 480px) { .code { font-size: 40px; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="avatar">D</div>
    <div class="title">
      <h1 id="botName">DamzD</h1>
      <p id="subtitle">personal assistant</p>
    </div>
    <span class="pill" id="pill">connecting…</span>
  </header>

  <div class="deploy" id="deployBadge">
    <span class="dot"></span>
    <span id="deployText">reading build info…</span>
  </div>

  <section class="card" id="pairCard" hidden>
    <div id="codeView">
      <p class="label">Pairing code — for +<span id="pairNumber"></span></p>
      <div class="code-row">
        <span class="code" id="code">--------</span>
      </div>
      <p class="expires fresh" id="expires"></p>
      <div class="btn-row">
        <button id="copyBtn">Copy</button>
        <button id="newBtn">New code ↻</button>
      </div>
      <ol class="steps">
        <li>Open <b>WhatsApp</b> on the phone</li>
        <li>Settings → <b>Linked devices</b> → Link a device</li>
        <li>Tap <b>“Link with phone number instead”</b> and type the big code above</li>
      </ol>
      <p class="hint">Codes live about a minute — type the code on the phone within <b>30 seconds</b> of it appearing. <b>When the phone shows “Logging in…”, put it down and touch nothing on this page</b> — clicking here can cancel the login. If WhatsApp says “check if the code is correct”, the code died: tap <b>New code ↻</b> and type the new one. After 2–3 misses, rest 10 minutes (WhatsApp throttles rapid attempts).</p>
      <div class="divider">prefer to scan a QR?</div>
      <button id="qrModeBtn" class="modebtn">Switch to QR scan mode</button>
      <p class="hint">QR mode stops the background codes that would silently kill the QR. Scanning needs a <b>second screen</b> — a laptop, a friend's phone, a cybercafé PC showing this page — because a phone cannot scan a QR on its own screen.</p>
    </div>
    <div id="qrView" hidden>
      <p class="label">Scan to link — QR mode</p>
      <div class="qrbox big">
        <img id="qr" alt="Pairing QR" hidden>
        <small id="qrNote">waiting for a fresh QR…</small>
      </div>
      <p class="expires fresh" id="qrAge"></p>
      <ol class="steps">
        <li>Keep this page open on a <b>second screen</b> — laptop, friend's phone, cybercafé PC</li>
        <li>On your phone: WhatsApp → Settings → <b>Linked devices</b> → Link a device</li>
        <li>Point your phone's camera at the QR on the other screen</li>
      </ol>
      <p class="hint">The QR rotates about every 20 seconds — this page always shows the newest one. Nothing else touches the connection in QR mode, so the scan goes through clean.</p>
      <button id="codeModeBtn" class="modebtn">Back to pairing code</button>
    </div>
    <div class="divider">or pair a different number</div>
    <div class="numrow">
      <input id="pairInput" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="2347087299884">
      <button id="reqBtn">Get code</button>
    </div>
    <p class="hint">Type any number — international like 2347087299884 or local like 07087299884 — and a code is generated for exactly that phone.</p>
    <div class="divider">live pairing log</div>
    <div class="log" id="pairLog">waiting for the first code…</div>
    <button id="resetBtn">Start completely over ↻</button>
    <p class="hint">Everything stuck, or the phone keeps cancelling the login? This wipes the half-finished session and comes back with a fresh QR in about 15 seconds. Safe any time.</p>
  </section>

  <section class="card center" id="waitCard" hidden>
    <div class="spinner"></div>
    <p>Starting up — fetching a pairing code…</p>
  </section>

  <section class="card center" id="pausedCard" hidden>
    <div class="hero">⏸️ <b>Paused</b> — the bot is switched off in the code.</div>
    <p class="hint" id="pauseNote"></p>
    <p class="hint">Nothing is being read or sent. When the switch is flipped back, this page returns to the normal pairing screen.</p>
  </section>

  <section id="onlineCard" hidden style="display:flex; flex-direction:column; gap:10px;">
    <div class="hero">✅ Connected — linked to <b id="linkedNumber"></b></div>
    <div class="grid">
      <div class="stat"><span id="uptime">—</span><small>uptime</small></div>
      <div class="stat"><span id="commands">—</span><small>commands</small></div>
      <div class="stat"><span id="mode">—</span><small>access mode</small></div>
      <div class="stat"><span id="ai">—</span><small>AI brain</small></div>
    </div>
  </section>

  <section class="card" id="sessionsCard" hidden>
    <p class="label">other WhatsApps on this bot</p>
    <div id="sessionList" style="display:flex;flex-direction:column;gap:10px;"></div>
    <div class="divider">connect another WhatsApp</div>
    <div class="numrow">
      <input id="sessInput" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="2348012345678">
      <button id="sessBtn">Connect</button>
    </div>
    <p class="hint">Each connected WhatsApp becomes its own <b>private bot</b> on this server — commands answer only to that phone, and its chat is nobody else's business. The friend connects from <b>their own phone</b>: WhatsApp → Settings → Linked devices → Link with phone number, then types the code shown here. On free hosting about 2 extra phones fit alongside the main bot.</p>
  </section>

  <footer>DamzD • linked-device bot • no ads, no footers</footer>
</div>
<script>
  var state = null;
  function fmt(s) {
    var d = parseInt(s, 10) || 0;
    var h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), sec = d % 60;
    return (h ? h + "h " : "") + ((h || m) ? m + "m " : "") + sec + "s";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function updateExpiry() {
    if (!state || state.connected) return;
    var exp = document.getElementById("expires");
    var age = parseInt(state.pairingCodeAgeSeconds, 10);
    if (isNaN(age) || !state.pairingCode) {
      exp.className = "expires";
      exp.textContent = "asking WhatsApp for a code — it lands within about 30 seconds";
      return;
    }
    var left = 60 - age;
    if (age < 30) { exp.className = "expires fresh"; exp.textContent = "fresh — type it on the phone now · " + left + "s left"; }
    else if (age < 55) { exp.className = "expires stale"; exp.textContent = "getting old — hurry or tap New code · " + left + "s left"; }
    else { exp.className = "expires dead"; exp.textContent = "expired — tap New code ↻ and type the NEW code"; }
  }
  function updateQrAge() {
    var el = document.getElementById("qrAge");
    if (!el) return;
    if (!state || state.connected || !state.qrMode) { el.textContent = ""; return; }
    if (!state.qr) { el.className = "expires"; el.textContent = "the next QR lands within seconds…"; return; }
    var age = parseInt(state.qrAgeSeconds, 10);
    if (isNaN(age)) age = 0;
    if (age < 20) { el.className = "expires fresh"; el.textContent = "QR is fresh — scan it now (" + (20 - age) + "s)"; }
    else if (age < 40) { el.className = "expires stale"; el.textContent = "this QR is getting old — scan the newest one, it lands in seconds"; }
    else { el.className = "expires dead"; el.textContent = "waiting for the next QR…"; }
  }
  function updateLog() {
    var logEl = document.getElementById("pairLog");
    var entries = (state && state.pairingLog) || [];
    if (!entries.length) { logEl.textContent = "waiting for the first code…"; return; }
    logEl.innerHTML = entries.slice().reverse().map(function (e) {
      var t = new Date(e.at);
      var hh = ("0" + t.getHours()).slice(-2), mm = ("0" + t.getMinutes()).slice(-2), ss = ("0" + t.getSeconds()).slice(-2);
      return "<div><span class='t'>" + hh + ":" + mm + ":" + ss + "</span>" + escapeHtml(e.event) + "</div>";
    }).join("");
  }
  function render() {
    if (!state) return;
    document.getElementById("botName").textContent = state.name || "DamzD";
    document.getElementById("subtitle").textContent = (state.ownerName ? state.ownerName + "'s " : "") + "personal assistant";
    document.title = (state.name || "DamzD") + " — dashboard";
    var booted = state.bootedAt ? new Date(state.bootedAt) : null;
    var bt = booted ? ("0" + booted.getHours()).slice(-2) + ":" + ("0" + booted.getMinutes()).slice(-2) : "—";
    document.getElementById("deployText").textContent =
      "running v" + (state.appVersion || "?") + " · booted " + bt + " · up " + fmt(state.uptimeSeconds);
    renderSessions();
    var pill = document.getElementById("pill");
    var pair = document.getElementById("pairCard");
    var wait = document.getElementById("waitCard");
    var on = document.getElementById("onlineCard");
    var pausedCard = document.getElementById("pausedCard");
    if (state.paused) {
      pill.className = "pill err"; pill.textContent = "Paused";
      pair.hidden = true; wait.hidden = true; on.hidden = true; pausedCard.hidden = false;
      document.getElementById("pauseNote").textContent = state.pauseNote || "The bot is switched off for now.";
      return;
    }
    pausedCard.hidden = true;
    if (state.connected) {
      pill.className = "pill ok"; pill.textContent = "Online";
      pair.hidden = true; wait.hidden = true; on.hidden = false;
      document.getElementById("linkedNumber").textContent = state.number ? "+" + state.number : "";
      document.getElementById("uptime").textContent = fmt(state.uptimeSeconds);
      document.getElementById("commands").textContent = state.commands;
      document.getElementById("mode").textContent = state.accessMode;
      document.getElementById("ai").textContent = state.aiBrain ? "Groq ready" : "keyless fallback";
    } else {
      pill.className = "pill warn"; pill.textContent = "Waiting for pairing";
      on.hidden = true; wait.hidden = true; pair.hidden = false;
      var qrMode = !!state.qrMode;
      document.getElementById("codeView").hidden = qrMode;
      document.getElementById("qrView").hidden = !qrMode;
      if (!qrMode) {
        document.getElementById("code").textContent = state.pairingCode || "--------";
        document.getElementById("pairNumber").textContent = state.pairingNumber || "";
      }
      updateExpiry();
      updateQrAge();
      updateLog();
      var qrImg = document.getElementById("qr");
      var qrNote = document.getElementById("qrNote");
      if (state.qr) { qrImg.src = state.qr; qrImg.hidden = false; qrNote.hidden = true; }
      else { qrImg.hidden = true; qrNote.hidden = false; }
      var input = document.getElementById("pairInput");
      if (!input.value && state.pairingNumber) input.placeholder = state.pairingNumber;
    }
  }
  function renderSessions() {
    var card = document.getElementById("sessionsCard");
    var sessions = (state && state.sessions) || null;
    if (!sessions) { card.hidden = true; return; }
    card.hidden = false;
    var full = state.sessionsMax > 0 && sessions.length >= state.sessionsMax;
    document.getElementById("sessInput").disabled = full;
    var btn = document.getElementById("sessBtn");
    btn.disabled = full;
    if (btn.dataset.resting !== "1") btn.textContent = full ? "All slots used" : "Connect";
    var list = document.getElementById("sessionList");
    if (!sessions.length) {
      list.innerHTML = "<p class='hint' style='margin:0'>Nobody else is connected yet — type a number below to give that phone its own private bot on this server.</p>";
      return;
    }
    list.innerHTML = sessions.map(function (s) {
      var num = escapeHtml("+" + (s.number || ""));
      // The card is read-only: ban and disconnect both live in chat
      // (.ban / .unban / .disconnect from the owner's WhatsApp).
      if (s.banned) {
        return "<div class='sess'><span class='num'>" + num + "</span><span class='st err'>🚫 banned — their bot is off and will not start (unban with .unban " + num.slice(1) + " in chat)</span></div>";
      }
      if (s.connected) {
        return "<div class='sess'><span class='num'>" + num + "</span><span class='st ok'>✅ linked · up " + fmt(s.uptimeSeconds) + (s.appVersion ? " · v" + escapeHtml(s.appVersion) : "") + "</span></div>";
      }
      if (s.pairingCode && !s.stale) {
        var age = parseInt(s.pairingCodeAgeSeconds, 10);
        var left = isNaN(age) ? 60 : Math.max(0, 60 - age);
        return "<div class='sess'><span class='num'>" + num + "</span><span class='st warn'>waiting for that phone · code dies in " + left + "s</span></div>" +
          "<div class='sesscode'>" + escapeHtml(s.pairingCode) + "</div>" +
          "<button class='sesscopy' data-copy='" + escapeHtml(s.pairingCode) + "'>Copy code for " + num + "</button>";
      }
      return "<div class='sess'><span class='num'>" + num + "</span><span class='st " + (s.stale ? "warn" : "") + "'>" + (s.stale ? "restarting…" : "starting up — the pairing code lands in a few seconds…") + "</span></div>";
    }).join("");
  }
  async function tick() {
    try {
      var r = await fetch("/status", { cache: "no-store" });
      state = await r.json();
      render();
    } catch (e) {
      var pill = document.getElementById("pill");
      pill.className = "pill err"; pill.textContent = "Unreachable";
    }
  }
  setInterval(tick, 3000);
  setInterval(updateExpiry, 1000);
  tick();
  document.getElementById("copyBtn").addEventListener("click", function () {
    var code = document.getElementById("code").textContent.trim();
    var btn = document.getElementById("copyBtn");
    var done = function () { btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).then(done, done); } else { done(); }
  });
  document.getElementById("newBtn").addEventListener("click", async function () {
    var btn = document.getElementById("newBtn");
    btn.disabled = true; btn.textContent = "Getting…";
    try {
      var r = await fetch("/pairing/refresh", { method: "POST" });
      var j = await r.json();
      if (j && j.ok && j.code) { state.pairingCode = j.code; state.pairingCodeAgeSeconds = 0; document.getElementById("code").textContent = j.code; }
      else if (j && j.pending) { btn.textContent = "wait…"; }
      else if (j && j.error) { btn.textContent = j.error.slice(0, 18); setTimeout(function () { btn.textContent = "New code ↻"; }, 2500); return; }
    } catch (e) { /* the next poll will resync */ }
    btn.disabled = false; btn.textContent = "New code ↻";
  });
  document.getElementById("reqBtn").addEventListener("click", async function () {
    var btn = document.getElementById("reqBtn");
    var input = document.getElementById("pairInput");
    var digits = input.value.replace(/\D/g, "");
    if (!digits) { btn.textContent = "Type a number"; setTimeout(function () { btn.textContent = "Get code"; }, 2000); return; }
    btn.disabled = true; btn.textContent = "Asking…";
    try {
      var r = await fetch("/pairing/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number: digits })
      });
      var j = await r.json();
      if (j && j.ok && j.code) {
        state.pairingCode = j.code;
        state.pairingNumber = j.number;
        state.pairingCodeAgeSeconds = 0;
        document.getElementById("code").textContent = j.code;
        document.getElementById("pairNumber").textContent = j.number;
        btn.textContent = "Done ✓";
      } else if (j && j.pending) {
        // The socket was recycling — the runtime re-issues the code on the
        // fresh socket by itself; the 3s poll will show it here shortly.
        btn.textContent = "wait…";
      } else {
        btn.textContent = (j && j.error ? j.error : "failed").slice(0, 20);
      }
    } catch (e) { btn.textContent = "failed — retry"; }
    setTimeout(function () { btn.disabled = false; btn.textContent = "Get code"; }, 4500);
  });
  document.getElementById("qrModeBtn").addEventListener("click", async function () {
    var btn = document.getElementById("qrModeBtn");
    btn.disabled = true;
    try {
      await fetch("/pairing/qr-mode", { method: "POST", headers: { "content-type": "application/json" }, body: '{"on":true}' });
    } catch (e) { /* the next poll will resync */ }
    btn.disabled = false;
    if (state) state.qrMode = true;
    render();
  });
  document.getElementById("codeModeBtn").addEventListener("click", async function () {
    var btn = document.getElementById("codeModeBtn");
    btn.disabled = true;
    try {
      await fetch("/pairing/qr-mode", { method: "POST", headers: { "content-type": "application/json" }, body: '{"on":false}' });
    } catch (e) { /* the next poll will resync */ }
    btn.disabled = false;
    if (state) state.qrMode = false;
    render();
  });
  document.getElementById("resetBtn").addEventListener("click", async function () {
    var btn = document.getElementById("resetBtn");
    if (!confirm("Wipe the half-finished session and start completely over? A fresh QR appears in about 15 seconds.")) return;
    btn.disabled = true; btn.textContent = "Resetting…";
    try { await fetch("/pairing/reset", { method: "POST" }); } catch (e) { /* the next poll will resync */ }
    if (state) { state.pairingCode = null; state.qr = null; }
    setTimeout(function () { btn.disabled = false; btn.textContent = "Start completely over ↻"; }, 12000);
  });
  document.getElementById("sessBtn").addEventListener("click", async function () {
    var btn = document.getElementById("sessBtn");
    var input = document.getElementById("sessInput");
    var digits = input.value.replace(/\D/g, "");
    if (!digits) { btn.textContent = "Type a number"; setTimeout(function () { btn.textContent = "Connect"; }, 2000); return; }
    btn.disabled = true; btn.dataset.resting = "1"; btn.textContent = "Starting…";
    try {
      var r = await fetch("/sessions/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number: digits })
      });
      var j = await r.json();
      if (j && j.ok) { input.value = ""; btn.textContent = "Starting ✓ — code below soon"; }
      else { btn.textContent = (j && j.error ? j.error : "failed").slice(0, 26); }
    } catch (e) { btn.textContent = "failed — retry"; }
    setTimeout(function () {
      btn.disabled = false; btn.dataset.resting = ""; btn.textContent = "Connect";
    }, 4000);
  });
  document.getElementById("sessionList").addEventListener("click", async function (ev) {
    var t = ev.target;
    if (!t.dataset) return;
    if (t.dataset.copy) {
      var code = t.dataset.copy;
      var done = function () { t.textContent = "Copied ✓"; setTimeout(function () { t.textContent = "Copy code"; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).then(done, done); } else { done(); }
      return;
    }
  });
</script>
</body>
</html>
`;

export function startHealthServer(bot, port, sessions = null) {
  const server = http.createServer(async (request, response) => {
    const url = (request.url || "/").split("?")[0];
    if (url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, ...bot.status() }));
      return;
    }
    if (url === "/status") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      const payload = bot.status();
      if (sessions) {
        payload.sessions = sessions.readStatuses();
        payload.sessionsMax = sessions.maxSessions;
      }
      response.end(JSON.stringify(payload));
      return;
    }
    if (url === "/sessions/connect" && request.method === "POST" && sessions) {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2000) { request.destroy(); return; }
      }
      let number = "";
      try { number = String(JSON.parse(body).number || ""); } catch { number = ""; }
      const result = await sessions.connect(number);
      response.writeHead(result.ok ? 200 : 400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (url === "/pairing/request" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2000) { request.destroy(); return; }
      }
      let number = "";
      try { number = String(JSON.parse(body).number || ""); } catch { number = ""; }
      const result = await bot.requestPairingForNumber(number);
      response.writeHead(result.ok ? 200 : 400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (url === "/pairing/refresh" && request.method === "POST") {
      const result = await bot.refreshPairingCode();
      response.writeHead(result.ok ? 200 : 409, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (url === "/pairing/qr-mode" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 500) { request.destroy(); return; }
      }
      let on = false;
      try { on = !!JSON.parse(body).on; } catch { on = false; }
      const result = bot.setQrMode(on);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (url === "/pairing/reset" && request.method === "POST") {
      const result = await bot.fullReset();
      response.writeHead(result.ok ? 200 : 409, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (url === "/" || url === "/dashboard" || url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(dashboardHtml);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  server.listen(port, () => {
    console.log("[health] dashboard listening on port " + port + " — open it to pair and watch status");
  });
  return server;
}
