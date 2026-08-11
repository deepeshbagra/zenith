"use strict";

/**
 * Standalone signalling server for local development.
 *
 * In production the same handlers run inside a Vercel Function (api/socket-io.js).
 * Both entry points share lib/signaling.js so there is one implementation of the
 * protocol.
 */

const http = require("http");
const { Server } = require("socket.io");
const { registerHandlers } = require("../lib/signaling");
const { attachRedisAdapter } = require("../lib/adapter");

const PORT = process.env.PORT || 8000;

// Comma-separated list so preview deployments and localhost can both connect.
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

attachRedisAdapter(io);
registerHandlers(io);

server.listen(PORT, () => {
  console.log(`Signalling server listening on port ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  io.close(() => {
    server.close(() => process.exit(0));
  });
  // Don't hang forever if a socket refuses to close.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
