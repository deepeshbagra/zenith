import React, { useEffect, useRef } from "react";
import { useAudioLevel } from "../hooks/useAudioLevel";
import "./VideoTile.css";

const CONNECTING_STATES = new Set(["new", "connecting", "checking"]);

/**
 * One participant's video, local or remote.
 *
 * @param {object} props
 * @param {MediaStream|null} props.stream
 * @param {string} props.name
 * @param {boolean} [props.isLocal]
 * @param {boolean} [props.isHost]
 * @param {boolean} [props.audioEnabled]
 * @param {boolean} [props.videoEnabled]
 * @param {boolean} [props.isScreenSharing]
 * @param {string} [props.connectionState]  RTCPeerConnection state, remote only.
 */
const VideoTile = ({
  stream,
  name,
  isLocal = false,
  isHost = false,
  audioEnabled = true,
  videoEnabled = true,
  isScreenSharing = false,
  connectionState,
  debugState,
}) => {
  const videoRef = useRef(null);

  // Analysing our own microphone locally would also work, but it is the one
  // stream we know is not being played back, so it costs nothing extra.
  const isSpeaking = useAudioLevel(stream, audioEnabled);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    el.srcObject = stream || null;

    if (stream) {
      // autoPlay usually covers this, but an explicit play() recovers the tile
      // when a stream is swapped into an element the browser had paused.
      el.play().catch((err) => {
        if (err.name !== "AbortError") {
          console.error(`[tile] could not play ${name}'s video:`, err);
        }
      });
    }
  }, [stream, name]);

  const isConnecting = !isLocal && CONNECTING_STATES.has(connectionState);
  const isReconnecting = !isLocal && connectionState === "disconnected";
  const hasFailed = !isLocal && connectionState === "failed";
  const showPlaceholder = !stream || !videoEnabled;

  return (
    <div
      className={`video-tile${isSpeaking ? " speaking" : ""}${
        isScreenSharing ? " screen-share" : ""
      }`}
    >
      <video
        ref={videoRef}
        className="video-tile-media"
        autoPlay
        playsInline
        // Never play our own microphone back through the speakers.
        muted={isLocal}
      />

      {showPlaceholder && (
        <div className="video-tile-placeholder">
          <div className="video-tile-avatar">
            {(name || "?").charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {(isConnecting || isReconnecting || hasFailed) && (
        <div className="video-tile-status">
          {hasFailed ? (
            <span className="video-tile-status-failed">Connection failed</span>
          ) : (
            <>
              <span className="video-tile-spinner" />
              {isReconnecting ? "Reconnecting…" : "Connecting…"}
            </>
          )}

          {/* Development only: shows which stage of the handshake is stuck. */}
          {process.env.NODE_ENV === "development" && debugState && (
            <span className="video-tile-debug">{debugState}</span>
          )}
        </div>
      )}

      <div className="video-tile-footer">
        <span className="video-tile-name">
          {isLocal ? `${name} (You)` : name}
          {isHost && <span className="video-tile-badge">Host</span>}
          {isScreenSharing && (
            <span className="video-tile-badge">Presenting</span>
          )}
        </span>

        {!audioEnabled && (
          <span className="video-tile-muted" title="Muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 9l4 6m0-6l-4 6"
              />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
};

export default VideoTile;
