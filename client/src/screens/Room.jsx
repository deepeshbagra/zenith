import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMedia } from "../context/MediaProvider";
import { useAuth } from "../context/AuthProvider";
import { useRoom } from "../hooks/useRoom";
import { getDisplayName } from "../service/identity";
import VideoTile from "../components/VideoTile";
import Chat from "../components/Chat";
import "./Room.css";

const REACTIONS = ["👍", "❤️", "😂", "😮", "🎉", "👏"];

const RoomPage = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const { isSignedIn } = useAuth();

  const {
    stream,
    isAudioMuted,
    isVideoOff,
    readyToJoin,
    toggleAudio,
    toggleVideo,
    stopStream,
  } = useMedia();

  const {
    selfId,
    peers,
    roster,
    hostId,
    joinState,
    joinError,
    socketStatus,
    hasTurn,
    messages,
    reactions,
    sendMessage,
    sendReaction,
    replaceVideoTrack,
    leave,
  } = useRoom(roomId);

  const [activePanel, setActivePanel] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [toast, setToast] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // The camera track displaced by screen sharing, kept so it can be restored.
  const cameraTrackRef = useRef(null);
  // Set once the user has chosen to leave, so the "no stream" guard below does
  // not bounce them to the pre-join screen the moment the camera is released.
  const isLeavingRef = useRef(false);

  const displayName = getDisplayName() || "You";
  const isScreenSharing = Boolean(screenStream);

  // Someone landing on /room/:id directly hasn't chosen a name or checked their
  // devices yet, so send them through the pre-join screen.
  //
  // This keys off the explicit intent to join rather than off having a stream.
  // Testing for a stream meant anyone whose camera was busy or blocked got
  // bounced straight back out, with no way into the call at all.
  useEffect(() => {
    if (!readyToJoin && !isLeavingRef.current) {
      navigate(`/preview/${roomId}`, { replace: true });
    }
  }, [readyToJoin, roomId, navigate]);

  // Unread badge while the chat panel is closed.
  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (activePanel !== "chat" && !latest.isOwn) {
      setUnreadCount((n) => n + 1);
    }
  }, [messages, activePanel]);

  useEffect(() => {
    if (activePanel === "chat") setUnreadCount(0);
  }, [activePanel]);

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // Reading the current capture from a ref rather than inside a state updater:
  // stopping tracks is a side effect, and StrictMode double-invokes updaters.
  const screenStreamRef = useRef(null);

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);

    if (cameraTrackRef.current) {
      await replaceVideoTrack(cameraTrackRef.current);
      cameraTrackRef.current = null;
    }
  }, [replaceVideoTrack]);

  const startScreenShare = useCallback(async () => {
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = captured.getVideoTracks()[0];

      cameraTrackRef.current = stream?.getVideoTracks()[0] || null;

      // replaceTrack() swaps the outbound video on every peer connection without
      // renegotiating, which is what makes the switch feel instant.
      await replaceVideoTrack(screenTrack);
      screenStreamRef.current = captured;
      setScreenStream(captured);

      // Fired when the user stops sharing from the browser's own bar rather than
      // our button, which is how most people stop.
      screenTrack.addEventListener("ended", () => {
        stopScreenShare();
      });
    } catch (err) {
      // Cancelling the picker is a normal action, not an error worth surfacing.
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        console.error("[room] screen share failed:", err);
        showToast("Could not start screen sharing.");
      }
    }
  }, [stream, replaceVideoTrack, stopScreenShare, showToast]);

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  const handleLeave = useCallback(() => {
    isLeavingRef.current = true;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    leave();
    stopStream();

    // A guest just finished a call — a good moment to offer an account, and the
    // only moment we know they've actually used the product. Signed-in users go
    // straight back to the dashboard.
    navigate("/", {
      state: isSignedIn ? undefined : { promptSignup: true, roomId },
    });
  }, [leave, stopStream, navigate, isSignedIn, roomId]);

  const copyInviteLink = useCallback(() => {
    const link = `${window.location.origin}/preview/${roomId}`;
    navigator.clipboard
      .writeText(link)
      .then(() => showToast("Invite link copied"))
      .catch(() => showToast("Could not copy the link"));
  }, [roomId, showToast]);

  const handleReaction = useCallback(
    (emoji) => {
      sendReaction(emoji);
      setShowReactionPicker(false);
    },
    [sendReaction]
  );

  // Release the screen capture if the component unmounts mid-share.
  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    };
  }, []);

  if (joinState === "error") {
    return (
      <div className="room-blocked">
        <div className="room-blocked-card">
          <h1>Can't join this room</h1>
          <p>{joinError}</p>
          <button onClick={() => navigate("/")} className="room-blocked-btn">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const tileCount = peers.length + 1;
  const selfEntry = roster.find((p) => p.participantId === selfId);

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="room-header-left">
          <span className="room-code">{roomId}</span>
          <button onClick={copyInviteLink} className="room-copy-btn">
            Copy invite
          </button>
        </div>

        <div className="room-header-right">
          {!stream && (
            <span className="room-connection-warning">
              <span className="room-connection-dot" />
              No camera or mic — others can't see or hear you
            </span>
          )}
          {socketStatus !== "connected" && (
            <span className="room-connection-warning">
              <span className="room-connection-dot" />
              Reconnecting to the room…
            </span>
          )}
          {!hasTurn && (
            <span
              className="room-connection-warning"
              title="Without a TURN server, peers on different restrictive networks cannot find a route to each other."
            >
              <span className="room-connection-dot" />
              No TURN — some networks won't connect
            </span>
          )}
          <span className="room-clock">
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </header>

      {/* Reactions float over the grid and expire on their own. */}
      {reactions.length > 0 && (
        <div className="room-reactions" aria-live="polite">
          {reactions.map((r) => (
            <div key={r.id} className="room-reaction">
              <span className="room-reaction-emoji">{r.emoji}</span>
              <span className="room-reaction-name">{r.name}</span>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="room-toast">{toast}</div>}

      <main className={`room-main${activePanel ? " with-panel" : ""}`}>
        <div className="video-grid" data-count={tileCount}>
          <VideoTile
            stream={screenStream || stream}
            name={displayName}
            isLocal
            isHost={hostId === selfId}
            audioEnabled={!isAudioMuted}
            videoEnabled={isScreenSharing || !isVideoOff}
            isScreenSharing={isScreenSharing}
          />

          {peers.map((peer) => (
            <VideoTile
              key={peer.id}
              stream={peer.stream}
              name={peer.name}
              isHost={hostId === peer.id}
              audioEnabled={peer.audioEnabled}
              videoEnabled={peer.videoEnabled}
              connectionState={peer.state}
              debugState={peer.debugState}
            />
          ))}
        </div>

        {peers.length === 0 && joinState === "joined" && (
          <div className="room-empty-hint">
            <p>You're the only one here.</p>
            <button onClick={copyInviteLink} className="room-empty-btn">
              Copy the invite link
            </button>
          </div>
        )}

        {activePanel && (
          <aside className="room-panel">
            <div className="room-panel-header">
              <h2>
                {activePanel === "chat" && "Chat"}
                {activePanel === "people" && `People (${roster.length})`}
                {activePanel === "info" && "Meeting details"}
              </h2>
              <button
                onClick={() => setActivePanel(null)}
                className="room-panel-close"
                aria-label="Close panel"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="room-panel-body">
              {activePanel === "chat" && (
                <Chat messages={messages} onSend={sendMessage} />
              )}

              {activePanel === "people" && (
                <ul className="room-people">
                  {roster.map((person) => (
                    <li key={person.participantId} className="room-person">
                      <span className="room-person-avatar">
                        {person.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="room-person-name">
                        {person.name}
                        {person.participantId === selfId && " (You)"}
                      </span>
                      {hostId === person.participantId && (
                        <span className="room-person-badge">Host</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {activePanel === "info" && (
                <div className="room-info">
                  <label htmlFor="room-info-code">Meeting code</label>
                  <input id="room-info-code" value={roomId} readOnly />

                  <label htmlFor="room-info-link">Invite link</label>
                  <input
                    id="room-info-link"
                    value={`${window.location.origin}/preview/${roomId}`}
                    readOnly
                  />

                  <button onClick={copyInviteLink} className="room-info-copy">
                    Copy invite link
                  </button>

                  <p className="room-info-note">
                    Audio and video travel directly between participants. The
                    server only relays the messages needed to set up each
                    connection.
                  </p>
                  {selfEntry && (
                    <p className="room-info-note">
                      Rooms hold up to 5 people. Currently {roster.length}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </main>

      <footer className="room-controls">
        <div className="room-controls-group">
          <button
            onClick={toggleAudio}
            disabled={!stream}
            className={`room-btn${isAudioMuted ? " danger" : ""}`}
            title={isAudioMuted ? "Unmute" : "Mute"}
            aria-pressed={isAudioMuted}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-14 0m7 7v4m0-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
              {isAudioMuted && (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3l18 18"
                />
              )}
            </svg>
            <span className="room-btn-label">
              {isAudioMuted ? "Unmute" : "Mute"}
            </span>
          </button>

          <button
            onClick={toggleVideo}
            disabled={!stream}
            className={`room-btn${isVideoOff ? " danger" : ""}`}
            title={isVideoOff ? "Turn camera on" : "Turn camera off"}
            aria-pressed={isVideoOff}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
              {isVideoOff && (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3l18 18"
                />
              )}
            </svg>
            <span className="room-btn-label">
              {isVideoOff ? "Start video" : "Stop video"}
            </span>
          </button>

          <button
            onClick={toggleScreenShare}
            className={`room-btn${isScreenSharing ? " active" : ""}`}
            title={isScreenSharing ? "Stop presenting" : "Present screen"}
            aria-pressed={isScreenSharing}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span className="room-btn-label">
              {isScreenSharing ? "Stop" : "Present"}
            </span>
          </button>

          <div className="room-reaction-wrapper">
            <button
              onClick={() => setShowReactionPicker((v) => !v)}
              className={`room-btn${showReactionPicker ? " active" : ""}`}
              title="React"
              aria-expanded={showReactionPicker}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="room-btn-label">React</span>
            </button>

            {showReactionPicker && (
              <div className="room-reaction-picker">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="room-reaction-option"
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleLeave} className="room-btn leave" title="Leave">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            <span className="room-btn-label">Leave</span>
          </button>
        </div>

        <div className="room-controls-group secondary">
          <button
            onClick={() =>
              setActivePanel((p) => (p === "info" ? null : "info"))
            }
            className={`room-btn ghost${activePanel === "info" ? " active" : ""}`}
            title="Meeting details"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          <button
            onClick={() =>
              setActivePanel((p) => (p === "people" ? null : "people"))
            }
            className={`room-btn ghost${
              activePanel === "people" ? " active" : ""
            }`}
            title="People"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m10-4.13a4 4 0 10-8 0 4 4 0 008 0z"
              />
            </svg>
            <span className="room-btn-count">{roster.length}</span>
          </button>

          <button
            onClick={() =>
              setActivePanel((p) => (p === "chat" ? null : "chat"))
            }
            className={`room-btn ghost${activePanel === "chat" ? " active" : ""}`}
            title="Chat"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            {unreadCount > 0 && (
              <span className="room-btn-badge">{unreadCount}</span>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default RoomPage;
