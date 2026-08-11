import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const MediaContext = createContext(null);

// Long enough for a slow camera to warm up, short enough that a stuck device
// reports a real error instead of spinning forever.
const ACQUIRE_TIMEOUT_MS = 12000;

class MediaTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for the camera");
    this.name = "MediaTimeoutError";
  }
}

/**
 * Rejects if the promise has not settled in time.
 *
 * If the request lands after we have already given up, its tracks are stopped —
 * otherwise the camera would be left running with nothing holding a reference
 * to it, and its light would stay on.
 */
function withTimeout(promise, ms) {
  let timedOut = false;
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new MediaTimeoutError());
    }, ms);
  });

  promise
    .then((stream) => {
      if (timedOut && typeof stream?.getTracks === "function") {
        stream.getTracks().forEach((track) => track.stop());
      }
    })
    .catch(() => {});

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const useMedia = () => {
  const ctx = useContext(MediaContext);
  if (!ctx) {
    throw new Error("useMedia must be used inside <MediaProvider>");
  }
  return ctx;
};

/**
 * Owns the single local camera/microphone stream for the whole app.
 *
 * This lives above the router on purpose. Previously Preview acquired a stream
 * with the user's chosen devices, then Room called getUserMedia() a second time
 * with `{audio: true, video: true}` — which threw away the device selection,
 * re-prompted on some browsers, and left the first stream running. Hoisting the
 * stream here means the camera is opened exactly once and the choice made on the
 * pre-join screen is the one that goes into the call.
 */
export const MediaProvider = ({ children }) => {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // Set when the user commits to joining from the pre-join screen. The room
  // uses it instead of testing for a stream, so somebody whose camera is
  // unavailable can still join to see and hear everyone else.
  const [readyToJoin, setReadyToJoin] = useState(false);

  const [devices, setDevices] = useState({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: [],
  });
  const [selectedDevices, setSelectedDevices] = useState({
    audioInput: "",
    videoInput: "",
    audioOutput: "",
  });

  // Held in a ref as well as state so cleanup paths can stop tracks without
  // depending on the latest render's closure.
  const streamRef = useRef(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setStream(null);
    // Leaving a call revokes the commitment to join, so returning to a room URL
    // goes back through the pre-join screen rather than straight in.
    setReadyToJoin(false);
  }, []);

  /**
   * Opens the camera and microphone, replacing any existing stream.
   * @param {{audioInput?: string, videoInput?: string}} [overrides]
   * @returns {Promise<MediaStream|null>}
   */
  const acquire = useCallback(
    async (overrides = {}) => {
      const audioInput = overrides.audioInput ?? selectedDevices.audioInput;
      const videoInput = overrides.videoInput ?? selectedDevices.videoInput;

      setIsAcquiring(true);
      setError(null);

      try {
        const constraints = {
          audio: audioInput ? { deviceId: { exact: audioInput } } : true,
          video: {
            ...(videoInput ? { deviceId: { exact: videoInput } } : {}),
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        // getUserMedia can hang indefinitely rather than rejecting when the
        // camera is held by another application or another browser profile —
        // which is exactly what happens when testing a call in two windows.
        // Without this the pre-join screen spins forever with no explanation.
        const next = await withTimeout(
          navigator.mediaDevices.getUserMedia(constraints),
          ACQUIRE_TIMEOUT_MS
        );

        // Stop the previous stream only after the new one succeeds, so a failed
        // device switch leaves the user with a working camera instead of none.
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }

        // Carry the mute state across a device switch, otherwise switching your
        // microphone silently unmutes you.
        const audioTrack = next.getAudioTracks()[0];
        const videoTrack = next.getVideoTracks()[0];
        if (audioTrack) audioTrack.enabled = !isAudioMuted;
        if (videoTrack) videoTrack.enabled = !isVideoOff;

        streamRef.current = next;
        setStream(next);
        return next;
      } catch (err) {
        console.error("[media] getUserMedia failed:", err);
        setError(describeMediaError(err));
        return null;
      } finally {
        setIsAcquiring(false);
      }
    },
    [selectedDevices.audioInput, selectedDevices.videoInput, isAudioMuted, isVideoOff]
  );

  /**
   * Enumerates devices. Labels are only populated after permission is granted,
   * so this is worth calling again once a stream exists.
   */
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = list.filter((d) => d.kind === "audioinput");
      const videoInputs = list.filter((d) => d.kind === "videoinput");
      const audioOutputs = list.filter((d) => d.kind === "audiooutput");

      setDevices({ audioInputs, videoInputs, audioOutputs });

      setSelectedDevices((prev) => ({
        audioInput: prev.audioInput || audioInputs[0]?.deviceId || "",
        videoInput: prev.videoInput || videoInputs[0]?.deviceId || "",
        audioOutput: prev.audioOutput || audioOutputs[0]?.deviceId || "",
      }));
    } catch (err) {
      console.error("[media] enumerateDevices failed:", err);
    }
  }, []);

  const selectDevice = useCallback((kind, deviceId) => {
    setSelectedDevices((prev) => ({ ...prev, [kind]: deviceId }));
  }, []);

  const toggleAudio = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsAudioMuted(!track.enabled);
  }, []);

  const toggleVideo = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsVideoOff(!track.enabled);
  }, []);

  // Keep the device list current when hardware is plugged in or removed.
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  // Release the camera if the tab closes without going through endCall.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const value = {
    stream,
    error,
    isAcquiring,
    devices,
    selectedDevices,
    isAudioMuted,
    isVideoOff,
    readyToJoin,
    acquire,
    stopStream,
    refreshDevices,
    selectDevice,
    toggleAudio,
    toggleVideo,
    setReadyToJoin,
  };

  return (
    <MediaContext.Provider value={value}>{children}</MediaContext.Provider>
  );
};

function describeMediaError(err) {
  if (err.name === "MediaTimeoutError") {
    return "Your camera didn't respond. It's usually held by another app or another browser window — close that, or join without it.";
  }

  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera and microphone access was blocked. Allow access in your browser's address bar, then retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone found. Connect a device and retry.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera or microphone is already in use by another app or browser window. Close it and retry, or join without it.";
    case "OverconstrainedError":
      return "The selected device is unavailable. Pick a different one.";
    default:
      return "Could not start your camera and microphone.";
  }
}
