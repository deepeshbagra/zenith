"use strict";

/**
 * Remembers when each participant first entered a room.
 *
 * Host is "whoever has been here longest", so that ordering has to survive a
 * participant's socket being recycled — otherwise the host badge jumps to
 * someone else every time Vercel closes a WebSocket at its duration limit.
 *
 * It deliberately does not come from the client. An earlier version let clients
 * replay their own join time across a reconnect, which meant anyone could send
 * `joinedAt: 1` and become host on arrival.
 *
 * Backed by Redis when configured, so the ordering is shared by every function
 * instance. Without Redis it falls back to an in-process Map, which is correct
 * for a single always-on server and for local development.
 */

const { getRedisClient } = require("./adapter");

// Long enough that a call never outlives it, short enough that abandoned rooms
// do not accumulate.
const ROOM_TTL_SECONDS = 12 * 60 * 60;

/** @type {Map<string, Map<string, number>>} room -> participantId -> timestamp */
const memoryStore = new Map();

const key = (room) => `zenith:room:${room}:joined`;

/**
 * Returns the participant's first-seen timestamp for this room, recording `now`
 * if this is the first time they have been seen.
 *
 * The set-if-absent is atomic in the Redis path (HSETNX), so two instances
 * racing on the same participant cannot produce two different answers.
 *
 * @param {string} room
 * @param {string} participantId
 * @param {number} now
 * @returns {Promise<number>}
 */
async function getOrSetJoinedAt(room, participantId, now = Date.now()) {
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.hsetnx(key(room), participantId, now);
      await redis.expire(key(room), ROOM_TTL_SECONDS);
      const stored = await redis.hget(key(room), participantId);
      const parsed = Number(stored);
      return Number.isFinite(parsed) ? parsed : now;
    } catch (err) {
      // A Redis blip must not stop someone joining a call. Falling through to
      // `now` costs at most a host badge in the wrong place.
      console.error("[roomStore] Redis unavailable, using local time:", err.message);
      return now;
    }
  }

  let room_ = memoryStore.get(room);
  if (!room_) {
    room_ = new Map();
    memoryStore.set(room, room_);
  }
  if (!room_.has(participantId)) {
    room_.set(participantId, now);
  }
  return room_.get(participantId);
}

/**
 * Drops all remembered ordering for a room. Called once the room empties, so a
 * later call reusing the same code starts fresh.
 * @param {string} room
 */
async function clearRoom(room) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(key(room));
    } catch (err) {
      console.error("[roomStore] failed to clear room:", err.message);
    }
    return;
  }
  memoryStore.delete(room);
}

module.exports = { getOrSetJoinedAt, clearRoom };
