import { getIceServers } from "./iceServers";

/**
 * Wraps a single RTCPeerConnection to one remote participant.
 *
 * In a mesh call each participant holds one of these per other participant, so
 * a 4-person call means 3 instances on each client.
 *
 * Implements the W3C "perfect negotiation" pattern. Without it, two peers that
 * both fire `negotiationneeded` at the same moment (very common: both sides add
 * their camera track at once, or both start screen sharing) send offers that
 * collide, and one or both connections wedge in `have-local-offer` forever.
 * Perfect negotiation resolves the collision by designating one side "polite":
 * the polite peer rolls back its own offer and accepts the other's, while the
 * impolite peer ignores the incoming offer and keeps its own.
 *
 * See https://w3c.github.io/webrtc-pc/#perfect-negotiation-example
 */
export default class PeerConnection {
  /**
   * @param {object} options
   * @param {string} options.peerId          Remote participant's socket id.
   * @param {boolean} options.polite         Whether this side yields on collision.
   *                                         Must be the exact opposite on the two
   *                                         ends, so it is derived by comparing ids.
   * @param {MediaStream|null} options.localStream Local camera/mic to publish.
   * @param {(data: object) => void} options.onSignal     Send signalling payload to the peer.
   * @param {(stream: MediaStream) => void} options.onRemoteStream Remote media arrived.
   * @param {(state: string) => void} [options.onStateChange]      Connection state changed.
   */
  constructor({
    peerId,
    polite,
    localStream,
    onSignal,
    onRemoteStream,
    onStateChange,
  }) {
    this.peerId = peerId;
    this.polite = polite;
    this.onSignal = onSignal;
    this.onRemoteStream = onRemoteStream;
    this.onStateChange = onStateChange || (() => {});

    // Perfect negotiation bookkeeping.
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;

    // ICE candidates can arrive before the remote description is set (the peer's
    // offer and its first candidates race each other over the socket).
    // addIceCandidate() rejects in that window, so they are buffered and flushed
    // once a remote description exists.
    this.pendingCandidates = [];

    // Tracks whether close() has run, so late-arriving async callbacks become no-ops.
    this.closed = false;

    this.remoteStream = new MediaStream();
    this.pc = new RTCPeerConnection({ iceServers: getIceServers() });

    this.#wireEvents();

    if (localStream) {
      this.setLocalStream(localStream);
    } else {
      // With no local media there are no tracks, so `negotiationneeded` would
      // never fire and this side could never offer. If the other side's offer
      // were then lost, the connection would sit in "connecting" forever with
      // nothing to recover it — exactly what happens to someone who joins when
      // their camera is unavailable.
      //
      // Declaring recvonly transceivers gives the connection something to
      // negotiate, so both ends drive the handshake regardless of media.
      this.pc.addTransceiver("audio", { direction: "recvonly" });
      this.pc.addTransceiver("video", { direction: "recvonly" });
    }
  }

  #wireEvents() {
    const pc = this.pc;

    pc.onnegotiationneeded = async () => {
      if (this.closed) return;
      try {
        this.makingOffer = true;
        // Argument-less setLocalDescription() lets the browser pick offer vs
        // answer and, critically, performs implicit rollback when needed.
        await pc.setLocalDescription();
        this.onSignal({ description: pc.localDescription });
      } catch (err) {
        console.error(`[peer ${this.peerId}] negotiation failed:`, err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (this.closed || !candidate) return;
      this.onSignal({ candidate });
    };

    pc.ontrack = ({ track, streams }) => {
      if (this.closed) return;
      // Prefer the stream the sender grouped the track into; fall back to our
      // own container so audio and video still land in one MediaStream.
      const stream = streams[0] || this.remoteStream;
      if (stream === this.remoteStream) {
        this.remoteStream.addTrack(track);
      } else {
        this.remoteStream = stream;
      }
      this.onRemoteStream(this.remoteStream);
    };

    // Surfaced because a stalled connection is otherwise invisible: the UI just
    // says "Connecting…" with no indication of which stage is failing.
    pc.oniceconnectionstatechange = () => {
      if (this.closed) return;
      console.log(
        `[peer ${this.peerId}] ice=${pc.iceConnectionState} gathering=${pc.iceGatheringState}`
      );
      this.onStateChange(pc.connectionState);
    };

    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      const state = pc.connectionState;
      console.log(`[peer ${this.peerId}] connection=${state}`);
      this.onStateChange(state);

      // "failed" means ICE gave up. An ICE restart re-gathers candidates and is
      // usually enough to recover from a network change (wifi -> cellular).
      if (state === "failed") {
        this.restartIce();
      }
    };
  }

