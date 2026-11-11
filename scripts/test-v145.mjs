// v1.4.5 checks — honest group tools: LID→phone resolution, persistent
// activity, truthful .ghost, and the pause switch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
function ok(label, condition) {
  if (condition) {
    passed++;
    console.log("  ok  " + label);
  } else {
    failed++;
    console.log("  FAIL " + label);
  }
}

console.log("v1.4.5 — group tools accuracy + pause switch");

// ---- 1. LID→phone resolution ----
const lidmap = await import("../src/lidmap.js");

ok("phone-like accepts a Nigerian number", lidmap.isPhoneLike("2347087299884"));
ok("phone-like rejects a 17-digit LID", !lidmap.isPhoneLike("12345678901234567"));
ok("phone-like rejects empty input", !lidmap.isPhoneLike(""));

ok(
  "participantPhone prefers WhatsApp's phoneNumber attr",
  lidmap.participantPhone({ id: "111600000000000000@lid", phoneNumber: "2348012345678@s.whatsapp.net" })?.number === "2348012345678"
);
ok(
  "participantPhone reads a plain phone participant",
  lidmap.participantPhone({ id: "2348023456789@s.whatsapp.net" })?.jid === "2348023456789@s.whatsapp.net"
);
ok("participantPhone never invents numbers from a LID", lidmap.participantPhone({ id: "111600000000000000@lid" }) === null);
ok("participantPhone survives junk input", lidmap.participantPhone(null) === null);

const mockSock = mapping => ({ signalRepository: { lidMapping: { getPNForLID: mapping } } });
const resolved = await lidmap.lidToPhone(
  mockSock(async () => "2348098765432:0@s.whatsapp.net"),
  "111600000000000000@lid"
);
ok("lidToPhone maps through the library store", resolved?.number === "2348098765432" && resolved.jid === "2348098765432@s.whatsapp.net");
ok("lidToPhone returns null when the mapping is unknown", await lidmap.lidToPhone(mockSock(async () => null), "111600000000000000@lid") === null);
ok("lidToPhone refuses a garbage mapping", await lidmap.lidToPhone(mockSock(async () => "999999999999999999@s.whatsapp.net"), "111600000000000000@lid") === null);
ok("lidToPhone ignores non-LID jids", await lidmap.lidToPhone(mockSock(async () => "2348012345678@s.whatsapp.net"), "2348012345678@s.whatsapp.net") === null);
ok(
  "ownNumbers exposes both identity forms",
  lidmap.ownNumbers({ user: { id: "2347087299884:12@s.whatsapp.net", lid: "111600000000000001:0@lid" } }).pn === "2347087299884"
);

const meta = {
  participants: [
    { id: "111600000000000010@lid", phoneNumber: "2348011111111@s.whatsapp.net", admin: "admin" },
    { id: "111600000000000011@lid" },                       // resolvable via the store mock
    { id: "2348033333333@s.whatsapp.net" },                 // plain phone member
    { id: "111600000000000099@lid" }                        // unknown mapping → skipped
  ]
};
const members = await lidmap.resolveParticipants(
  mockSock(async lid => lid.startsWith("111600000000000011@") ? "2348022222222@s.whatsapp.net" : null),
  meta
);
ok("resolveParticipants resolves every known member", members.length === 3);
ok("resolveParticipants keeps the admin flag", members[0].admin === "admin");
ok("resolveParticipants carries the LID for matching", members[1].lid === "111600000000000011");
ok("resolveParticipants skips members with unknown numbers", !members.some(m => m.number === "111600000000000099"));

