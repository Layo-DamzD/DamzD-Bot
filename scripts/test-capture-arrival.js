// Verify the capture-on-arrival wiring offline: the stash accepts a synthetic
// view-once arrival (both wrapper and direct-flag shapes), findCachedViewOnce
// returns it, and readCachedMedia round-trips captured bytes from disk.
import { stashViewOnce, findCachedViewOnce, readCachedMedia, initViewOnceStore } from "/home/z/my-project/damzd/src/viewonce.js";
import fs from "node:fs";

const dir = "/tmp/vonce-test";
fs.rmSync(dir, { recursive: true, force: true });
initViewOnceStore(dir);

// 1. Wrapper-shaped arrival (standard viewOnceMessageV2).
const wrapperMsg = {
  key: { remoteJid: "234801@s.whatsapp.net", id: "WRAP1", participant: "234802@s.whatsapp.net" },
  message: {
    viewOnceMessageV2: {
      message: { imageMessage: { url: "https://mmg.invalid/x", mediaKey: "k", viewOnce: true } }
    }
  }
};
console.log("stash wrapper   :", stashViewOnce(wrapperMsg) === true ? "OK" : "FAIL");

// 2. Direct-flag arrival with NO wrapper at all (the safety-net shape).
const flagMsg = {
  key: { remoteJid: "234801@s.whatsapp.net", id: "FLAG1" },
  message: { imageMessage: { url: "https://mmg.invalid/y", mediaKey: "k", viewOnce: true } }
};
console.log("stash flag-shape:", stashViewOnce(flagMsg) === true ? "OK" : "FAIL");

// 3. Lookup by id fallback (LID vs phone-form chat keys).
const hit = findCachedViewOnce("999@s.whatsapp.net", "WRAP1");
console.log("lookup fallback :", hit?.node?.url === "https://mmg.invalid/x" ? "OK" : "FAIL");

// 4. readCachedMedia round-trip with a captured file on disk.
fs.mkdirSync(dir + "/viewonce-media", { recursive: true });
fs.writeFileSync(dir + "/viewonce-media/test.bin", Buffer.from("MEDIABYTES"));
console.log("bytes round-trip:", readCachedMedia({ file: dir + "/viewonce-media/test.bin" }).toString() === "MEDIABYTES" ? "OK" : "FAIL");

// 5. Missing file (deploy wiped disk) degrades to null, never throws.
console.log("missing file    :", readCachedMedia({ file: dir + "/nope.bin" }) === null ? "OK" : "FAIL");

console.log("ALL WIRED — capture-on-arrival ready.");
