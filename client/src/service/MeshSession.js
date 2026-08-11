import PeerConnection from "./PeerConnection";

/**
 * Maximum participants per room.
 *
 * This app uses a full mesh: every participant connects directly to every other,
 * so a room of N people means N-1 connections each and N*(N-1)/2 in total. Each
 * client's upload bandwidth grows linearly with the number of peers, which is
 * what caps this at ~5. Beyond that you need an SFU (mediasoup, LiveKit) so each
 * client uploads once and the server fans it out.
 */
export const MAX_PARTICIPANTS = 5;

/**
 * How long a peer may be missing from the roster before its connection is torn
 * down.
 *
 * A peer disappears from the roster both when they genuinely leave and when the
 * platform recycles their WebSocket mid-call. The media connection survives the
 * latter untouched, so tearing down immediately would cause a pointless video
 * freeze and full renegotiation every time Vercel hits its function duration
 * limit. Waiting a few seconds lets a reconnecting peer reclaim its connection.
 */
const PEER_REMOVAL_GRACE_MS = 10000;

/**
 * Owns the set of peer connections for one room.
 *
 * Deliberately framework-agnostic: it knows nothing about React and talks to the
 * outside world through the callbacks passed to the constructor. That keeps the
 * negotiation logic testable without mounting a component.
 *
 * Peers are keyed by their stable `participantId`, never by socket id — see the
 * identity note in lib/signaling.js.
 */
export default class MeshSession {
  /**
   * @param {object} options
   * @param {string} options.selfId  Our own participantId.
   * @param {(socketId: string, data: object) => void} options.onSignal Send a payload to one peer.
   * @param {(peers: Array) => void} options.onPeersChanged Called with the current peer snapshot.
   */
  constructor({ selfId, onSignal, onPeersChanged }) {
    this.selfId = selfId;
    this.onSignal = onSignal;
    this.onPeersChanged = onPeersChanged;

    /** @type {Map<string, object>} keyed by participantId */
    this.peers = new Map();

    /** @type {Map<string, number>} participantId -> removal timer id */
    this.removalTimers = new Map();

    /**
     * Signals that arrived before we knew about the sender.
     *
     * A peer's offer and the roster broadcast announcing them are separate
     * messages with no ordering guarantee, so the offer can arrive first.
     * Dropping it used to be recoverable only because both sides re-offered;
     * a participant with no local media has nothing to re-offer, so a dropped
     * offer stranded the connection permanently.
     *
     * @type {Map<string, object[]>} participantId -> queued payloads
     */
    this.pendingSignals = new Map();

    this.localStream = null;
    this.closed = false;
  }