  /**
   * Publishes the local stream. Replaces existing senders rather than adding
   * duplicates, so this is safe to call again when the camera changes.
   * @param {MediaStream} stream
   */
  setLocalStream(stream) {
    if (this.closed || !stream) return;

    for (const track of stream.getTracks()) {
      // Reuse an existing transceiver of the same kind — including the recvonly
      // ones created when there was no media — so turning a camera on later
      // reuses that m-line instead of adding a second one for the same kind.
      const transceiver = this.pc.getTransceivers().find((t) => {
        const kind = t.sender.track?.kind || t.receiver.track?.kind;
        return kind === track.kind && t.sender.track !== track;
      });

      if (transceiver) {
        transceiver.sender.replaceTrack(track);
        if (
          transceiver.direction === "recvonly" ||
          transceiver.direction === "inactive"
        ) {
          // Promote to sending; this does fire negotiationneeded, which is what
          // tells the other side to start expecting media.
          transceiver.direction = "sendrecv";
        }
      } else {
        this.pc.addTrack(track, stream);
      }
    }
  }

  /**
   * Swaps the outbound video track, used for screen share.
   *
   * replaceTrack() on an established sender does not trigger
   * `negotiationneeded`, which is what makes screen sharing feel instant.
   *
   * When there is no video sender yet — someone who joined without a camera and
   * then started presenting — the track is added instead, which does renegotiate.
   * That path is slower but it is the difference between screen share working
   * and silently doing nothing.
   *
   * @param {MediaStreamTrack|null} track
   */
  async replaceVideoTrack(track) {
    if (this.closed) return;

    const sender = this.pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (sender) {
      await sender.replaceTrack(track);
      return;
    }

    if (track) {
      this.pc.addTrack(track, new MediaStream([track]));
    }
  }

  /**
   * Handles an inbound signalling payload from the remote peer.
   * @param {{description?: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit}} data
   */
  async handleSignal(data) {
    if (this.closed) return;
    const pc = this.pc;

    try {
      if (data.description) {
        const description = data.description;

        // Are we in a state where accepting a remote offer is safe? Either we
        // are stable, or we are mid-way through applying an answer (which will
        // return us to stable imminently).
        const readyForOffer =
          !this.makingOffer &&
          (pc.signalingState === "stable" || this.isSettingRemoteAnswerPending);

        const offerCollision = description.type === "offer" && !readyForOffer;

        // The impolite peer wins collisions by discarding the incoming offer.
        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        this.isSettingRemoteAnswerPending = description.type === "answer";
        await pc.setRemoteDescription(description);
        this.isSettingRemoteAnswerPending = false;

        await this.#flushCandidates();

        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.onSignal({ description: pc.localDescription });
        }
      } else if (data.candidate) {
        // Buffer until a remote description exists, otherwise this throws.
        if (!pc.remoteDescription) {
          this.pendingCandidates.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          // Candidates belonging to an offer we deliberately ignored are
          // expected to fail; anything else is a real error.
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error(`[peer ${this.peerId}] failed to handle signal:`, err);
    }
  }

  async #flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!this.ignoreOffer) {
          console.error(`[peer ${this.peerId}] queued candidate failed:`, err);
        }
      }
    }
  }

  /**
   * Re-gathers ICE candidates after a network change. Only the impolite peer
   * initiates, so both sides don't restart simultaneously and collide again.
   */
  restartIce() {
    if (this.closed || this.polite) return;
    try {
      this.pc.restartIce();
    } catch (err) {
      console.error(`[peer ${this.peerId}] ICE restart failed:`, err);
    }
  }

  get connectionState() {
    return this.closed ? "closed" : this.pc.connectionState;
  }

  /**
   * A compact description of where the handshake has got to.
   * Rendered on the tile in development so a stall is diagnosable from the
   * screen rather than only from the console.
   */
  get debugState() {
    if (this.closed) return "closed";
    return [
      `sig:${this.pc.signalingState}`,
      `ice:${this.pc.iceConnectionState}`,
      `gather:${this.pc.iceGatheringState}`,
    ].join(" ");
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;

    this.pc.close();
    this.pendingCandidates = [];
  }
}
