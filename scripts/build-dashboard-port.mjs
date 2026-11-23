#!/usr/bin/env node
// Builds damzd/src/dashboard.js: the old DamzD dashboard HTML is extracted
// VERBATIM from the v1.4.45 blob (proven front-end, zero transcription
// risk), and the new FEI-runtime glue is appended below it.
import { execSync } from "node:child_process";
import fs from "node:fs";

const OLD = execSync("git show 5fe22fc:damzd/src/health.js", { encoding: "utf8", cwd: "/home/z/my-project" });
const start = OLD.indexOf("const dashboardHtml = `");
const end = OLD.indexOf("export function startHealthServer");
if (start < 0 || end < 0) throw new Error("dashboardHtml block not found in the old blob");
const htmlBlock = OLD.slice(start, end); // includes the trailing newline before export

const glue = `import http from "node:http";
import fs from "node:fs";
import QRCode from "qrcode";

// The DamzD pairing dashboard on the FEI runtime — same website as the old
// deploy: "/" serves the page, "/status" feeds it live data, "/health" is a
// plain JSON liveness probe for uptime pingers. Pairing goes through the
// runtime's requestPairingCode; the latest QR is captured from the runtime's
// "qr" event for the scan-to-link fallback.
export function startDashboardServer({ runtime, config, commandCount, sessionDirectory, port }) {
  const bootedAt = new Date().toISOString();
  let pairingCode = null;
  let pairingNumber = null;
  let pairingCodeAt = null;
  let qrString = null;
  let qrDataUrl = null;
  let qrAt = null;
  let qrMode = false;
  let lastManualPairingAt = 0;
  const pairingLog = [];

  function logPairing(event) {
    pairingLog.push({ at: new Date().toISOString(), event: String(event).slice(0, 140) });
    if (pairingLog.length > 12) pairingLog.shift();
  }

  // WhatsApp issues a fresh QR every ~20s while unregistered — keep the
  // latest one for the dashboard's scan-to-link fallback.
  runtime.on("qr", qr => {
    qrString = String(qr);
    qrAt = Date.now();
    QRCode.toDataURL(qrString, { margin: 2, width: 320 })
      .then(url => { if (qrString === String(qr)) qrDataUrl = url; })
      .catch(() => { /* the next QR retries */ });
  });

  function normalizePairingNumber(raw) {
    const digits = String(raw || "").replace(/\\D/g, "");
    if (digits.length >= 10 && digits.length <= 11 && digits.startsWith("0")) {
      return "234" + digits.slice(1); // local Nigerian format → international
    }
    return digits;
  }

  async function issueCode(phoneNumber) {
    const result = await runtime.requestPairingCode(phoneNumber);
    pairingCode = String(result.code || "");
    pairingNumber = String(result.phoneNumber || phoneNumber);
    pairingCodeAt = Date.now();
    return pairingCode;
  }

  const api = {
    status() {
      const s = runtime.getStatus();
      const pairing = !s.connected && pairingCodeAt && Date.now() - pairingCodeAt <= 90000;
      return {
        name: config.name,
        ownerName: config.ownerName,
        appVersion: config.version,
        bootedAt,
        uptimeSeconds: Math.floor(process.uptime()),
        paused: false,
        pauseNote: "",
        connected: Boolean(s.connected),
        number: s.phoneNumber || "",
        pairingCode: pairing ? pairingCode : null,
        pairingNumber: pairing ? pairingNumber : null,
        pairingCodeAgeSeconds: pairingCodeAt ? Math.floor((Date.now() - pairingCodeAt) / 1000) : null,
        pairingLog: pairingLog.slice(),
        qrMode,
        qr: (!s.connected && qrMode && qrDataUrl && qrAt && Date.now() - qrAt <= 65000) ? qrDataUrl : null,
        qrAgeSeconds: qrAt ? Math.floor((Date.now() - qrAt) / 1000) : null,
        commands: commandCount,
        accessMode: String(config.defaultMode || "public").toUpperCase(),
        aiBrain: Boolean(process.env.GROQ_API_KEY)
      };
    },

    // Dashboard number box: generate a pairing code for ANY phone the owner
    // types. A pairing code is useless to a stranger without physical access
    // to that phone, so no auth is needed here.
    async requestPairingForNumber(number) {
      const raw = String(number || "").replace(/\\D/g, "");
      if (runtime.getStatus().connected) return { ok: false, error: "already connected — no pairing needed" };
      const digits = normalizePairingNumber(raw);
      if (digits.length < 8 || digits.length > 15) {
        return { ok: false, error: "type the full number, e.g. 2347087299884 (or local 07087299884)" };
      }
      if (digits !== raw) logPairing("local number " + raw + " read as +" + digits);
      const now = Date.now();
      if (now - lastManualPairingAt < 5000) return { ok: false, error: "one moment — try again in a few seconds" };
      lastManualPairingAt = now;
      // Same number and the current code is still young? Hand it back instead
      // of requesting again — an extra request could interrupt a login.
      if (digits === pairingNumber && pairingCode && Date.now() - (pairingCodeAt || 0) < 45000) {
        return { ok: true, code: pairingCode, number: digits };
      }
      pairingNumber = digits;
      logPairing("dashboard asked for a code for +" + digits);
      try {
        const code = await issueCode(digits);
        return { ok: true, code, number: digits };
      } catch (error) {
        logPairing("code request refused: " + String(error?.message || error).slice(0, 90));
        return { ok: false, error: String(error?.message || "the request failed — try again in a few seconds").slice(0, 140) };
      }
    },

    // The dashboard's "New code" button: forces a fresh code on the live
    // pairing socket instead of waiting for the next cycle.
    async refreshPairingCode() {
      if (runtime.getStatus().connected) return { ok: false, error: "already connected — no pairing needed" };
      const phoneNumber = pairingNumber || String(config.ownerNumber || "").replace(/\\D/g, "");
      if (!phoneNumber) return { ok: false, error: "no number yet — type one in the number box" };
      if (pairingCode && Date.now() - (pairingCodeAt || 0) < 45000) {
        return { ok: true, code: pairingCode };
      }
      try {
        const code = await issueCode(phoneNumber);
        logPairing("fresh code issued for +" + phoneNumber);
        return { ok: true, code };
      } catch (error) {
        logPairing("refresh refused: " + String(error?.message || error).slice(0, 90));
        return { ok: false, error: String(error?.message || "try again in a few seconds").slice(0, 140) };
      }
    },

    // Switch the page to the QR fallback. The FEI runtime never requests
    // codes in the background, so the QR stays valid on its own — the toggle
    // just controls what the page displays.
    setQrMode(on) {
      qrMode = !!on;
      logPairing(qrMode ? "QR scan mode on — the QR stays on screen" : "back to code mode — use New code ↻");
      return { ok: true, qrMode };
    },

    // Everything stuck, or the phone keeps cancelling the login? Wipe the
    // half-finished session and come back fresh. Safe any time.
    async fullReset() {
      try {
        logPairing("full reset — wiping the half-finished session");
        await runtime.stop();
        try { fs.rmSync(sessionDirectory, { recursive: true, force: true }); } catch { /* nothing to wipe */ }
        await runtime.start();
        logPairing("session wiped — a fresh pairing cycle starts now");
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || "reset failed").slice(0, 140) };
      }
    }
  };

  const server = http.createServer(async (request, response) => {
    const url = (request.url || "/").split("?")[0];
    if (url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, ...api.status() }));
      return;
    }
    if (url === "/status") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(api.status()));
      return;
    }
    if (url === "/sessions/connect" && request.method === "POST") {
      response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: false, error: "this build runs one WhatsApp — the main pairing box above is the way" }));
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
      const result = await api.requestPairingForNumber(number);
      response.writeHead(result.ok ? 200 : 400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (url === "/pairing/refresh" && request.method === "POST") {
      const result = await api.refreshPairingCode();
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
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(api.setQrMode(on)));
      return;
    }
    if (url === "/pairing/reset" && request.method === "POST") {
      const result = await api.fullReset();
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
    console.log("[dashboard] listening on port " + port + " — open it to pair and watch status");
  });
  return server;
}
`;

fs.writeFileSync("/home/z/my-project/damzd/src/dashboard.js", "// DamzD dashboard — the pairing website, ported from DamzD v1.4.45 onto the FEI runtime.\n" + htmlBlock + glue);
console.log("dashboard written:", fs.statSync("/home/z/my-project/damzd/src/dashboard.js").size, "bytes");
