import { useEffect, useState } from "react";

/**
 * Reports whether a stream is currently producing speech-level audio.
 *
 * With more than two people on screen it stops being obvious who is talking, so
 * tiles highlight the active speaker. This reads the audio locally via Web Audio
 * rather than signalling levels over the socket — the media is already here, and
 * sending a level update several times a second per participant would be far
 * more traffic than the feature is worth.
 *
 * @param {MediaStream|null} stream
 * @param {boolean} enabled  Pass false when muted, to avoid a stuck indicator.
 * @returns {boolean} whether the participant is speaking
 */
export function useAudioLevel(stream, enabled = true) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !enabled) {
      setIsSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setIsSpeaking(false);
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    let audioContext;
    let rafId;
    let cancelled = false;

    try {
      audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      // Small FFT: we only need a rough volume, not a spectrum, and this keeps
      // the per-frame cost negligible even with four tiles running at once.
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      // Frames above the threshold needed before flipping the indicator on, and
      // quiet frames before flipping it off. Asymmetric on purpose: react fast to
      // someone starting to talk, but hold through the natural pauses in speech
      // so the highlight doesn't strobe.
      const SPEAKING_THRESHOLD = 18;
      const FRAMES_TO_START = 2;
      const FRAMES_TO_STOP = 25;

      let loudFrames = 0;
      let quietFrames = 0;
      let speaking = false;

      const tick = () => {
        if (cancelled) return;

        analyser.getByteFrequencyData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const average = sum / data.length;

        if (average > SPEAKING_THRESHOLD) {
          loudFrames += 1;
          quietFrames = 0;
        } else {
          quietFrames += 1;
          loudFrames = 0;
        }

        if (!speaking && loudFrames >= FRAMES_TO_START) {
          speaking = true;
          setIsSpeaking(true);
        } else if (speaking && quietFrames >= FRAMES_TO_STOP) {
          speaking = false;
          setIsSpeaking(false);
        }

        rafId = requestAnimationFrame(tick);
      };

      tick();
    } catch (err) {
      console.error("[audio-level] failed to analyse stream:", err);
      return;
    }

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
      setIsSpeaking(false);
    };
  }, [stream, enabled]);

  return isSpeaking;
}
