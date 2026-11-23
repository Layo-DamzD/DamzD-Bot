// Smoke test for the v1.4.1 dashboard: boot the health server with a mock bot,
// hit every endpoint, and verify every getElementById target exists in the HTML.
import { startHealthServer } from "/home/z/my-project/damzd/src/health.js";

const bot = {
  status: () => ({
    name: "DamzD", connected: false, pairingCode: "AB12CD34",
    pairingCodeAgeSeconds: 5, pairingNumber: "2347087299884",
    qr: null, qrAgeSeconds: null, qrMode: false, resetting: false,
    uptimeSeconds: 10, commands: 20, accessMode: "self", aiBrain: true,
    appVersion: "1.4.1", lib: "baileys 7.0.0-rc14", pairingLog: [{ at: Date.now(), event: "code AB12CD34 issued for +2347087299884" }]
  }),
  setQrMode: (on) => ({ ok: true, qrMode: !!on }),
  fullReset: async () => ({ ok: true }),
  requestPairingForNumber: async () => ({ ok: true, code: "AB12CD34", number: "2347087299884" }),
  refreshPairingCode: async () => ({ ok: true, code: "AB12CD34" })
};

const server = startHealthServer(bot, 3100);
await new Promise(r => setTimeout(r, 300));

const base = "http://127.0.0.1:3100";
const results = [];
const check = (name, cond) => results.push((cond ? "PASS" : "FAIL") + "  " + name);

// 1. Page HTML contains all new element IDs the script references
const page = await (await fetch(base + "/")).text();
for (const id of ["codeView", "qrView", "qrAge", "qrModeBtn", "codeModeBtn", "resetBtn", "waitCard", "pairLog", "expires"]) {
  check(`html has id="${id}"`, page.includes(`id="${id}"`));
}
check("html has QR scan steps", page.includes("second screen"));
check("html has reset hint", page.includes("Start completely over"));

// 2. /status exposes the new fields
const st = await (await fetch(base + "/status")).json();
check("status.qrMode boolean", typeof st.qrMode === "boolean");
check("status.qrAgeSeconds field present", "qrAgeSeconds" in st);
check("status.resetting field present", "resetting" in st);
check("status.appVersion 1.4.1", st.appVersion === "1.4.1");

// 3. /pairing/qr-mode on/off
const r1 = await (await fetch(base + "/pairing/qr-mode", { method: "POST", headers: { "content-type": "application/json" }, body: '{"on":true}' })).json();
check("qr-mode on → {ok:true,qrMode:true}", r1.ok === true && r1.qrMode === true);
const r2 = await (await fetch(base + "/pairing/qr-mode", { method: "POST", headers: { "content-type": "application/json" }, body: '{"on":false}' })).json();
check("qr-mode off → {ok:true,qrMode:false}", r2.ok === true && r2.qrMode === false);
const r3 = await (await fetch(base + "/pairing/qr-mode", { method: "POST", headers: { "content-type": "application/json" }, body: 'garbage' })).json();
check("qr-mode bad body → treated as off, no crash", r3.ok === true && r3.qrMode === false);

// 4. /pairing/reset
const r4 = await (await fetch(base + "/pairing/reset", { method: "POST" })).json();
check("reset → {ok:true}", r4.ok === true);

// 5. page script references match: every getElementById arg exists as id=""
const ids = [...page.matchAll(/getElementById\("([^"]+)"\)/g)].map(m => m[1]);
const missing = [...new Set(ids)].filter(id => !page.includes(`id="${id}"`));
check("every getElementById target exists (" + ids.length + " refs)", missing.length === 0);
if (missing.length) console.log("missing:", missing);

server.close();
console.log(results.join("\n"));
const fails = results.filter(r => r.startsWith("FAIL")).length;
console.log(fails ? `\n${fails} FAILURES` : "\nALL DASHBOARD CHECKS PASSED");
process.exit(fails ? 1 : 0);
