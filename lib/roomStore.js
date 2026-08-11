"use strict";

/**
 * Authoritative room membership.
 *
 * Socket.IO can answer "who is in this room" with `fetchSockets()`, but that is
 * a request/response exchange with every other server instance. On Vercel,
 * instances are frozen between invocations, so idle ones never reply and the
 * call fails with "timeout reached: only 0 responses received out of 2" — which
 * surfaced as every join returning INTERNAL_ERROR.
 *
 * Membership is therefore kept in a Redis hash per room and read with a single
 * HGETALL. No instance has to be awake for another to read the roster.
 * Broadcasting still goes through the Socket.IO adapter, which works because it
 * is fire-and-forget rather than request/response.
 *
 * Without REDIS_URL this falls back to an in-process Map, which is correct for
 * a single always-on server and for local development.
 */

const { getRedisClient } = require("./adapter");

// Abandoned rooms disappear on their own.
const ROOM_TTL_SECONDS = 12 * 60 * 60;

// A member is considered gone if it has not checked in within this window. The
// heartbeat below runs well inside it, so this only reaps entries left behind
// by an instance that died without running its disconnect handler.
const MEMBER_STALE_MS = 90 * 1000;
const HEARTBEAT_MS = 25 * 1000;

/** @type {Map<string, Map<string, object>>} room -> participantId -> member */
const memoryStore = new Map();

/**
 * room -> participantId -> first-seen timestamp.
 *
 * Deliberately outlives membership. Presence is removed the moment a socket
 * disconnects, but a disconnect is ambiguous — it may be the platform recycling
 * a WebSocket mid-call. If join order were discarded with it, a reconnecting
 * host would come back as the newest participant and the host badge would jump
 * to someone else every time Vercel hit its function duration limit.
 *
 * @type {Map<string, Map<string, number>>}
 */
const joinOrderStore = new Map();

const key = (room) => `zenith:room:${room}:members`;
const joinedKey = (room) => `zenith:room:${room}:joined`;

function localRoom(room) {
  let entry = memoryStore.get(room);
  if (!entry) {
    entry = new Map();
    memoryStore.set(room, entry);
  }
  return entry;
}

function localJoinOrder(room) {
  let entry = joinOrderStore.get(room);
  if (!entry) {
    entry = new Map();
    joinOrderStore.set(room, entry);
  }
  return entry;
}

function isFresh(member, now) {
  return now - (member.lastSeen || 0) < MEMBER_STALE_MS;
}

function sortMembers(members) {
  return members.sort(
    (a, b) =>
      a.joinedAt - b.joinedAt || a.participantId.localeCompare(b.participantId)
  );
}

/**
 * Adds or refreshes a member.
 *
 * A participant rejoining after a reconnect keeps its original joinedAt, so
 * host status survives the platform recycling its socket, and the value is
 * never taken from the client.
 *
 * @returns {Promise<object>} the stored member record
 */
async function addMember(room, { participantId, socketId, name }) {
  const now = Date.now();
  const redis = getRedisClient();

  if (redis) {
    try {
      // Atomic set-if-absent, so two instances racing on the same participant
      // cannot disagree about when they first arrived.
      await redis.hsetnx(joinedKey(room), participantId, now);
      await redis.expire(joinedKey(room), ROOM_TTL_SECONDS);
      const storedJoinedAt = Number(
        await redis.hget(joinedKey(room), participantId)
      );

      const member = {
        participantId,
        socketId,
        name,
        joinedAt: Number.isFinite(storedJoinedAt) ? storedJoinedAt : now,
        lastSeen: now,
      };

      await redis.hset(key(room), participantId, JSON.stringify(member));
      await redis.expire(key(room), ROOM_TTL_SECONDS);
      return member;
    } catch (err) {
      console.error("[roomStore] addMember failed:", err.message);
      // Fall through to the local path so a Redis blip cannot stop someone
      // joining a call outright.
    }
  }

  const order = localJoinOrder(room);
  if (!order.has(participantId)) order.set(participantId, now);

  const member = {
    participantId,
    socketId,
    name,
    joinedAt: order.get(participantId),
    lastSeen: now,
  };
  localRoom(room).set(participantId, member);
  return member;
}

/** Marks a member as still present. */
async function touchMember(room, participantId) {
  const now = Date.now();
  const redis = getRedisClient();

  if (redis) {
    try {
      const raw = await redis.hget(key(room), participantId);
      if (!raw) return;
      const member = JSON.parse(raw);
      member.lastSeen = now;
      await redis.hset(key(room), participantId, JSON.stringify(member));
      await redis.expire(key(room), ROOM_TTL_SECONDS);
      return;
    } catch (err) {
      console.error("[roomStore] touchMember failed:", err.message);
      return;
    }
  }

  const member = localRoom(room).get(participantId);
  if (member) member.lastSeen = now;
}

async function removeMember(room, participantId) {
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.hdel(key(room), participantId);
      return;
    } catch (err) {
      console.error("[roomStore] removeMember failed:", err.message);
      return;
    }
  }

  const entry = memoryStore.get(room);
  if (!entry) return;
  entry.delete(participantId);
  if (entry.size === 0) memoryStore.delete(room);
}

/**
 * The current roster, oldest join first. Stale entries are filtered out and
 * cleaned up as a side effect.
 *
 * @returns {Promise<Array<{participantId: string, socketId: string, name: string, joinedAt: number}>>}
 */
async function listMembers(room) {
  const now = Date.now();
  const redis = getRedisClient();

  let members = [];
  const stale = [];

  if (redis) {
    try {
      const raw = await redis.hgetall(key(room));
      for (const [participantId, value] of Object.entries(raw || {})) {
        let member;
        try {
          member = JSON.parse(value);
        } catch {
          stale.push(participantId);
          continue;
        }
        if (isFresh(member, now)) members.push(member);
        else stale.push(participantId);
      }

      if (stale.length > 0) {
        redis
          .hdel(key(room), ...stale)
          .catch((err) =>
            console.error("[roomStore] stale cleanup failed:", err.message)
          );
      }
    } catch (err) {
      console.error("[roomStore] listMembers failed:", err.message);
      return [];
    }
  } else {
    const entry = memoryStore.get(room);
    if (!entry) return [];
    for (const [participantId, member] of entry) {
      if (isFresh(member, now)) members.push(member);
      else stale.push(participantId);
    }
    for (const participantId of stale) entry.delete(participantId);
  }

  return sortMembers(members).map(({ lastSeen, ...rest }) => rest);
}

/** Forgets a room entirely, including its join order. Called once it empties. */
async function clearRoom(room) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(key(room), joinedKey(room));
    } catch (err) {
      console.error("[roomStore] clearRoom failed:", err.message);
    }
    return;
  }
  memoryStore.delete(room);
  joinOrderStore.delete(room);
}

module.exports = {
  addMember,
  touchMember,
  removeMember,
  listMembers,
  clearRoom,
  HEARTBEAT_MS,
};
