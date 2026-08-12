"use strict";

/**
 * ICE server configuration, resolved on the server and handed to clients when
 * they join a room.
 *
 * Deliberately not built in the browser from REACT_APP_* variables. Anything
 * with that prefix is compiled into the JavaScript bundle, so a TURN credential
 * set that way is readable by anyone who opens devtools — and TURN relays real
 * bandwidth that someone else would be paying for. Sending it over the socket
 * instead keeps it out of the bundle and lets credentials rotate without a
 * rebuild.
 *
 * STUN only tells a peer its own public address. When both participants are
 * behind symmetric NAT — common on mobile carriers and corporate networks —
 * neither can accept an inbound connection and the call hangs in "Connecting"
 * with no error. TURN relays the media in that case.
 *
 * Two ways to configure it, checked in this order:
 *
 *   1. METERED_APP_NAME + METERED_API_KEY — fetches credentials from Metered's
 *      API, which returns relays nearest the caller and issues short-lived
 *      credentials rather than a permanent password.
 *   2. TURN_URL + TURN_USERNAME + TURN_CREDENTIAL — a fixed server, for Twilio,
 *      self-hosted coturn, or anything else speaking standard TURN.
 *
 * With neither, it falls back to STUN only and reports hasTurn: false so the
 * call UI can warn that some networks will not connect.
 */

const STUN_SERVERS = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

// Metered issues time-limited credentials, so they are refetched periodically.
// Ten minutes keeps the credential fresh without calling their API on every
// single join, which would waste quota on a metered plan.
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

let cache = { fetchedAt: 0, iceServers: null };
let warned = false;

function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.warn(message);
}

/** Fixed-server configuration, if provided. */
function staticConfig() {
  const url = process.env.TURN_URL;
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;

  if (!url || !username || !credential) return null;

  return [
    ...STUN_SERVERS,
    {
      // Comma-separated so several transports can be offered at once. A TCP/443
      // entry is worth including because some networks block UDP entirely.
      urls: url.split(",").map((u) => u.trim()).filter(Boolean),
      username,
      credential,
    },
  ];
}

/**
 * Fetches ICE servers from Metered.
 *
 * Failure is never fatal: a TURN outage should degrade the call to STUN-only,
 * not stop people joining the room.
 *
 * @returns {Promise<RTCIceServer[]|null>}
 */
async function fetchMetered() {
  const appName = process.env.METERED_APP_NAME;
  const apiKey = process.env.METERED_API_KEY;
  if (!appName || !apiKey) return null;

  const now = Date.now();
  if (cache.iceServers && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.iceServers;
  }

  const endpoint =
    `https://${encodeURIComponent(appName)}.metered.live` +
    `/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const servers = await response.json();
    if (!Array.isArray(servers) || servers.length === 0) {
      throw new Error("empty iceServers response");
    }

    // Metered returns both STUN and TURN entries. Keep ours too, so a peer can
    // still gather host candidates if their relay list is unusable.
    const iceServers = [...STUN_SERVERS, ...servers];
    cache = { fetchedAt: now, iceServers };
    console.log(`[ice] Fetched ${servers.length} ICE servers from Metered.`);
    return iceServers;
  } catch (err) {
    const reason = err.name === "AbortError" ? "timed out" : err.message;
    console.error(`[ice] Metered credential fetch failed (${reason}).`);
    // Serve a stale list rather than dropping to STUN-only over a blip.
    return cache.iceServers || null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{iceServers: RTCIceServer[], hasTurn: boolean}>}
 */
async function buildIceServers() {
  const metered = await fetchMetered();
  if (metered) return { iceServers: metered, hasTurn: true };

  const fixed = staticConfig();
  if (fixed) return { iceServers: fixed, hasTurn: true };

  warnOnce(
    "[ice] No TURN configured. Set METERED_APP_NAME + METERED_API_KEY, or " +
      "TURN_URL + TURN_USERNAME + TURN_CREDENTIAL. Without one of these, calls " +
      "between peers on different restrictive networks will fail to connect."
  );
  return { iceServers: STUN_SERVERS, hasTurn: false };
}

module.exports = { buildIceServers };
