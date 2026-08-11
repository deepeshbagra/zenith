"use strict";

/**
 * Signalling server as a Vercel Function.
 *
 * Vercel Functions can hold open WebSocket connections on Fluid Compute: the
 * upgrade is handled by exporting an http.Server, exactly as you would for any
 * self-hosted Socket.IO deployment.
 *
 * Two platform constraints shape this:
 *
 * 1. No instance affinity. A reconnect, or simply a second visitor, may land on
 *    a different instance. All shared state therefore lives in Redis via the
 *    adapter — see lib/adapter.js. Nothing here may hold room state in memory.
 *
 * 2. Connections close when the function hits its max duration (300s on Hobby).
 *    This is survivable for a video call because media is peer-to-peer and keeps
 *    flowing after signalling drops, but the client must reconnect and re-sync
 *    its roster. The client handles that in SocketProvider.
 *
 * The client must connect with path "/api/socket-io/socket.io" — Socket.IO
 * appends its own "/socket.io" suffix to the function's route — and must use the
 * websocket transport, since Socket.IO's default HTTP long-polling does not work
 * here.
 *
 * This file is a catch-all ([...path]) on purpose. Vercel routes only the exact
 * path of a function file, so a plain api/socket-io.js received requests for
 * "/api/socket-io" but returned NOT_FOUND for "/api/socket-io/socket.io/…" —
 * which is every request Socket.IO actually makes. The catch-all claims the
 * whole subtree, and req.url keeps the original path so Socket.IO's own path
 * matching still works.
 */

const http = require("http");
const { Server } = require("socket.io");
const { registerHandlers } = require("../../lib/signaling");
const { attachRedisAdapter } = require("../../lib/adapter");

const server = http.createServer();

const io = new Server(server, {
  path: "/api/socket-io/socket.io",
  // Same-origin in production (the client is served from this deployment), so
  // CORS only needs to be opened up for local development against a deployed
  // signalling server.
  cors: {
    origin: (process.env.CLIENT_URL || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket"],
  // Keep well under the platform's connection ceiling so the client sees a clean
  // close and reconnects, rather than a silently dead socket.
  pingInterval: 25000,
  pingTimeout: 20000,
});

attachRedisAdapter(io);
registerHandlers(io);

module.exports = server;
