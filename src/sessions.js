import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Multi-connect: after the owner's WhatsApp is linked, friends can connect
// their own WhatsApp to this same server. WhatsApp only ever links one account
// per session, so each connected phone gets its own isolated bot process: its
// own auth folder, its own data (bans, groups, memory), its own owner — and
// with ACCESS_MODE=self every one of them stays private to the phone that
// paired it. The main bot never shares sockets or state with these children.
//
// The manager only owns process lifetime. All WhatsApp logic stays in
// runtime.js untouched — a child IS a normal DamzD boot with different env.

const MAX_CONSECUTIVE_RESTARTS = 3;
const RESTART_DELAY_MS = 10000;
const LONG_LIVED_MS = 5 * 60 * 1000;   // a run this long proves the child is healthy
const STATUS_STALE_MS = 20000;          // no status file update in 20s = wedged

function normalizeNumber(raw, countryCode) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 12) {
    digits = countryCode + digits.slice(1);
  }
  return digits;
}

export class SessionManager {
  constructor({ dataDirectory, entryPath, maxSessions = 5 }) {
    this.root = path.join(path.resolve(dataDirectory), "sessions");
    this.registryPath = path.join(path.resolve(dataDirectory), "sessions.json");
    this.entryPath = path.resolve(entryPath);
    this.maxSessions = Math.max(0, Math.floor(maxSessions) || 0);
    this.children = new Map(); // digits -> { child, spawnAt, restarts, stopping }
    const owner = String(process.env.OWNER_NUMBER || "").replace(/\D/g, "");
    this.countryCode = owner && !owner.startsWith("0") ? owner.slice(0, 3) : "234";
    this.masterNumber = owner;
  }

