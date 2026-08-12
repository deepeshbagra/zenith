/**
 * ICE server configuration.
 *
 * STUN only, which is what a same-network call needs. STUN tells each peer its
 * own address so the two can find a direct route to each other; on one wifi
 * network they usually connect on host candidates without even needing that.
 *
 * There is deliberately no TURN server here. TURN relays media through a third
 * party for the case where two peers are on different restrictive networks —
 * typically one on mobile data — and neither can accept an inbound connection.
 * That costs bandwidth someone has to pay for, and this project is scoped to
 * calls between people on the same network. See the README for what that rules
 * out.
 */

const ICE_SERVERS = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

export function getIceServers() {
  return ICE_SERVERS;
}
