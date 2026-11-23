// Stub child for the session-manager test: writes a fake status file every
// 300ms (pairing code showing, not yet connected) and stays alive until killed.
import fs from "node:fs";

const statusFile = process.env.DAMZD_STATUS_FILE;
const payload = () => JSON.stringify({
  connected: false,
  pairingCode: "98765432",
  pairingCodeAgeSeconds: 0,
  pairingNumber: process.env.OWNER_NUMBER || "",
  uptimeSeconds: Math.floor(process.uptime()),
  appVersion: "stub",
  writtenAt: Date.now()
});
const write = () => { try { fs.writeFileSync(statusFile, payload()); } catch { /* ignore */ } };
write();
setInterval(write, 300);
process.on("SIGTERM", () => process.exit(0));
