import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMedia } from "../context/MediaProvider";
import { useAuth } from "../context/AuthProvider";
import { getDisplayName, setDisplayName } from "../service/identity";
import { hasTurnConfigured } from "../service/iceServers";
import "./Preview.css";

/** Turns "ada.lovelace@example.com" into "Ada Lovelace" as a starting point. */
function nameFromEmail(email) {
  if (!email) return "";
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Pre-join screen: pick your devices, check how you look, then enter the room.
 *
 * The stream opened here is the one the call uses. Previously Room called
 * getUserMedia() again on arrival, which discarded whatever was chosen here.
 */
const PreviewPage = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();

  const {
    stream,
    error,
    isAcquiring,
    devices,
    selectedDevices,
    isAudioMuted,
    isVideoOff,
    acquire,
    refreshDevices,
    selectDevice,
    toggleAudio,
    toggleVideo,
    setReadyToJoin,
  } = useMedia();

  const { user, isSignedIn } = useAuth();

  const [userName, setUserName] = useState(
    () => getDisplayName() || nameFromEmail(user?.email)
  );
  const [videoEl, setVideoEl] = useState(null);
  const [copied, setCopied] = useState(false);

  // Someone arriving on a shared invite link without an account is asked what
  // to be called in this meeting. Signed-in users already have a name, so they
  // never see this.
  const [showGuestPrompt, setShowGuestPrompt] = useState(
    () => !isSignedIn && !getDisplayName()
  );
  const [guestNameDraft, setGuestNameDraft] = useState("");

  // Open the camera once on arrival, then read the device list again — labels
  // are blank until permission has been granted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opened = await acquire();
      if (!cancelled && opened) {
        await refreshDevices();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once. acquire/refreshDevices change identity when the
    // selected device changes, and re-running here would reopen the camera in a
    // loop; device switches are handled by handleDeviceChange instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Callback ref rather than useRef: the <video> is conditionally rendered, so a
  // plain ref can still be null on the render where the stream first arrives.
  useEffect(() => {
    if (!videoEl) return;
    videoEl.srcObject = stream || null;
    if (stream) {
      videoEl.play().catch(() => {});
    }
  }, [videoEl, stream]);

  const handleDeviceChange = (kind, deviceId) => {
    selectDevice(kind, deviceId);
    // Reopen with the new device. Passing it explicitly avoids waiting a render
    // for the selection state to settle.
    acquire({ [kind]: deviceId });
  };

  const copyCode = () => {
    navigator.clipboard
      .writeText(`${window.location.origin}/preview/${roomCode}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  const joinMeeting = () => {
    const name = userName.trim();
    if (!name) return;
    setDisplayName(name);
    setReadyToJoin(true);
    navigate(`/room/${roomCode}`);
  };

  // A name is the only hard requirement. Someone whose camera is busy or
  // blocked can still join and see and hear everyone else, which is far more
  // useful than being locked out of the call entirely.
  const canJoin = Boolean(userName.trim());
  const hasNoMedia = !stream && !isAcquiring;

  const confirmGuestName = (e) => {
    e.preventDefault();
    const name = guestNameDraft.trim();
    if (!name) return;
    setUserName(name);
    setShowGuestPrompt(false);
  };

  return (
    <div className="preview-container">
      {showGuestPrompt && (
        <div className="guest-modal-overlay">
          <form onSubmit={confirmGuestName} className="guest-modal">
            <h2>You've been invited to a meeting</h2>
            <p>What should people call you in this call?</p>

            <input
              type="text"
              value={guestNameDraft}
              onChange={(e) => setGuestNameDraft(e.target.value)}
              placeholder="Your name"
              className="guest-modal-input"
              maxLength={40}
              autoFocus
              aria-label="Your name"
            />

            <button
              type="submit"
              disabled={!guestNameDraft.trim()}
              className="guest-modal-submit"
            >
              Continue
            </button>

            <p className="guest-modal-note">
              You don't need an account to join. Room code{" "}
              <strong>{roomCode}</strong>.
            </p>

            <button
              type="button"
              onClick={() => navigate("/login")}
              className="guest-modal-link"
            >
              Or sign in to your account
            </button>
          </form>
        </div>
      )}

      <div className="preview-header">
        <div className="preview-logo">
          <div className="logo-icon">Z</div>
          <div className="logo-text">
            <div className="logo-title">Zenith</div>
          </div>
        </div>
      </div>

      <div className="preview-content">
        <div className="preview-left">
          <div className="video-preview-container">
            {isAcquiring && (
              <div className="preview-loading">
                <div className="spinner" />
                <p>Starting camera…</p>
              </div>
            )}

            {error && !isAcquiring && (
              <div className="preview-error">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <p>{error}</p>
                <button onClick={() => acquire()} className="retry-btn">
                  Try again
                </button>
              </div>
            )}

            {!isAcquiring && !error && (
              <>
                <video
                  ref={setVideoEl}
                  autoPlay
                  playsInline
                  muted
                  className={`video-preview ${isVideoOff ? "video-off" : ""}`}
                />
                {isVideoOff && (
                  <div className="video-off-overlay">
                    <div className="user-avatar-large">
                      {userName.charAt(0).toUpperCase() || "?"}
                    </div>
                    <p>Camera is off</p>
                  </div>
                )}
                <div className="preview-name-label">
                  {userName || "Your name"}
                </div>
              </>
            )}

            <div className="preview-controls">
              <button
                onClick={toggleAudio}
                disabled={!stream}
                className={`preview-control-btn ${isAudioMuted ? "danger" : ""}`}
                title={isAudioMuted ? "Unmute" : "Mute"}
                aria-pressed={isAudioMuted}
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              </button>

              <button
                onClick={toggleVideo}
                disabled={!stream}
                className={`preview-control-btn ${isVideoOff ? "danger" : ""}`}
                title={isVideoOff ? "Turn camera on" : "Turn camera off"}
                aria-pressed={isVideoOff}
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              </button>
            </div>
          </div>
        </div>

        <div className="preview-right">
          <div className="preview-info-card">
            <h1 className="preview-title">Ready to join?</h1>
            <p className="preview-subtitle">
              Check your camera and microphone before entering.
            </p>

            <div className="preview-form-group">
              <label htmlFor="preview-name">Your name</label>
              <input
                id="preview-name"
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canJoin) joinMeeting();
                }}
                placeholder="Enter your name"
                className="preview-input"
                maxLength={40}
              />
            </div>

            <div className="preview-form-group">
              <label htmlFor="preview-room">Room code</label>
              <div className="room-code-display">
                <input
                  id="preview-room"
                  type="text"
                  value={roomCode}
                  readOnly
                  className="preview-input room-code-input"
                />
                <button
                  onClick={copyCode}
                  className="copy-code-btn"
                  title="Copy invite link"
                >
                  {copied ? (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="device-settings">
              <h3 className="device-settings-title">Devices</h3>

              <div className="preview-form-group">
                <label htmlFor="device-mic">Microphone</label>
                <select
                  id="device-mic"
                  value={selectedDevices.audioInput}
                  onChange={(e) =>
                    handleDeviceChange("audioInput", e.target.value)
                  }
                  className="device-select"
                  disabled={devices.audioInputs.length === 0}
                >
                  {devices.audioInputs.length === 0 && (
                    <option>No microphone found</option>
                  )}
                  {devices.audioInputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Microphone"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="preview-form-group">
                <label htmlFor="device-cam">Camera</label>
                <select
                  id="device-cam"
                  value={selectedDevices.videoInput}
                  onChange={(e) =>
                    handleDeviceChange("videoInput", e.target.value)
                  }
                  className="device-select"
                  disabled={devices.videoInputs.length === 0}
                >
                  {devices.videoInputs.length === 0 && (
                    <option>No camera found</option>
                  )}
                  {devices.videoInputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Camera"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={joinMeeting}
              disabled={!canJoin}
              className="join-meeting-btn"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
              {hasNoMedia ? "Join without camera" : "Join meeting"}
            </button>

            {hasNoMedia && (
              <p className="preview-info-text preview-warning">
                You'll join without sending video or audio, but you'll still see
                and hear everyone else.
              </p>
            )}

            <p className="preview-info-text">
              Share the room code to invite others. Rooms hold up to 5 people.
            </p>

            {!hasTurnConfigured() && (
              <p className="preview-info-text preview-warning">
                No TURN server is configured, so calls may fail between
                restrictive networks.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreviewPage;
