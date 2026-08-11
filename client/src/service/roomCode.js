/**
 * Room code generation.
 *
 * Codes get read aloud and typed by hand, so the alphabet omits characters that
 * are easy to confuse: no 0/O, no 1/l/i. Grouping into three short blocks makes
 * a code easier to dictate and to check than one long run of characters.
 *
 * Must satisfy ROOM_CODE_PATTERN in lib/signaling.js — letters, digits and
 * dashes, 4 to 64 characters.
 */

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function block(length) {
  const bytes = new Uint8Array(length);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function generateRoomCode() {
  return `${block(3)}-${block(4)}-${block(3)}`;
}
