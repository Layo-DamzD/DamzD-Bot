// The hard pause switch. Flipping this in the repo deploys to Render via
// GitHub, so the bot can be silenced WITHOUT any access to the Render
// dashboard — exactly what the owner needs when he is away from it.
//
//   true  = the WhatsApp socket never starts; she is fully offline and the
//           dashboard explains why. Nothing is read, nothing is sent.
//   false = normal boot; she connects and pairs as usual.
//
// The soft pause (.pause / .resume in WhatsApp) works on top of this when
// she is running: it keeps the socket alive but ignores everyone.

export const HARD_PAUSED = true;

export const PAUSE_NOTE =
  "Layo switched me off for a few days — I am not reading or answering anything right now. " +
  "Back online soon.";
