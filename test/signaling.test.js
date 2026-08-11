"use strict";

/**
 * Integration test for the signalling protocol.
 *
 * Runs a real Socket.IO server with real clients rather than mocking, because
 * everything worth testing here is about ordering and reconnection — exactly
 * what mocks paper over.
 *
 * Run with: npm run test:server
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { Server } = require("socket.io");
const { io: createClient } = require("socket.io-client");
const { registerHandlers, MAX_PARTICIPANTS } = require("../lib/signaling");

/** Starts a server on an ephemeral port. */
async function startServer() {
  const httpServer = http.createServer();
  const ioServer = new Server(httpServer, { cors: { origin: "*" } });
  registerHandlers(ioServer);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();

  return {
    url: `http://localhost:${port}`,
    async close() {
      ioServer.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function connect(url) {
  return createClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
}

/** Promisified room:join, since the handler acknowledges via callback. */
function join(client, payload) {
  return new Promise((resolve) => client.emit("room:join", payload, resolve));
}

/** Resolves with the next payload for `event`, or rejects on timeout. */
function nextEvent(client, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs
    );
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("two participants see each other in the roster", async (t) => {
  const server = await startServer();
  const alice = connect(server.url);
  const bob = connect(server.url);

  t.after(async () => {
    alice.close();
    bob.close();
    await server.close();
  });

  const aliceJoin = await join(alice, {
    room: "test-room",
    name: "Alice",
    participantId: "participant-alice",
  });

  assert.equal(aliceJoin.ok, true);
  assert.equal(aliceJoin.participants.length, 1);
  assert.equal(aliceJoin.hostId, "participant-alice", "first in is host");

  const aliceSeesRoster = nextEvent(alice, "room:participants");

  const bobJoin = await join(bob, {
    room: "test-room",
    name: "Bob",
    participantId: "participant-bob",
  });

  assert.equal(bobJoin.ok, true);
  assert.equal(bobJoin.participants.length, 2);
  assert.equal(bobJoin.hostId, "participant-alice", "host does not change");

  const roster = await aliceSeesRoster;
  assert.equal(roster.participants.length, 2);
  assert.deepEqual(
    roster.participants.map((p) => p.name).sort(),
    ["Alice", "Bob"]
  );
});

test("signalling payloads are relayed verbatim to the addressed peer", async (t) => {
  const server = await startServer();
  const alice = connect(server.url);
  const bob = connect(server.url);

  t.after(async () => {
    alice.close();
    bob.close();
    await server.close();
  });

  const aliceJoin = await join(alice, {
    room: "signal-room",
    name: "Alice",
    participantId: "participant-alice",
  });
  await join(bob, {
    room: "signal-room",
    name: "Bob",
    participantId: "participant-bob",
  });

  const received = nextEvent(alice, "signal");

  const offer = { description: { type: "offer", sdp: "v=0\r\n..." } };
  bob.emit("signal", { to: aliceJoin.socketId, data: offer });

  const payload = await received;
  assert.deepEqual(payload.data, offer, "payload must not be rewritten");
  assert.equal(payload.fromParticipantId, "participant-bob");
});

test("a room is capped at MAX_PARTICIPANTS", async (t) => {
  const server = await startServer();
  const clients = [];

  t.after(async () => {
    clients.forEach((c) => c.close());
    await server.close();
  });

  for (let i = 0; i < MAX_PARTICIPANTS; i += 1) {
    const client = connect(server.url);
    clients.push(client);
    const result = await join(client, {
      room: "full-room",
      name: `User ${i}`,
      participantId: `participant-${i}`,
    });
    assert.equal(result.ok, true, `participant ${i} should get in`);
  }

  const extra = connect(server.url);
  clients.push(extra);
  const rejected = await join(extra, {
    room: "full-room",
    name: "One too many",
    participantId: "participant-overflow",
  });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "ROOM_FULL");
  assert.equal(rejected.max, MAX_PARTICIPANTS);
});

test("rejoining with the same participant id keeps identity and host status", async (t) => {
  const server = await startServer();
  const alice = connect(server.url);
  const bob = connect(server.url);

  t.after(async () => {
    alice.close();
    bob.close();
    await server.close();
  });

  const first = await join(alice, {
    room: "rejoin-room",
    name: "Alice",
    participantId: "participant-alice",
  });
  await join(bob, {
    room: "rejoin-room",
    name: "Bob",
    participantId: "participant-bob",
  });

  // Simulate the platform recycling Alice's WebSocket mid-call: a brand new
  // connection reporting the same participant id and original join time.
  alice.close();
  const aliceAgain = connect(server.url);
  t.after(() => aliceAgain.close());

  const rejoined = await join(aliceAgain, {
    room: "rejoin-room",
    name: "Alice",
    participantId: "participant-alice",
  });

  assert.equal(rejoined.ok, true, "a rejoin must not be blocked as a new user");
  assert.equal(rejoined.joinedAt, first.joinedAt, "original join time is kept");
  assert.equal(rejoined.hostId, "participant-alice", "host status survives");

  const ids = rejoined.participants.map((p) => p.participantId).sort();
  assert.deepEqual(
    ids,
    ["participant-alice", "participant-bob"],
    "the reconnect must not leave a duplicate on the roster"
  );
});

test("a client cannot claim host by fabricating a join time", async (t) => {
  const server = await startServer();
  const alice = connect(server.url);
  const mallory = connect(server.url);

  t.after(async () => {
    alice.close();
    mallory.close();
    await server.close();
  });

  await join(alice, {
    room: "host-room",
    name: "Alice",
    participantId: "participant-alice",
  });

  const result = await join(mallory, {
    room: "host-room",
    name: "Mallory",
    participantId: "participant-mallory",
    // Long before Alice. The server records join order itself, so this field is
    // ignored entirely rather than merely range-checked.
    joinedAt: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.hostId,
    "participant-alice",
    "join order is the server's record, not the client's claim"
  );
  assert.ok(
    result.joinedAt > 1,
    "the claimed timestamp must not be written through"
  );
});

test("invalid room codes are rejected", async (t) => {
  const server = await startServer();
  const client = connect(server.url);

  t.after(async () => {
    client.close();
    await server.close();
  });

  for (const room of ["", "ab", "has spaces", "x".repeat(65)]) {
    const result = await join(client, {
      room,
      name: "Someone",
      participantId: "participant-someone",
    });
    assert.equal(result.ok, false, `"${room}" should be rejected`);
    assert.equal(result.error, "INVALID_ROOM_CODE");
  }
});

test("chat messages are broadcast to the whole room including the sender", async (t) => {
  const server = await startServer();
  const alice = connect(server.url);
  const bob = connect(server.url);

  t.after(async () => {
    alice.close();
    bob.close();
    await server.close();
  });

  await join(alice, {
    room: "chat-room",
    name: "Alice",
    participantId: "participant-alice",
  });
  await join(bob, {
    room: "chat-room",
    name: "Bob",
    participantId: "participant-bob",
  });

  const aliceCopy = nextEvent(alice, "chat:message");
  const bobCopy = nextEvent(bob, "chat:message");

  alice.emit("chat:message", { text: "  hello everyone  " });

  const [mine, theirs] = await Promise.all([aliceCopy, bobCopy]);

  assert.equal(mine.text, "hello everyone", "text is trimmed");
  assert.equal(mine.from, "participant-alice");
  assert.deepEqual(
    mine,
    theirs,
    "both sides receive an identical message, so ordering matches"
  );
});

test("leaving removes the participant and transfers host", async (t) => {
  const server = await startServer();
  const alice = connect(server.url);
  const bob = connect(server.url);

  t.after(async () => {
    alice.close();
    bob.close();
    await server.close();
  });

  await join(alice, {
    room: "leave-room",
    name: "Alice",
    participantId: "participant-alice",
  });
  await join(bob, {
    room: "leave-room",
    name: "Bob",
    participantId: "participant-bob",
  });

  const bobSeesDeparture = nextEvent(bob, "peer:left");
  const bobSeesRoster = nextEvent(bob, "room:participants");

  alice.emit("room:leave");

  const departure = await bobSeesDeparture;
  assert.equal(departure.participantId, "participant-alice");

  const roster = await bobSeesRoster;
  assert.equal(roster.participants.length, 1);
  assert.equal(
    roster.hostId,
    "participant-bob",
    "host transfers when the host leaves"
  );
});