  #entries() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, "utf8"));
      if (Array.isArray(parsed?.sessions)) {
        // Normalized at read time: whatever shape ended up on disk (object from
        // a proper save, bare digits string from an older one), every caller
        // sees objects with a number field.
        return parsed.sessions
          .filter(Boolean)
          .map(entry => typeof entry === "string" ? { number: entry } : entry)
          .filter(entry => String(entry.number || "").length >= 8);
      }
    } catch { /* first boot or wiped disk */ }
    return [];
  }

  #saveRegistry(list) {
    try {
      fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
      const tmp = this.registryPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions: list }, null, 1));
      fs.renameSync(tmp, this.registryPath);
    } catch (error) {
      console.error("[sessions] could not save registry:", error?.message);
    }
  }

  #sessionDir(digits) {
    return { dir: path.join(this.root, digits), auth: path.join(this.root, digits, "auth"), data: path.join(this.root, digits, "data") };
  }

  list() {
    return this.#entries().map(entry => String(entry.number || ""));
  }

  // Boot-time: respawn every session the registry remembers (locally or on a
  // persistent disk they come back with their pairing intact; on Render's free
  // tier the wiped disk takes the registry AND the auth folders together).
  load() {
    for (const digits of this.list()) this.spawn(digits);
    if (this.children.size) console.log("[sessions] respawned " + this.children.size + " connected WhatsApp(s)");
  }

  spawn(digits) {
    if (this.children.has(digits)) return;
    // A banned friend keeps their registration and pairing but never gets a
    // process again until the owner unbans them from the dashboard.
    if (this.#entries().some(entry => String(entry.number) === digits && entry.bannedAt)) return;
    const { auth, data } = this.#sessionDir(digits);
    fs.mkdirSync(auth, { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    const logPath = path.join(this.root, digits, "log.txt");
    try { // keep the log readable — start fresh when it grows past ~400KB
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 400 * 1024) fs.rmSync(logPath);
    } catch { /* best effort */ }

    const env = {
      ...process.env,
      DAMZD_CHILD: "1",
      DAMZD_STATUS_FILE: path.join(this.root, digits, "status.json"),
      OWNER_NUMBER: digits,
      OWNER_NAME: "Boss",
      SESSION_DIR: auth,
      DATA_DIR: data,
      ACCESS_MODE: "self",
      PORT: "0"
    };
    delete env.PAIRING_CODE; // a fixed code would show on every child at once

    let out;
    try { out = fs.openSync(logPath, "a"); } catch { out = "ignore"; }
    const child = spawn(process.execPath, [this.entryPath], {
      cwd: path.dirname(this.entryPath),
      env,
      stdio: ["ignore", out, out]
    });
    const entry = { child, spawnAt: Date.now(), restarts: 0, stopping: false };
    this.children.set(digits, entry);
    console.log("[sessions] +" + digits + " starting (pid " + child.pid + ")");

    child.on("exit", (code, signal) => {
      this.children.delete(digits);
      try { fs.closeSync?.(out); } catch { /* fd may already be closed */ }
      if (entry.stopping) return;
      const livedLong = Date.now() - entry.spawnAt > LONG_LIVED_MS;
      entry.restarts = livedLong ? 1 : entry.restarts + 1;
      if (entry.restarts > MAX_CONSECUTIVE_RESTARTS) {
        console.error("[sessions] +" + digits + " keeps exiting — giving up until it is connected again from the dashboard");
        return;
      }
      console.log("[sessions] +" + digits + " exited (" + (code ?? signal) + ") — restarting in " + (RESTART_DELAY_MS / 1000) + "s");
      setTimeout(() => {
        if (!entry.stopping && this.list().includes(digits)) this.spawn(digits);
      }, RESTART_DELAY_MS);
    });
  }

  connect(rawNumber) {
    const digits = normalizeNumber(rawNumber, this.countryCode);
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "type the full number, e.g. 2348012345678 (or local 08012345678)" };
    }
    if (this.masterNumber && digits === this.masterNumber) {
      return { ok: false, error: "that is already the main bot's number" };
    }
    const registered = this.#entries();
    if (registered.some(entry => String(entry.number) === digits)) {
      return { ok: true, number: digits, existing: true };
    }
    if (registered.length >= this.maxSessions) {
      return { ok: false, error: "all " + this.maxSessions + " extra connection slots are used — disconnect one first" };
    }
    registered.push({ number: digits, addedAt: new Date().toISOString() });
    this.#saveRegistry(registered);
    this.spawn(digits);
    console.log("[sessions] +" + digits + " added — pairing code shows on the dashboard in a few seconds");
    return { ok: true, number: digits };
  }

  async disconnect(rawNumber) {
    const digits = normalizeNumber(rawNumber, this.countryCode);
    const registered = this.#entries();
    if (!registered.some(entry => String(entry.number) === digits)) {
      return { ok: false, error: "+" + digits + " is not connected here" };
    }
    this.#saveRegistry(registered.filter(entry => String(entry.number) !== digits));
    const entry = this.children.get(digits);
    if (entry) {
      entry.stopping = true;
      const child = entry.child;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      await new Promise(resolve => {
        const done = () => resolve();
        child.once("exit", done);
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
          setTimeout(done, 1500);
        }, 6000);
      });
    }
    try { fs.rmSync(this.#sessionDir(digits).dir, { recursive: true, force: true }); } catch { /* nothing to wipe */ }
    console.log("[sessions] +" + digits + " disconnected and wiped");
    return { ok: true, number: digits };
  }

  // Is this number one of the connected friend sessions? Accepts any format
  // the owner might type (local 0803… or international 234803…) and normalizes
  // the same way connect/ban/unban do.
  has(rawNumber) {
    const digits = normalizeNumber(rawNumber, this.countryCode);
    return this.#entries().some(entry => String(entry.number) === digits);
  }

  // Owner's kill switch for a connected friend: their bot process is stopped
  // and never respawns, but the registration and WhatsApp link are kept — so
  // unbanning brings their bot straight back without a fresh pairing.
  ban(rawNumber) {
    const digits = normalizeNumber(rawNumber, this.countryCode);
    const registered = this.#entries();
    const entry = registered.find(item => String(item.number) === digits);
    if (!entry) return { ok: false, error: "+" + digits + " is not connected here" };
    if (entry.bannedAt) return { ok: false, error: "+" + digits + " is already banned" };
    entry.bannedAt = new Date().toISOString();
    this.#saveRegistry(registered);
    const child = this.children.get(digits);
    if (child) {
      child.stopping = true; // a ban is not a crash — no auto-restart
      try { child.child.kill("SIGTERM"); } catch { /* already gone */ }
      this.children.delete(digits);
    }
    console.log("[sessions] +" + digits + " banned — their bot is stopped");
    return { ok: true, number: digits, banned: true };
  }

  unban(rawNumber) {
    const digits = normalizeNumber(rawNumber, this.countryCode);
    const registered = this.#entries();
    const entry = registered.find(item => String(item.number) === digits);
    if (!entry) return { ok: false, error: "+" + digits + " is not connected here" };
    if (!entry.bannedAt) return { ok: false, error: "+" + digits + " is not banned" };
    delete entry.bannedAt;
    this.#saveRegistry(registered);
    this.spawn(digits); // the auth folder survived the ban — it relinks on its own
    console.log("[sessions] +" + digits + " unbanned — bot starting again");
    return { ok: true, number: digits };
  }

  stopAll() {
    for (const [digits, entry] of this.children) {
      entry.stopping = true;
      try { entry.child.kill("SIGTERM"); } catch { /* already gone */ }
    }
  }

  // Dashboard payload: one row per registered session, live state from the
  // child's own status file (the child rewrites it every 3 seconds).
  readStatuses() {
    return this.#entries().map(entry => {
      const digits = String(entry.number || "");
      const banned = Boolean(entry.bannedAt);
      const statusPath = path.join(this.root, digits, "status.json");
      let status = null;
      let stale = false;
      try {
        status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
        if (Date.now() - fs.statSync(statusPath).mtimeMs > STATUS_STALE_MS) stale = true;
      } catch { stale = !this.children.has(digits); }
      const alive = this.children.has(digits);
      return {
        number: digits,
        banned,
        connected: banned || stale ? false : Boolean(status?.connected),
        pairingCode: banned || stale ? null : (status?.pairingCode || null),
        pairingNumber: banned || stale ? null : (status?.pairingNumber || null),
        pairingCodeAgeSeconds: banned || stale ? null : (status?.pairingCodeAgeSeconds ?? null),
        uptimeSeconds: banned || stale ? 0 : Math.max(0, Math.floor(status?.uptimeSeconds || 0)),
        appVersion: banned ? null : (status?.appVersion || null),
        stale,
        starting: alive && !stale && !status
      };
    });
  }
}
