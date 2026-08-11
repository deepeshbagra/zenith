# Zenith

Peer-to-peer video calling for up to five people. Audio and video travel directly
between browsers over WebRTC; the server only relays the messages needed to set
each connection up, and never sees the media.

Built with React and a Socket.IO signalling server that runs either standalone or
as a Vercel Function.

---

## Contents

- [How a call is established](#how-a-call-is-established)
- [Architecture](#architecture)
- [Accounts and history](#accounts-and-history)
- [The interesting problems](#the-interesting-problems)
- [Running locally](#running-locally)
- [Configuration](#configuration)
- [Deploying to Vercel](#deploying-to-vercel)
- [Tests](#tests)
- [Limits and what would come next](#limits-and-what-would-come-next)

---

## How a call is established

```
  Alice's browser                Signalling server              Bob's browser
        │                              │                              │
        │──── room:join ──────────────>│                              │
        │<─── roster + host ───────────│                              │
        │                              │<──────────── room:join ──────│
        │<─── roster (Alice, Bob) ─────│───── roster (Alice, Bob) ───>│
        │                              │                              │
        │   both sides now create an RTCPeerConnection and attach     │
        │   their local tracks, which fires `negotiationneeded`       │
        │                              │                              │
        │──── signal {offer} ─────────>│───── signal {offer} ────────>│
        │<─── signal {answer} ─────────│<──── signal {answer} ────────│
        │──── signal {candidate} ─────>│───── signal {candidate} ────>│
        │<─── signal {candidate} ──────│<──── signal {candidate} ─────│
        │                              │                              │
        │<════════ audio and video, peer-to-peer, no server ═════════>│
```

Notice there is no "who calls whom" handshake. Both sides start negotiating at
once and the collision is resolved by the perfect-negotiation pattern, described
below.

## Architecture

```
client/src/
  service/
    PeerConnection.js   One RTCPeerConnection to one remote peer.
                        Perfect negotiation + ICE candidate queueing.
    MeshSession.js      Map of participantId -> PeerConnection.
                        Roster reconciliation, screen-share track swaps.
    identity.js         Stable per-tab participant id.
    iceServers.js       STUN/TURN configuration.
    auth.js             Local account store, PBKDF2-hashed passwords.
    history.js          Per-account record of meetings joined.
    roomCode.js         Readable room codes, no ambiguous characters.
  context/
    SocketProvider.jsx  Socket.IO connection + reconnect status.
    MediaProvider.jsx   The single local camera/mic stream, app-wide.
    AuthProvider.jsx    Session state.
  hooks/
    useRoom.js          Ties socket + mesh + media into one call lifecycle.
    useAudioLevel.js    Active-speaker detection via Web Audio.
  components/
    VideoTile.jsx       One participant's video.
    Chat.jsx            In-call chat.
    RequireAuth.jsx     Route guard.
  screens/
    Preview.jsx         Pre-join: pick devices, check your camera.
    Room.jsx            The call.
    Dashboard.jsx       Landing page, start or join a meeting.
    Login.jsx           Sign in / create account.
    History.jsx         Meetings joined, with join times.
    Meetings.jsx        Schedule meetings, stored locally.
    Support.jsx         Help and troubleshooting.
  styles/
    tokens.css          Every colour, space and radius in the app.

lib/
  signaling.js          The protocol. Shared by both server entry points.
  adapter.js            Optional Redis adapter for Socket.IO.
  roomStore.js          Server-authoritative record of room join order.

server/index.js         Standalone server, for local development.
api/socket-io.js        The same handlers as a Vercel Function.
test/signaling.test.js  Integration tests against a real server.
```

### Topology: full mesh

Every participant connects directly to every other one. With N people that is
N-1 connections each and N(N-1)/2 in total.

```
  2 people        3 people           4 people
    A─B            A───B              A───B
                    ╲ ╱               │╲ ╱│
                     C                │ ╳ │
                                      │╱ ╲│
                                      D───C
```

Mesh needs no media server at all, which is why a 1-on-1 or small group call can
run on nothing but a signalling relay. The cost is that each client uploads its
video once per peer, so upload bandwidth grows linearly with participants. That
is what caps rooms at five. Going further means an SFU — see
[what would come next](#limits-and-what-would-come-next).

## Accounts and history

Creating a meeting requires an account. Joining one from a shared invite link
does not — a guest is asked for a display name on the pre-join screen and
prompted to sign up after the call ends. Gating invite links would defeat the
one flow the whole app is built around.

Signing in also unlocks meeting history: every room you join is recorded with
the time you joined it, and the Overview stat cards are computed from those
records rather than being hardcoded.

### On the auth, plainly

There is no backend user database in this project, so **accounts live in the
browser's localStorage**.

Passwords are not stored. Each account keeps a random 16-byte salt and a
PBKDF2-SHA256 derivation at 210,000 iterations (WebCrypto), and signing in
re-derives and compares in constant time. Reading the stored data does not
reveal the password, and two accounts sharing a password get different hashes.
`auth.test.js` asserts all of that, including that the password never appears
anywhere in storage.

**It is still not authentication in any meaningful sense.** Anyone with access
to the browser profile can read, clear, or replace the account store; nothing is
verified by a server; and the room itself remains open to anyone holding the
code. It demonstrates the flow and the password-handling practice, not a
security boundary. Real auth needs a server that holds the hash and issues a
session token the client cannot forge — that is listed under
[what would come next](#limits-and-what-would-come-next).

History is per-account and per-browser for the same reason. Meetings joined on
another device will not appear, and the empty state says so.

## The interesting problems

### Perfect negotiation

When both peers attach their camera at the same moment, both fire
`negotiationneeded` and both send an offer. Each then receives an offer while
already having a local offer pending, which is an invalid state transition — and
the connection wedges in `have-local-offer` forever.

The fix is to designate one side "polite" ([W3C perfect
negotiation](https://w3c.github.io/webrtc-pc/#perfect-negotiation-example)). On
collision the polite peer rolls back its own offer and accepts the other's; the
impolite peer ignores the incoming offer and proceeds with its own. Politeness
has to be opposite on the two ends, so it is derived by comparing the two
participant ids — both sides compute the same answer with no extra round trip.

See `PeerConnection.js`.

### ICE candidates that arrive too early

`addIceCandidate()` rejects if there is no remote description yet, and an offer
races its own first candidates over the socket. Candidates arriving in that
window are buffered and flushed once the remote description lands.

### Surviving a dropped signalling connection

Vercel closes a WebSocket when the function reaches its max duration — 300s on
Hobby — so a long call reconnects repeatedly. The media itself is peer-to-peer
and keeps flowing throughout, but `socket.id` changes on every reconnect. Keyed
by socket id, each reconnect would look like that person left and a stranger
joined, tearing down and rebuilding every connection in the room.

So participants are keyed by a stable client-generated `participantId`, and a
reconnect becomes a routing update rather than a rejoin. A peer that vanishes
from the roster is also given a ten-second grace period before teardown, so a
reconnecting participant reclaims its existing connection instead of
renegotiating from scratch.

### Room state across function instances

Socket.IO keeps room membership in one process's memory. Vercel Functions run
many instances with no affinity between connections, so two people joining the
same room can land on different instances and never see each other — and it
works fine in testing with one instance. The Redis adapter gives every instance a
shared view; `REDIS_URL` is therefore required in production and optional
locally.

### Why TURN matters

STUN only tells a peer its public address. When both participants are behind
symmetric NAT — common on corporate networks and mobile carriers — neither can
accept an inbound connection and the call hangs in "connecting" with no error.
A TURN server relays the media in that case. Without one, expect roughly 15-20%
of real-world calls to fail while working perfectly between two tabs on one
machine.

## Running locally

Requires Node 20+.

```bash
npm install
npm install --prefix client

cp .env.example .env      # optional for local dev; defaults work

npm run dev               # signalling server on :8000, client on :3000
```

Then open <http://localhost:3000>.

To test a call on one machine, open the room in **two separate tabs**. The
participant id is stored per tab in `sessionStorage`, so two tabs count as two
people. Two windows of the same profile work too; two tabs is enough.

Individual processes, if you want them in separate terminals:

```bash
npm run dev:server
npm run dev:client
```

## Configuration

All variables are documented in `.env.example`. Anything prefixed `REACT_APP_` is
compiled into the client bundle and is therefore public.

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `REDIS_URL` | server | **on Vercel** | Shared room state across function instances |
| `CLIENT_URL` | server | no | Allowed CORS origins, comma separated |
| `PORT` | server | no | Standalone server port (default 8000) |
| `REACT_APP_SOCKET_URL` | client | no | Override the signalling URL; unset means same-origin |
| `REACT_APP_TURN_URL` | client | recommended | TURN server, for calls across restrictive networks |
| `REACT_APP_TURN_USERNAME` | client | with TURN | TURN username |
| `REACT_APP_TURN_CREDENTIAL` | client | with TURN | TURN credential |

## Deploying to Vercel

The client and the signalling server deploy together as one project. `vercel.json`
builds the client to `client/build` and exposes `api/socket-io.js` as a function
holding the WebSocket connections.

1. **Provision Redis.** From the Vercel Marketplace (Upstash Redis works well).
   Use the **TCP** connection URL, not the REST one — the Socket.IO adapter
   speaks the Redis protocol. Set it as `REDIS_URL`.

2. **Set TURN credentials** as `REACT_APP_TURN_*`, or accept that calls will fail
   for some users.

3. **Deploy.**

   ```bash
   vercel deploy --prod
   ```

The client automatically connects to `/api/socket-io/socket.io` on its own origin
in production, so no URL configuration is needed.

Two platform details worth knowing:

- Socket.IO must use the `websocket` transport. Its default HTTP long-polling
  does not work through the function's upgrade path.
- Connections close at the function's max duration (300s on Hobby, up to 800s on
  Pro). This is expected and handled — see [surviving a dropped signalling
  connection](#surviving-a-dropped-signalling-connection).

## Tests

```bash
npm test           # server integration tests, then client tests
npm run test:server
```

The signalling tests run a real Socket.IO server with real clients rather than
mocks, because what matters here is ordering and reconnection behaviour — exactly
what mocks hide. They cover roster propagation, opaque signal relay, room
capacity, reconnect identity, host election, input validation, and chat ordering.

## Limits and what would come next

**Known limits**

- Five participants per room. Mesh upload bandwidth is the binding constraint.
- Accounts are browser-local and unverified — see
  [on the auth, plainly](#on-the-auth-plainly). Rooms are open to anyone with
  the code regardless of who is signed in.
- History is per-browser. Meetings joined elsewhere do not appear.
- Rooms are ephemeral. Nothing about a call itself is persisted after everyone
  leaves.

**Next steps, roughly in order of value**

1. **A real backend for accounts** — server-held password hashes and a signed
   session token, which is what would turn the current flow into actual auth and
   make history follow you across devices.
2. **An SFU** (mediasoup or LiveKit) to lift the participant cap. Each client
   would upload once and the server would fan out, changing bandwidth from
   linear to constant per client.
3. **Private rooms**, once accounts mean something: restrict a room to invited
   accounts rather than to whoever holds the code.
4. **Simulcast + adaptive bitrate**, so a participant on a weak connection
   degrades rather than freezing.
