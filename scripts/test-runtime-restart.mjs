// Regression test: the runtime must survive stop() → start() cycles.
//
// Bug (found live on Render, 2026-11-23): stop() left the cached resolved
// startPromise in place, so the dashboard's "full reset" (stop → wipe →
// start) never reconnected. socket stayed null and every pairing-code
// request was refused with "The WhatsApp socket is not ready."
//
// Pass criteria:
//   1. a fresh socketCreated event fires for every start()
//   2. after stop() → start(), requestPairingCode() does NOT dead-end
//      with the old "socket is not ready" refusal
import { createWhatsAppRuntime } from "../damzd/lib/whatsapp-runtime.js";
import fs from "node:fs";

const sessionDir = "/tmp/damzd-restart-test-session";
fs.rmSync(sessionDir, { recursive: true, force: true });

const runtime = createWhatsAppRuntime({
  config: { sessionDirectory: sessionDir, logLevel: "error" },
  sessionDirectory: sessionDir,
  commands: []
});

let socketsCreated = 0;
runtime.on("socketCreated", () => { socketsCreated += 1; });

const fail = message => { console.error("FAIL:", message); process.exit(1); };

await runtime.start();
if (socketsCreated !== 1) fail(`first start created ${socketsCreated} socket(s), expected 1`);
console.log("first start: socket created ✔  status =", runtime.getStatus().status);

await runtime.stop();
if (runtime.getStatus().status !== "stopped") fail("status after stop() is not 'stopped'");

await runtime.start();
if (socketsCreated !== 2) {
  fail(`stop() → start() created ${socketsCreated} socket(s) total, expected 2 — the cached startPromise bug is back`);
}
console.log("stop → start: fresh socket created ✔  status =", runtime.getStatus().status);

// requestPairingCode must not refuse with the dead-end error any more.
// Any other outcome is fine: a real code, a WhatsApp-side error, or the
// QR-ready timeout when WhatsApp is unreachable from here.
let pairingOutcome;
try {
  const { code } = await runtime.requestPairingCode("+2348154890415");
  pairingOutcome = "pairing code issued: " + String(code).slice(0, 3) + "…(redacted)";
} catch (error) {
  pairingOutcome = "refused: " + String(error?.message || error);
}
if (/socket is not ready\. Start the runtime/i.test(pairingOutcome)) {
  fail("requestPairingCode still dead-ends after a restart: " + pairingOutcome);
}
console.log("pairing request after restart:", pairingOutcome);

await runtime.stop();
fs.rmSync(sessionDir, { recursive: true, force: true });
console.log("PASS — runtime restart cycle is healthy");
process.exit(0);
