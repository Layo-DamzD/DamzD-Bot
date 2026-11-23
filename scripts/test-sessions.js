// Session manager behaviour test (stub child — no WhatsApp involved):
//  1. connect() normalizes local numbers and spawns an isolated child
//  2. registry persists to sessions.json; status.json feeds readStatuses()
//  3. duplicate connect returns existing; master number is rejected
//  4. maxSessions cap enforced
//  5. disconnect() kills the child, wipes its folder and registry entry
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "/home/z/my-project/damzd/src/sessions.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "damzd-sessions-"));
process.env.OWNER_NUMBER = "2347087299884";

let ok = true;
const check = (name, pass, detail) => {
  console.log((pass ? "PASS" : "FAIL") + " — " + name + (detail ? " (" + detail + ")" : ""));
  if (!pass) ok = false;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const manager = new SessionManager({
  dataDirectory: dataDir,
  entryPath: "/home/z/my-project/scripts/stub-session-child.mjs",
  maxSessions: 2
});

const first = manager.connect("08012345678");
check("local number normalized", first.ok && first.number === "2348012345678", JSON.stringify(first));
check("child spawned", manager.children.size === 1, String(manager.children.size));

await sleep(1500);
let statuses = manager.readStatuses();
check("status file feeds dashboard", statuses.length === 1 && statuses[0].pairingCode === "98765432", JSON.stringify(statuses[0]));
check("not marked stale while child lives", statuses[0].stale === false);

const dup = manager.connect("08012345678");
check("duplicate connect returns existing", dup.ok && dup.existing === true, JSON.stringify(dup));
check("no double spawn", manager.children.size === 1, String(manager.children.size));

const master = manager.connect("2347087299884");
check("master number rejected", !master.ok, master.error);

const second = manager.connect("+234 902 345 6789");
check("second slot accepted", second.ok && second.number === "2349023456789", JSON.stringify(second));
const third = manager.connect("2349050001111");
check("cap enforced", !third.ok && String(third.error).includes("slots"), third.error);

const registry = JSON.parse(fs.readFileSync(path.join(dataDir, "sessions.json"), "utf8"));
check("registry persists two sessions", registry.sessions.length === 2, JSON.stringify(registry.sessions.map(s => s.number)));

const gone = await manager.disconnect("08012345678");
check("disconnect ok", gone.ok, JSON.stringify(gone));
check("registry shrinks", manager.list().join(",") === "2349023456789", manager.list().join(","));
check("child folder wiped", !fs.existsSync(path.join(dataDir, "sessions", "2348012345678")));
check("child process killed", !manager.children.has("2348012345678"));

const missing = await manager.disconnect("2340000000009");
check("disconnect unknown number fails cleanly", !missing.ok, missing.error);

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(ok ? "ALL SESSION CHECKS PASSED" : "SESSION CHECKS FAILED");
process.exit(ok ? 0 : 1);
