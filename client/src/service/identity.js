const PARTICIPANT_ID_KEY = "zenith_participant_id";
const DISPLAY_NAME_KEY = "zenith_display_name";

/**
 * Returns this tab's stable participant id, creating one on first use.
 *
 * Stored in sessionStorage rather than localStorage on purpose: it must survive
 * reloads and reconnects within a tab, but two tabs should be two distinct
 * participants. localStorage would make them collide — and two tabs is exactly
 * how you test a call on one machine.
 */
export function getParticipantId() {
  let id = sessionStorage.getItem(PARTICIPANT_ID_KEY);
  if (!id) {
    id = generateId();
    sessionStorage.setItem(PARTICIPANT_ID_KEY, id);
  }
  return id;
}

function generateId() {
  // randomUUID needs a secure context (https or localhost). The fallback keeps
  // the app working when served over plain http on a LAN address for testing,
  // where getUserMedia is also restricted but the rest still runs.
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getDisplayName() {
  return localStorage.getItem(DISPLAY_NAME_KEY) || "";
}

export function setDisplayName(name) {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}
