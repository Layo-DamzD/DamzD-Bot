// WhatsApp increasingly runs groups in "LID mode": members are identified by
// a privacy LID (a long number that is NOT a phone number, e.g.
// 123456789012345678@lid). Printing those digits as if they were phone
// numbers is exactly how the old .ghost produced "foreign numbers" in a
// Nigerian group. Every member number shown by the bot now goes through
// here: WhatsApp itself often hands us the real phone number alongside the
// LID (participant.phoneNumber), and the library keeps a LID→phone mapping
// store (signalRepository.lidMapping) fed by history sync.

import { numberFromJid } from "./utils.js";

// E.164 phone numbers are 7–15 digits. Anything else (16+ digit LIDs,
// empty strings, broadcast jids) is not a displayable phone number.
export function isPhoneLike(digits) {
  return /^[1-9]\d{6,14}$/.test(String(digits || ""));
}

function digitsOf(jid) {
  const digits = numberFromJid(jid);
  return isPhoneLike(digits) ? digits : "";
}

// Synchronous resolution straight from the participant object — WhatsApp
// includes `phoneNumber` for LID participants in group metadata, and `lid`
// for phone-number participants. Returns null when the phone number is not
// sitting right there on the object.
export function participantPhone(participant) {
  if (!participant) return null;
  const direct = digitsOf(participant.phoneNumber || "");
  if (direct) return { number: direct, jid: direct + "@s.whatsapp.net" };
  const id = String(participant.id || "");
  if (id.endsWith("@s.whatsapp.net")) {
    const digits = digitsOf(id);
    if (digits) return { number: digits, jid: digits + "@s.whatsapp.net" };
  }
  return null;
}

// Async LID→phone resolution through the library's mapping store (LRU-cached,
// fed by history sync). Never throws; a 3-second cap so a slow lookup can
// never stall a command. Returns null when the mapping is simply unknown —
// callers must then SKIP the person instead of printing the raw LID.
export async function lidToPhone(sock, lidJid) {
  try {
    const id = String(lidJid || "");
    if (!id.endsWith("@lid")) return null;
    const mapping = sock?.signalRepository?.lidMapping;
    if (typeof mapping?.getPNForLID !== "function") return null;
    const pnJid = await Promise.race([
      mapping.getPNForLID(id),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    const digits = digitsOf(pnJid);
    if (!digits) return null;
    return { number: digits, jid: digits + "@s.whatsapp.net" };
  } catch {
    return null;
  }
}

// Resolve any member JID (phone or LID) to a phone number + mention JID.
export async function resolveJidNumber(sock, jid) {
  const id = String(jid || "");
  if (id.endsWith("@s.whatsapp.net")) {
    const digits = digitsOf(id);
    if (digits) return { number: digits, jid: digits + "@s.whatsapp.net" };
  }
  if (id.endsWith("@lid")) return lidToPhone(sock, id);
  return null;
}

// Resolve a whole group's participant list to real phone numbers. Members
// whose phone number cannot be established are left out on purpose: a
// slightly shorter, correct list beats a list of meaningless digits.
export async function resolveParticipants(sock, meta) {
  const members = [];
  for (const participant of meta?.participants || []) {
    let entry = participantPhone(participant);
    if (!entry) entry = await lidToPhone(sock, participant?.id || "");
    if (!entry) continue;
    const raw = String(participant?.id || "");
    members.push({
      number: entry.number,
      jid: entry.jid,
      lid: raw.endsWith("@lid") ? numberFromJid(raw) : "",
      raw,
      admin: String(participant?.admin || "")
    });
  }
  return members;
}

// The bot's own numbers, both forms — used to keep her out of member lists.
export function ownNumbers(sock) {
  return {
    pn: numberFromJid(sock?.user?.id || ""),
    lid: numberFromJid(sock?.user?.lid || "")
  };
}
