import { startHealthServer } from "/home/z/my-project/damzd/src/health.js";
const fake = {
  status: () => ({
    name: "DamzD", ownerName: "Layo", connected: false,
    pairingCode: "48291357", pairingCodeAgeSeconds: 4, pairingNumber: "2347087299884",
    number: null, qr: null, qrMode: false, resetting: false,
    uptimeSeconds: 187, bootedAt: Date.now() - 187000,
    commands: 200, accessMode: "self", aiBrain: true, paused: false,
    appVersion: "1.4.11", lib: "baileys 7.0.0-rc14",
    pairingLog: [{ at: Date.now() - 5000, event: "code 48291357 issued for +2347087299884" }]
  })
};
startHealthServer(fake, 3111);
