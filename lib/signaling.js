"use strict";

/**
 * WebRTC signalling protocol.
 *
 * Shared by the standalone dev server (server/index.js) and the Vercel function
 * (api/socket-io.js) so both run identical logic.
 *
 * The server never sees audio or video — that flows peer-to-peer. Its only jobs
 * are: track who is in a room, relay opaque signalling payloads between them,
 * and broadcast lightweight room events (chat, mute state, reactions).
 *
 * ## Identity
 *
 * Participants are identified by a client-generated `participantId`, not by
 * `socket.id`. This matters because socket.id changes on every reconnect, and on
 * Vercel the WebSocket is force-closed when the function reaches its max
 * duration (300s on Hobby) — so a long call reconnects repeatedly. Keyed by
 * socket.id, each of those reconnects would look like the participant left and a
 * stranger joined, tearing down and rebuilding every peer connection in the room.
 *
 * Keyed by participantId, a reconnect is just a routing update: peers keep their
 * established media connections and simply learn the new socket.id to address.
 */

const { getOrSetJoinedAt, clearRoom } = require("./roomStore");

const MAX_PARTICIPANTS = 5;
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 2000;
const ROOM_CODE_PATTERN = /^[a-zA-Z0-9-]{4,64}$/;
const PARTICIPANT_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

// Simple per-socket token bucket, enough to stop a runaway client from flooding
// a room. Not a substitute for the platform rate limiting in front of it.
const CHAT_BURST = 10;
const CHAT_REFILL_MS = 1000;

/**
 * Reads the authoritative participant list for a room.
 *
 * Uses fetchSockets() rather than a local Map because, with the Redis adapter
 * attached, it queries every server instance. That matters on Vercel where two
 * people in the same room routinely land on different function instances — a
 * local Map would show each of them an empty room.
 *
 * @param {import('socket.io').Server} io
 * @param {string} room
 * @returns {Promise<Array<{participantId: string, socketId: string, name: string, joinedAt: number}>>}
 */
async function getParticipants(io, room) {
  const sockets = await io.in(room).fetchSockets();

  // A reconnecting client can briefly have two sockets in the room: the new one
  // and the old one the server has not yet reaped. Keep only the newest socket
  // per participant so the roster never shows a duplicate.
  const byParticipant = new Map();
  for (const s of sockets) {
    const participantId = s.data?.participantId;
    if (!participantId) continue;

    const entry = {
      participantId,
      socketId: s.id,
      name: s.data.name || "Guest",
      joinedAt: s.data.joinedAt || 0,
      connectedAt: s.data.connectedAt || 0,
    };

    const existing = byParticipant.get(participantId);
    if (!existing || entry.connectedAt > existing.connectedAt) {
      byParticipant.set(participantId, entry);
    }
  }

  return Array.from(byParticipant.values())
    // Stable ordering by join time, which also makes host selection deterministic.
    .sort(
      (a, b) =>
        a.joinedAt - b.joinedAt ||
        a.participantId.localeCompare(b.participantId)
    )
    .map(({ connectedAt, ...rest }) => rest);
}

/**
 * Broadcasts the current roster to everyone in the room.
 *
 * The host is whoever has been present longest, recomputed on every change so it
 * transfers automatically when the host leaves. Clients render this rather than
 * deciding for themselves — the previous version let every client conclude it was
 * the host, because each one only ever saw itself in its local participant list.
 */
async function broadcastParticipants(io, room) {
  const participants = await getParticipants(io, room);

  // Once everyone has gone, forget the room's join order so a later call reusing
  // the same code does not inherit stale host assignment.
  if (participants.length === 0) {
    await clearRoom(room);
    return;
  }

  io.to(room).emit("room:participants", {
    participants,
    hostId: participants[0]?.participantId || null,
  });
}

function sanitizeName(name) {
  if (typeof name !== "string") return "Guest";
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || "Guest";
}

/**
 * Attaches all signalling handlers to a Socket.IO server.
 * @param {import('socket.io').Server} io
 */
