/**
 * ICE server configuration.
 *
 * The real list comes from the server in the room:join acknowledgement rather
 * than from build-time REACT_APP_* variables, because anything with that prefix
 * is compiled into the JavaScript bundle — a TURN password set that way is
 * readable by anyone who opens devtools. See lib/ice.js.
 *
 * The STUN-only list below is the fallback used before a join has completed.
 */

const DEFAULT_ICE_SERVERS = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

let current = DEFAULT_ICE_SERVERS;
let turnConfigured = false;

/**
 * Records the configuration the server sent with the join acknowledgement.
 * @param {RTCIceServer[]} iceServers
 * @param {boolean} hasTurn
 */
export function setIceServers(iceServers, hasTurn) {
  if (Array.isArray(iceServers) && iceServers.length > 0) {
    current = iceServers;
  }
  turnConfigured = Boolean(hasTurn);

  if (!turnConfigured) {
    console.warn(
      "[ice] No TURN server is configured. Calls between peers on different " +
        "restrictive networks (mobile data, corporate wifi) will fail to connect."
    );
  }
}

export function getIceServers() {
  return current;
}

/**
 * Whether the server reported a usable TURN configuration. Used by the UI to
 * warn that some networks will not connect.
 */
export function hasTurnConfigured() {
  return turnConfigured;
}
