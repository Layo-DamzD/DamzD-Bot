// Spin up the dashboard with a fake bot object — verifies the badge HTML,
// the /status payload and the rendered page without touching WhatsApp.
// Also covers the multi-connect card with a fake session manager.
import { startHealthServer } from "/home/z/my-project/damzd/src/health.js";

const fake = {
  status: () => ({
    name: "DamzD",
    ownerName: "Layo",
    connected: false,
    pairingCode: "48291357",
    pairingCodeAgeSeconds: 4,
    pairingNumber: "2347087299884",
    number: null,
    qr: null,
    qrMode: false,
    resetting: false,
    uptimeSeconds: 187,
    bootedAt: Date.now() - 187000,
    commands: 200,
    accessMode: "self",
    aiBrain: true,
    paused: false,
    appVersion: "1.4.15",
    lib: "baileys 7.0.0-rc14",
    pairingLog: [{ at: Date.now() - 5000, event: "code 48291357 issued for +2347087299884" }]
  })
};

const fakeSessions = {
  maxSessions: 2,
  readStatuses: () => [
    { number: "2348012345678", connected: true, pairingCode: null, uptimeSeconds: 64, appVersion: "1.4.15", stale: false, starting: false },
    { number: "2349023456789", connected: false, pairingCode: "13572468", pairingNumber: "2349023456789", pairingCodeAgeSeconds: 6, uptimeSeconds: 3, appVersion: "1.4.15", stale: false, starting: false }
  ],
  connect: async number => ({ ok: true, number }),
  disconnect: async number => ({ ok: true, number })
};

startHealthServer(fake, 3111, fakeSessions);
console.log("test server up on 3111");

// Give the server a beat, then fetch / and /status and assert.
setTimeout(async () => {
  const html = await (await fetch("http://localhost:3111/")).text();
  const status = await (await fetch("http://localhost:3111/status")).json();
  const checks = {
    "badge element present": html.includes('id="deployBadge"'),
    "badge text element present": html.includes('id="deployText"'),
    "badge CSS present": html.includes(".deploy .dot"),
    "render JS updates badge": html.includes("running v"),
    "bootedAt in /status": typeof status.bootedAt === "number",
    "appVersion in /status": status.appVersion === "1.4.15",
    "sessions card present": html.includes('id="sessionsCard"'),
    "sessions connect endpoint button": html.includes('id="sessBtn"'),
    "sessions CSS present": html.includes(".sesscode"),
    "sessions in /status": Array.isArray(status.sessions) && status.sessions.length === 2,
    "sessionsMax in /status": status.sessionsMax === 2,
    "connect endpoint answers": (await (await fetch("http://localhost:3111/sessions/connect", { method: "POST", headers: { "content-type": "application/json" }, body: '{"number":"08011100000"}' })).json()).ok === true,
    "disconnect endpoint answers": (await (await fetch("http://localhost:3111/sessions/disconnect", { method: "POST", headers: { "content-type": "application/json" }, body: '{"number":"2348012345678"}' })).json()).ok === true,
    "connect without manager still serves": html.includes("connect another WhatsApp")
  };
  let ok = true;
  for (const [name, pass] of Object.entries(checks)) {
    console.log((pass ? "PASS" : "FAIL") + " — " + name);
    if (!pass) ok = false;
  }
  console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(ok ? 0 : 1);
}, 600);
