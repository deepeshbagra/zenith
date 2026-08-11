/**
 * ICE server configuration.
 *
 * STUN alone only works when at least one side can accept an inbound connection.
 * Behind symmetric NAT (most corporate networks, many mobile carriers) both sides
 * fail to find a route and the call silently hangs in "checking" forever. A TURN
 * server relays the media in that case, so it is required for the app to work for
 * real users rather than just two tabs on one laptop.
 *
 * TURN credentials are injected at build time. Without them the app still runs,
 * but roughly 15-20% of real-world calls will fail to connect.
 */

const STUN_SERVERS = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
    ],
  },
];

/**
 * Builds the iceServers array, appending TURN only when credentials are present.
 * @returns {RTCIceServer[]}
 */
export function getIceServers() {
  const turnUrl = process.env.REACT_APP_TURN_URL;
  const turnUsername = process.env.REACT_APP_TURN_USERNAME;
  const turnCredential = process.env.REACT_APP_TURN_CREDENTIAL;

  if (!turnUrl || !turnUsername || !turnCredential) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[ice] No TURN server configured. Calls between peers on restrictive " +
          "networks (symmetric NAT) will fail to connect. Set REACT_APP_TURN_URL, " +
          "REACT_APP_TURN_USERNAME and REACT_APP_TURN_CREDENTIAL."
      );
    }
    return STUN_SERVERS;
  }

  return [
    ...STUN_SERVERS,
    {
      urls: turnUrl.split(",").map((u) => u.trim()),
      username: turnUsername,
      credential: turnCredential,
    },
  ];
}

/**
 * True when TURN is configured. Used by the UI to warn during development.
 */
export function hasTurnConfigured() {
  return Boolean(
    process.env.REACT_APP_TURN_URL &&
      process.env.REACT_APP_TURN_USERNAME &&
      process.env.REACT_APP_TURN_CREDENTIAL
  );
}
