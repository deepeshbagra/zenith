"use strict";

/**
 * ICE server configuration, resolved on the server and handed to clients when
 * they join a room.
 *
 * Deliberately not built in the browser from REACT_APP_* variables. Anything
 * with that prefix is compiled into the JavaScript bundle, so a TURN password
 * set that way is readable by anyone who opens devtools. Sending it over the
 * established socket instead keeps it out of the bundle, and means credentials
 * can be rotated without rebuilding the client.
 *
 * STUN only tells a peer its own public address. When both participants are
 * behind symmetric NAT — common on mobile carriers and corporate networks —
 * neither can accept an inbound connection and the call hangs in "connecting"
 * with no error. TURN relays the media in that case.
 */

const STUN_SERVERS = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

let warned = false;

/**
 * @returns {{iceServers: RTCIceServer[], hasTurn: boolean}}
 */
function buildIceServers() {
  const url = process.env.TURN_URL;
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;

  if (!url || !username || !credential) {
    if (!warned) {
      warned = true;
      console.warn(
        "[ice] No TURN configured (TURN_URL / TURN_USERNAME / TURN_CREDENTIAL). " +
          "Calls between peers on different restrictive networks will fail to connect."
      );
    }
    return { iceServers: STUN_SERVERS, hasTurn: false };
  }

  return {
    iceServers: [
      ...STUN_SERVERS,
      {
        // Comma-separated so several transports can be offered at once, e.g.
        // UDP plus a TCP/443 entry that survives firewalls blocking UDP.
        urls: url.split(",").map((u) => u.trim()).filter(Boolean),
        username,
        credential,
      },
    ],
    hasTurn: true,
  };
}

module.exports = { buildIceServers };
