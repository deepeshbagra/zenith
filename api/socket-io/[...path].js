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
 * which is every request Socket.IO actually makes.
 *
 * Even as a catch-all, Vercel resolves only a single path segment here:
 * /api/socket-io/one reaches this function, /api/socket-io/one/two does not.
 * Socket.IO's URL has two ("socket.io" plus the trailing slash it always
 * appends), so it can never be routed directly. vercel.json therefore sends all
 * Socket.IO traffic to the single-segment /api/socket-io/conn, and the
 * interceptor below restores the URL Socket.IO expects before anything reads it.
 */

const http = require("http");
const { Server } = require("socket.io");
const { registerHandlers } = require("../../lib/signaling");
const { attachRedisAdapter } = require("../../lib/adapter");

// The public path clients connect on. Deliberately outside /api: Vercel would
// not match any two-segment path under /api/socket-io, and Socket.IO always
// appends a trailing slash, so its URL is always two segments.
const SOCKET_PATH = "/rtc";

// The single-segment path vercel.json routes that traffic to, which is the only
// shape Vercel will resolve to this function.
const ROUTED_PATH = "/api/socket-io/conn";

const server = http.createServer();

/**
 * Rewrites the routed URL back to the path Socket.IO matches on.
 *
 * This wraps emit() rather than adding a request listener because Engine.IO
 * takes over the server's "request" listeners when it attaches, and decides
 * whether a request is its own before any of them run. Intercepting the emit is
 * the only place guaranteed to see the request first — and it covers "upgrade"
 * too, which is the event that actually matters for WebSockets.
 */
const originalEmit = server.emit.bind(server);
server.emit = (event, ...args) => {
  if (event === "request" || event === "upgrade") {
    const req = args[0];
    if (req && typeof req.url === "string" && req.url.startsWith(ROUTED_PATH)) {
      const remainder = req.url.slice(ROUTED_PATH.length).replace(/^\/+/, "");
      req.url = `${SOCKET_PATH}/${remainder}`;
    }
  }
  return originalEmit(event, ...args);
};

const io = new Server(server, {
  path: SOCKET_PATH,
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
