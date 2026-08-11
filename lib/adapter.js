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
        // Fail fast instead of queueing commands forever if Redis is unreachable.
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
      });

      cachedClient.on("error", (err) => {
        console.error("[adapter] Redis error:", err.message);
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