// ---- 2. persistent activity store ----
const cache = await import("../src/cache.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "damzd-act-"));
cache.initActivityStore(tmp);
const GROUP = "120363@g.us";
cache.bumpActivity(GROUP, "2348011111111", "111600000000000010");
cache.bumpActivity(GROUP, "2348011111111", "");
cache.bumpActivity(GROUP, "", "111600000000000011");
cache.flushActivity();

ok("activityFor returns rows with both identities", (() => {
  const rows = cache.activityFor(GROUP);
  return rows.length === 2 && rows[0].pn === "2348011111111" && rows[1].lid === "111600000000000011";
})());
ok("activityWindow counts messages and firstSeen", cache.activityWindow(GROUP).total === 3);

// a fresh store instance (what happens after a restart) reloads the file
const cache2 = await import("../src/cache.js?restart=" + Date.now());
cache2.initActivityStore(tmp);
ok("activity survives a restart from disk", cache2.activityFor(GROUP).length === 2 && cache2.activityWindow(GROUP).total === 3);
ok("another group starts with a clean window", cache2.activityWindow("999@g.us").total === 0);
fs.rmSync(tmp, { recursive: true, force: true });

// ---- 3. honest ghost selection ----
const groupMod = await import("../src/lidmap.js").then(() => import("../commands/group.js"));
const DAY = 86400000;
const now = Date.now();
const pickGhosts = groupMod.pickGhosts;

const shortWindow = pickGhosts({
  members: [{ number: "2348011111111", lid: "111600000000000010" }],
  rows: [],
  watchedMs: 30 * 60000,
  totalSeen: 3
});
ok("ghost refuses to judge a too-short window", shortWindow.insufficient === true);

const lowData = pickGhosts({ members: [{ number: "2348011111111", lid: "" }], rows: [], watchedMs: 5 * DAY, totalSeen: 4 });
ok("ghost refuses to judge with too few messages", lowData.insufficient === true);

const members4 = [
  { number: "2348011111111", lid: "111600000000000010" },
  { number: "2348022222222", lid: "111600000000000011" },
  { number: "2348033333333", lid: "" },
  { number: "2347087299884", lid: "" }
];
const result = pickGhosts({
  members: members4,
  rows: [
    { pn: "2348011111111", lid: "", count: 5, last: now - 1000 },      // active by phone
    { pn: "", lid: "111600000000000011", count: 2, last: now - 2000 }, // active by LID only
    { pn: "2347087299884", lid: "", count: 1, last: now - 40 * DAY }   // stale — beyond the 7-day window
  ],
  watchedMs: 5 * DAY,
  totalSeen: 40,
  exclude: ["2347087299884"]
});
ok("ghost spares members active under either identity", !result.quiet.some(m => ["2348011111111", "2348022222222"].includes(m.number)));
ok("ghost lists members who truly never spoke", result.quiet.map(m => m.number).join(",") === "2348033333333");
ok("ghost never lists the excluded bot/owner numbers", !result.quiet.some(m => m.number === "2347087299884"));

const staleOnly = pickGhosts({ members: members4, rows: [{ pn: "2348011111111", lid: "", count: 1, last: now - 40 * DAY }], watchedMs: 5 * DAY, totalSeen: 40 });
ok("old activity does not count as active", staleOnly.quiet.some(m => m.number === "2348011111111"));

// ---- 4. pause switch ----
const flags = await import("../src/flags.js");
ok("the hard pause ships switched ON (Layo's request)", flags.HARD_PAUSED === true);
ok("the pause note is a plain-English sentence", typeof flags.PAUSE_NOTE === "string" && flags.PAUSE_NOTE.length > 20);

const runtimeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/runtime.js"), "utf8");
ok("start() honours the hard pause", runtimeSrc.includes("if (HARD_PAUSED)"));
ok("status exposes the paused state to the dashboard", runtimeSrc.includes("paused: Boolean(HARD_PAUSED"));
ok("the soft-pause gate lets only .resume through", runtimeSrc.includes('["resume", "unpause"].includes(parsedEarly.name)'));
ok("paused mode keeps recording activity silently", runtimeSrc.includes("await recordActivity(sock, msg)"));

const hooksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/hooks.js"), "utf8");
ok("activity recording stores both identity forms", hooksSrc.includes("bumpActivity(jid, pn, lid)"));

// ---- 5. recordActivity end-to-end with a LID sender ----
const hooks = await import("../src/hooks.js");
const LID_GROUP = "120364@g.us";
const lidSock = mockSock(async () => "2348055555555@s.whatsapp.net");
await hooks.recordActivity(lidSock, {
  key: { id: "MSG1", remoteJid: LID_GROUP, participant: "111600000000000055@lid" },
  message: { conversation: "hello from a LID sender" },
  pushName: "Ada"
}, LID_GROUP);
const lidRows = cache.activityFor(LID_GROUP);
ok("recordActivity maps a LID sender to a phone row", lidRows.length === 1 && lidRows[0].pn === "2348055555555" && lidRows[0].lid === "111600000000000055");

const fromMeSock = { user: { id: "2347087299884:12@s.whatsapp.net", lid: "111600000000000001:0@lid" } };
await hooks.recordActivity(fromMeSock, {
  key: { id: "MSG2", remoteJid: LID_GROUP, fromMe: true },
  message: { conversation: "the bot speaking" }
}, LID_GROUP);
const botRow = cache.activityFor(LID_GROUP).find(row => row.pn === "2347087299884");
ok("the bot's own messages are recorded so she can be excluded", !!botRow && botRow.lid === "111600000000000001");

// ---- 6. commands are wired ----
const { loadCommands } = await import("../src/loader.js");
const commands = await loadCommands(new URL("../commands", import.meta.url).pathname);
const names = commands.map(c => c.name);
ok(".pause is registered for the owner", names.includes("pause"));
ok(".resume is registered (with .unpause alias)", names.includes("resume") && commands.find(c => c.name === "resume").aliases.includes("unpause"));
ok(".ghost still registered", names.includes("ghost"));
const groupSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../commands/group.js"), "utf8");
ok("tagall/admins/ghost resolve real phone numbers", groupSrc.includes("resolveParticipants") && groupSrc.includes("pickGhosts"));
ok("roast resolves mentioned LIDs to numbers", groupSrc.includes("resolveJidNumber"));

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