function registerHandlers(io) {
  io.on("connection", (socket) => {
    socket.data.chatTokens = CHAT_BURST;
    socket.data.chatRefillAt = Date.now();
    socket.data.connectedAt = Date.now();

    /**
     * Join a room. Acknowledged via callback so the client knows whether it got
     * in — the old code emitted an event that could never report failure, so a
     * full room looked identical to a successful join.
     *
     * @param {object} payload
     * @param {string} payload.room
     * @param {string} payload.name
     * @param {string} payload.participantId  Stable across reconnects.
     */
    socket.on("room:join", async (payload = {}, ack) => {
      const respond = typeof ack === "function" ? ack : () => {};
      const { room, name, participantId } = payload;

      if (!ROOM_CODE_PATTERN.test(room || "")) {
        return respond({ ok: false, error: "INVALID_ROOM_CODE" });
      }
      if (!PARTICIPANT_ID_PATTERN.test(participantId || "")) {
        return respond({ ok: false, error: "INVALID_PARTICIPANT_ID" });
      }

      try {
        const existing = await getParticipants(io, room);

        // A reconnecting participant is already on the roster, so it must not be
        // turned away by the capacity check for occupying its own slot.
        const isRejoin = existing.some(
          (p) => p.participantId === participantId
        );
        if (!isRejoin && existing.length >= MAX_PARTICIPANTS) {
          return respond({
            ok: false,
            error: "ROOM_FULL",
            max: MAX_PARTICIPANTS,
          });
        }

        socket.data.participantId = participantId;
        socket.data.name = sanitizeName(name);
        socket.data.room = room;

        // Join order comes from the server's own record, never from the client.
        // A reconnecting participant gets back the timestamp from their first
        // arrival, so host status survives the platform recycling their socket,
        // and nobody can claim host by sending an artificially old value.
        socket.data.joinedAt = await getOrSetJoinedAt(room, participantId);

        await socket.join(room);

        const participants = await getParticipants(io, room);

        respond({
          ok: true,
          participantId,
          socketId: socket.id,
          joinedAt: socket.data.joinedAt,
          participants,
          hostId: participants[0]?.participantId || null,
        });

        // Everyone (including the joiner) gets the new roster. Peers diff it
        // against what they have: genuinely new participants get a connection,
        // reconnected ones just get their socketId updated.
        await broadcastParticipants(io, room);
      } catch (err) {
        console.error("[signaling] room:join failed:", err);
        respond({ ok: false, error: "INTERNAL_ERROR" });
      }
    });

    /**
     * Relay a signalling payload (SDP description or ICE candidate) to one peer,
     * addressed by socket id.
     *
     * The payload is opaque here on purpose. The old protocol had a separate
     * event per message type (user:call, call:accepted, peer:nego:needed,
     * peer:nego:done, ice:candidate) which hard-coded a single call flow and made
     * the perfect-negotiation pattern impossible to express.
     */
    socket.on("signal", ({ to, data } = {}) => {
      if (!to || !data || !socket.data.room) return;
      io.to(to).emit("signal", {
        from: socket.id,
        fromParticipantId: socket.data.participantId,
        data,
      });
    });

    socket.on("chat:message", ({ text } = {}) => {
      const room = socket.data.room;
      if (!room || typeof text !== "string") return;

      const trimmed = text.trim();
      if (!trimmed) return;

      // Refill the bucket based on elapsed time, then spend a token.
      const now = Date.now();
      const elapsed = now - socket.data.chatRefillAt;
      if (elapsed > CHAT_REFILL_MS) {
        socket.data.chatTokens = Math.min(
          CHAT_BURST,
          socket.data.chatTokens + Math.floor(elapsed / CHAT_REFILL_MS)
        );
        socket.data.chatRefillAt = now;
      }
      if (socket.data.chatTokens <= 0) return;
      socket.data.chatTokens -= 1;

      // Echoed to the whole room including the sender, so message ordering is
      // the server's and everyone sees the same transcript. The old version
      // appended locally and sent separately, so two people typing at once saw
      // the messages in different orders.
      io.to(room).emit("chat:message", {
        from: socket.data.participantId,
        name: socket.data.name || "Guest",
        text: trimmed.slice(0, MAX_MESSAGE_LENGTH),
        timestamp: new Date().toISOString(),
      });
    });

    /**
     * Mute and camera state. WebRTC gives no reliable signal for "track disabled"
     * versus "track present but transmitting black", so peers must be told.
     */
    socket.on("media:state", ({ audio, video } = {}) => {
      const room = socket.data.room;
      if (!room) return;
      socket.to(room).emit("media:state", {
        from: socket.data.participantId,
        audio: Boolean(audio),
        video: Boolean(video),
      });
    });

    socket.on("reaction", ({ emoji } = {}) => {
      const room = socket.data.room;
      if (!room || typeof emoji !== "string" || emoji.length > 8) return;
      io.to(room).emit("reaction", {
        from: socket.data.participantId,
        name: socket.data.name || "Guest",
        emoji,
      });
    });

    socket.on("room:leave", async () => {
      const room = socket.data.room;
      if (!room) return;

      await socket.leave(room);
      socket.data.room = null;

      socket.to(room).emit("peer:left", {
        participantId: socket.data.participantId,
      });
      await broadcastParticipants(io, room);
    });

    // `disconnecting` fires while socket.rooms is still populated; by `disconnect`
    // the rooms are already gone and there would be nobody left to notify.
    //
    // Note this deliberately does NOT emit peer:left. A disconnect is ambiguous:
    // it may be someone closing the tab, or it may be the platform recycling a
    // WebSocket mid-call. Peers instead reconcile against the roster broadcast,
    // which reflects reality either way, and keep their media connections alive
    // through a transient reconnect.
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room === socket.id) continue;
        // Deferred so the socket has actually left before the roster is read.
        setImmediate(() => {
          broadcastParticipants(io, room).catch((err) =>
            console.error("[signaling] roster broadcast failed:", err)
          );
        });
      }
    });
  });
}

module.exports = {
  registerHandlers,
  getParticipants,
  MAX_PARTICIPANTS,
  ROOM_CODE_PATTERN,
};
