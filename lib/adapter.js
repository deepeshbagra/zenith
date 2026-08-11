"use strict";

/**
 * Optional Redis adapter for Socket.IO.
 *
 * Socket.IO keeps room membership in the memory of one process. That is fine for
 * a single long-lived server, but Vercel Functions run many instances with no
 * affinity between connections — so without a shared backplane two people who
 * join the same room can land on different instances and never see each other.
 * Attaching the Redis adapter makes rooms, broadcasts and fetchSockets() work
 * across every instance.
 *
 * When REDIS_URL is absent the adapter is skipped and Socket.IO falls back to its
 * in-memory adapter. That is correct for local development and for a single
 * always-on host, and it keeps `npm start` working with no external services.
 */

let cachedClient = null;

/**
 * Synchronous on purpose: the adapter must be attached before Socket.IO accepts
 * its first connection, and on Vercel the module body is the only place
 * guaranteed to run before requests arrive.
 *
 * @param {import('socket.io').Server} io
 * @returns {boolean} whether the adapter was attached
 */
function attachRedisAdapter(io) {
  const url = process.env.REDIS_URL;

  if (!url) {
    if (process.env.VERCEL) {
      // On Vercel this is not a warning, it is a broken deployment waiting to
      // happen: it will work in testing with one instance and fail under load.
      console.error(
        "[adapter] REDIS_URL is not set. Running on Vercel without a Redis " +
          "adapter means room state is per-instance and participants will fail " +
          "to find each other. Provision Redis and set REDIS_URL."
      );
    } else {
      console.log("[adapter] No REDIS_URL, using in-memory adapter (single instance).");
    }
    return false;
  }

  try {
    const { createAdapter } = require("@socket.io/redis-streams-adapter");
    const Redis = require("ioredis");

    // Reused across warm invocations so we do not open a new connection per
    // request on Fluid Compute.
    if (!cachedClient) {
      cachedClient = new Redis(url, {
        // Let DNS choose IPv4 or IPv6. Pinning to one family is a common cause
        // of ETIMEDOUT when a host resolves to both and only one is routable
        // from the runtime.
        family: 0,
        connectTimeout: 10000,

        // Queue commands while a connection is being (re)established rather
        // than failing them. The adapter issues commands as soon as a socket
        // connects, which on a cold instance can be before Redis is ready —
        // failing fast there produced an empty room roster.
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        enableReadyCheck: true,
        lazyConnect: false,

        retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
      });

      cachedClient.on("error", (err) => {
        console.error("[adapter] Redis error:", err.message);
      });
      cachedClient.on("ready", () => {
        console.log("[adapter] Redis ready.");
      });
    }

    io.adapter(createAdapter(cachedClient));
    console.log("[adapter] Redis adapter attached.");
    return true;
  } catch (err) {
    console.error("[adapter] Failed to attach Redis adapter:", err);
    return false;
  }
}

/**
 * The shared Redis connection, or null when running without one.
 * Only valid after attachRedisAdapter() has run.
 */
function getRedisClient() {
  return cachedClient;
}

module.exports = { attachRedisAdapter, getRedisClient };
