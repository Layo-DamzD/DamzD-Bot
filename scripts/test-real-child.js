// Real-child boot test: spawn an actual index.js child through the manager,
// confirm it boots, writes its status file, and is cleanly removable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "/home/z/my-project/damzd/src/sessions.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "damzd-real-"));
process.env.OWNER_NUMBER = "2347087299884";
process.env.LOG_LEVEL = "error";

let ok = true;
const check = (name, pass, detail) => {
  console.log((pass ? "PASS" : "FAIL") + " — " + name + (detail ? " (" + detail + ")" : ""));
  if (!pass) ok = false;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const manager = new SessionManager({
  dataDirectory: dataDir,
  entryPath: "/home/z/my-project/damzd/index.js",
  maxSessions: 2
});

manager.connect("2340000000101");
let status = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  try {
    status = JSON.parse(fs.readFileSync(path.join(dataDir, "sessions", "2340000000101", "status.json"), "utf8"));
    break;
  } catch { /* child still booting */ }
}
check("child wrote its status file", Boolean(status), status ? "v" + status.appVersion + ", connected=" + status.connected : "no status after 30s");
if (status) {
  check("child owns its own number", status.sessionNumber === "2340000000101", status.sessionNumber);
  check("child is private (self mode)", status.accessMode === "self", String(status.accessMode));
  check("child reports pairing state", typeof status.uptimeSeconds === "number", "up " + status.uptimeSeconds + "s");
}
const logPath = path.join(dataDir, "sessions", "2340000000101", "log.txt");
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
check("child boot log written", log.includes("child session for +2340000000101"), log.split("\n").slice(0, 3).join(" | ").slice(0, 160));

const removed = await manager.disconnect("2340000000101");
check("real child disconnected cleanly", removed.ok, JSON.stringify(removed));
check("folder wiped after disconnect", !fs.existsSync(path.join(dataDir, "sessions", "2340000000101")));

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(ok ? "ALL REAL-CHILD CHECKS PASSED" : "REAL-CHILD CHECKS FAILED");
process.exit(ok ? 0 : 1);
