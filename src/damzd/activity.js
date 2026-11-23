// DamzD group activity tracker — ported from the DamzD v1.4.x cache store.
// Persistent per-group rows of who messaged when (phone number AND LID
// forms), backing .onlineusers, .top and .ghost. The store survives
// restarts: activity.json in the data directory, written behind an interval.
import fs from "node:fs";
import path from "node:path";

const SAVE_EVERY_MS = 15000;
let storePath = null;
let db = { groups: {} };
let dirty = false;
let saveTimer = null;

export function initActivityStore(dataDirectory) {
  storePath = path.join(path.resolve(dataDirectory), "activity.json");
  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.groups && typeof parsed.groups === "object") {
        db = parsed;
      }
    }
  } catch {
    db = { groups: {} };
  }
  if (!saveTimer) {
    saveTimer = setInterval(() => {
      if (dirty) saveNow();
    }, SAVE_EVERY_MS);
    if (saveTimer.unref) saveTimer.unref();
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    try {
      process.once(signal, () => {
        if (dirty) saveNow();
      });
    } catch {
      /* not all environments expose process signals */
    }
  }
}

function saveNow() {
  if (!storePath) return;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(db));
    dirty = false;
  } catch {
    /* a failed save is retried on the next tick */
  }
}

export function flushActivity() {
  saveNow();
}

function groupDb(jid) {
  const key = String(jid || "");
  if (!key) return null;
  let group = db.groups[key];
  if (!group || typeof group !== "object") {
    group = { firstSeen: Date.now(), total: 0, rows: {} };
    db.groups[key] = group;
    dirty = true;
  }
  if (!group.rows || typeof group.rows !== "object") group.rows = {};
  if (!group.firstSeen) group.firstSeen = Date.now();
  if (typeof group.total !== "number") group.total = 0;
  return group;
}

// pn and lid are digit strings (either may be empty). The row is keyed by the
// phone number when it is known so the history is stable across LID rotation.
export function bumpActivity(jid, pn, lid) {
  const group = groupDb(jid);
  if (!group || (!pn && !lid)) return;
  const key = pn || "~" + lid;
  const row = group.rows[key] || { pn: pn || "", lid: lid || "", count: 0, last: 0 };
  if (pn) row.pn = pn;
  if (lid) row.lid = lid;
  row.count += 1;
  row.last = Date.now();
  group.rows[key] = row;
  group.total += 1;
  dirty = true;
}

// All recorded rows for a group: [{ pn, lid, count, last }]
export function activityFor(jid) {
  const group = db.groups[String(jid || "")];
  if (!group || !group.rows) return [];
  return Object.values(group.rows).map(row => ({
    pn: String(row.pn || ""),
    lid: String(row.lid || ""),
    count: Number(row.count || 0),
    last: Number(row.last || 0)
  }));
}

// How long the bot has been watching a group and how many messages it saw —
// the honest basis for "who never talks" claims.
export function activityWindow(jid) {
  const group = db.groups[String(jid || "")];
  const firstSeen = Number(group?.firstSeen || Date.now());
  const total = Number(group?.total || 0);
  return { firstSeen, total, watchedMs: Date.now() - firstSeen };
}