  /**
   * Publishes a snapshot of peer state to the UI. A new array each time so React
   * sees an identity change.
   */
  #emit() {
    if (this.closed) return;
    const snapshot = Array.from(this.peers.entries()).map(([id, peer]) => ({
      id,
      socketId: peer.socketId,
      name: peer.name,
      stream: peer.stream,
      state: peer.state,
      audioEnabled: peer.audioEnabled,
      videoEnabled: peer.videoEnabled,
      debugState: peer.connection.debugState,
    }));
    this.onPeersChanged(snapshot);
  }

  /**
   * Adds a participant and immediately begins connecting.
   *
   * Note there is no explicit "who calls whom" handshake. Both sides construct a
   * connection and attach their local tracks, which fires `negotiationneeded` on
   * both. Perfect negotiation inside PeerConnection resolves the resulting offer
   * collision, so the connection converges regardless of join order or timing.
   *
   * @param {{participantId: string, socketId: string, name: string}} participant
   */
  addPeer({ participantId, socketId, name }) {
    if (this.closed || participantId === this.selfId) return;

    // The peer is back before its grace period expired — cancel the teardown.
    this.#cancelRemoval(participantId);

    const existing = this.peers.get(participantId);
    if (existing) {
      // Already connected. This is a reconnect or a plain roster refresh: update
      // the routing address and name, but leave the live media connection alone.
      existing.socketId = socketId;
      existing.name = name || existing.name;
      this.#emit();
      return;
    }

    if (this.peers.size + 1 >= MAX_PARTICIPANTS) {
      console.warn(
        `[mesh] room is at capacity (${MAX_PARTICIPANTS}), ignoring ${participantId}`
      );
      return;
    }

    // Politeness must be exactly opposite on the two ends. Comparing the two
    // participant ids gives both sides the same answer with no extra round trip.
    const polite = this.selfId < participantId;

    const peer = {
      socketId,
      name: name || "Guest",
      stream: null,
      state: "new",
      audioEnabled: true,
      videoEnabled: true,
      connection: null,
    };

    peer.connection = new PeerConnection({
      peerId: participantId,
      polite,
      localStream: this.localStream,
      // Resolved at send time, so signals follow the peer across a reconnect.
      onSignal: (data) => {
        const current = this.peers.get(participantId);
        if (current) this.onSignal(current.socketId, data);
      },
      onRemoteStream: (stream) => {
        const current = this.peers.get(participantId);
        if (!current) return;
        current.stream = stream;
        this.#emit();
      },
      onStateChange: (state) => {
        const current = this.peers.get(participantId);
        if (!current) return;
        current.state = state;
        this.#emit();
      },
    });

    this.peers.set(participantId, peer);

    // Deliver anything that arrived before this peer was known.
    const queued = this.pendingSignals.get(participantId);
    if (queued) {
      this.pendingSignals.delete(participantId);
      for (const data of queued) {
        peer.connection.handleSignal(data);
      }
    }

    this.#emit();
  }

  /**
   * Tears down and forgets a participant immediately.
   * @param {string} participantId
   */
  removePeer(participantId) {
    this.#cancelRemoval(participantId);
    this.pendingSignals.delete(participantId);
    const peer = this.peers.get(participantId);
    if (!peer) return;
    peer.connection.close();
    this.peers.delete(participantId);
    this.#emit();
  }

  #cancelRemoval(participantId) {
    const timer = this.removalTimers.get(participantId);
    if (timer) {
      clearTimeout(timer);
      this.removalTimers.delete(participantId);
    }
  }

  #scheduleRemoval(participantId) {
    if (this.removalTimers.has(participantId)) return;
    const timer = setTimeout(() => {
      this.removalTimers.delete(participantId);
      this.removePeer(participantId);
    }, PEER_REMOVAL_GRACE_MS);
    this.removalTimers.set(participantId, timer);
  }

  /**
   * Reconciles the peer set against an authoritative roster from the server.
   *
   * Called on join and on every roster change. Peers still present keep their
   * live connection untouched; new peers get connected; missing peers are only
   * scheduled for removal, giving a reconnecting participant time to return.
   *
   * @param {Array<{participantId: string, socketId: string, name: string}>} participants
   */
  syncParticipants(participants) {
    if (this.closed) return;

    const present = new Set(
      participants
        .map((p) => p.participantId)
        .filter((id) => id !== this.selfId)
    );

    for (const participantId of this.peers.keys()) {
      if (!present.has(participantId)) {
        this.#scheduleRemoval(participantId);
      }
    }

    for (const participant of participants) {
      if (participant.participantId === this.selfId) continue;
      this.addPeer(participant);
    }
  }

  /**
   * Records a peer's self-reported mute / camera state for display.
   * @param {string} participantId
   * @param {{audio: boolean, video: boolean}} state
   */
  setPeerMediaState(participantId, { audio, video }) {
    const peer = this.peers.get(participantId);
    if (!peer) return;
    peer.audioEnabled = audio;
    peer.videoEnabled = video;
    this.#emit();
  }

  /**
   * Routes an inbound signalling payload to the right connection.
   * @param {string} fromParticipantId
   * @param {object} data
   */
  handleSignal(fromParticipantId, data) {
    if (this.closed) return;

    const peer = this.peers.get(fromParticipantId);

    if (!peer) {
      // The signal beat the roster broadcast. Queue it rather than dropping it;
      // addPeer flushes the queue as soon as the roster catches up.
      const queued = this.pendingSignals.get(fromParticipantId) || [];

      // Bounded, so a peer that never appears cannot grow this without limit.
      if (queued.length < 32) {
        queued.push(data);
        this.pendingSignals.set(fromParticipantId, queued);
      }
      return;
    }

    peer.connection.handleSignal(data);
  }

  /**
   * Sets or swaps the local camera/mic stream across every connection.
   * @param {MediaStream} stream
   */
  setLocalStream(stream) {
    this.localStream = stream;
    for (const peer of this.peers.values()) {
      peer.connection.setLocalStream(stream);
    }
  }

  /**
   * Swaps the outbound video track on every connection, for screen share.
   * @param {MediaStreamTrack} track
   */
  async replaceVideoTrack(track) {
    await Promise.all(
      Array.from(this.peers.values()).map((peer) =>
        peer.connection.replaceVideoTrack(track)
      )
    );
  }

  get size() {
    return this.peers.size;
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    for (const timer of this.removalTimers.values()) {
      clearTimeout(timer);
    }
    this.removalTimers.clear();

    for (const peer of this.peers.values()) {
      peer.connection.close();
    }
    this.peers.clear();
    this.pendingSignals.clear();
  }
}
