import { numberFromJid } from "./message-utils.js";

export function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isOwnerNumber(config, jidOrNumber) {
  const target = normalizePhoneNumber(
    String(jidOrNumber || "").includes("@")
      ? numberFromJid(jidOrNumber)
      : jidOrNumber
  );
  if (!target) return false;
  const owners = Array.isArray(config?.ownerNumbers) ? config.ownerNumbers : [];
  return owners.some(owner => normalizePhoneNumber(owner) === target);
}
