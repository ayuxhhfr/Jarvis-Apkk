/**
 * Hook for voice hardware control, microphone capture, audio playback,
 * amplitude analysis, and interruption handling.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { audioManager, AudioChunkCallback, InterruptCallback } from "../services/audioManager";
import { requestAndroidMicrophonePermission, checkAndroidMicrophonePermission, DENIED_SETTINGS_MESSAGE } from "../services/nativePermissions";
import { startAndroidPcmCapture } from "../services/androidRuntime";
import { nativeBridge } from "../services/nativeBridge";

export function useVoice() {
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [outputLevel, setOutputLevel] = useState<number>(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const nativePcmCleanupRef = useRef<(() => void) | null>(null);
  const nativeMicLevelRef = useRef(0);
  const assistantSpeakingRef = useRef(false);
  const interruptRef = useRef<InterruptCallback | null>(null);
  const lastBargeInAtRef = useRef(0);
  const playbackActiveRef = useRef(false);
  const playbackWaitersRef = useRef<Set<() => void>>(new Set());

  const resolvePlaybackWaiters = useCallback(() => {
    playbackWaitersRef.current.forEach((resolve) => resolve());
    playbackWaitersRef.current.clear();
  }, []);

  const handlePlaybackIdle = useCallback(() => {
    playbackActiveRef.current = false;
    resolvePlaybackWaiters();
  }, [resolvePlaybackWaiters]);

  // Playback completion is an actual audio-engine event, not a fixed-duration
  // state timer. Android emits playbackIdle after its queued PCM reaches the
  // AudioTrack playback head; web playback uses AudioBufferSource completion.
  useEffect(() => {
    audioManager.setOnPlaybackIdle(handlePlaybackIdle);

    let disposed = false;
    let playbackListener: { remove: () => Promise<void> } | null = null;
    if (Capacitor.getPlatform() === "android" && nativeBridge.isAvailable()) {
      void nativeBridge.addListener("playbackIdle", () => {
        if (!disposed) handlePlaybackIdle();
      }).then((listener) => {
        if (disposed) void listener.remove().catch(() => {});
        else playbackListener = listener;
      }).catch((err) => {
        console.warn("[NativeAudio] playbackIdle listener failed:", err);
      });
    }

    return () => {
      disposed = true;
      audioManager.setOnPlaybackIdle(null);
      void playbackListener?.remove().catch(() => {});
      playbackActiveRef.current = false;
      resolvePlaybackWaiters();
    };
  }, [handlePlaybackIdle, resolvePlaybackWaiters]);

  const startListening = useCallback(async (
    onAudioChunk?: AudioChunkCallback,
    onInterrupt?: InterruptCallback,
    onSpeechEnd?: () => void,
    onSpeechStart?: () => void,
  ) => {
    try {
      setPermissionError(null);
      if (onAudioChunk) {
        audioManager.setOnAudioChunk(onAudioChunk);
      }
      if (onInterrupt) {
        audioManager.setOnInterrupt(onInterrupt);
      }

      if (Capacitor.getPlatform() === "android") {
        const permission = await requestAndroidMicrophonePermission();
        if (!permission.granted) {
          throw new Error(
            permission.permanentlyDenied
              ? DENIED_SETTINGS_MESSAGE
              : "Microphone permission was not granted. Tap the voice button and allow Microphone for JARVIS."
          );
        }
      }

      if (Capacitor.getPlatform() === "android") {
        // Android voice mode uses the native VOICE_COMMUNICATION audio path
        // instead of WebView AudioContext. This gives us platform AEC/NS/AGC,
        // lower startup jitter, and stable 16 kHz PCM chunks on low-end phones.
        interruptRef.current = onInterrupt || null;
        nativePcmCleanupRef.current?.();
        nativePcmCleanupRef.current = await startAndroidPcmCapture(
          (base64Pcm) => {
            onAudioChunk?.(base64Pcm);
          },
          (speaking, rms) => {
            nativeMicLevelRef.current = Math.min(1, rms * 7);

            if (speaking) {
              onSpeechStart?.();
            }

            if (speaking && assistantSpeakingRef.current && onInterrupt) {
              const now = Date.now();
              // AEC/NS should remove speaker leakage, but keep a tiny guard so
              // one residual echo burst cannot trigger multiple interruptions.
              if (now - lastBargeInAtRef.current > 900) {
                lastBargeInAtRef.current = now;
                onInterrupt();
              }
            }

            if (!speaking) {
              onSpeechEnd?.();
            }
          },
          (message) => setPermissionError(message),
        );
      } else {
        await audioManager.startMicrophone();
      }
      setIsMicActive(true);
    } catch (err) {
      console.error("Microphone access error:", err);
      let message = err instanceof Error
        ? err.message
        : "Microphone access denied or unavailable";
      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          message = Capacitor.getPlatform() === "android"
            ? "Microphone permission was denied. Allow Microphone for JARVIS in Android Settings, then try again."
            : "Microphone permission was denied. Please allow microphone access in your browser settings.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          message = "No microphone hardware found on this device.";
        }
      }
      setPermissionError(message);
      setIsMicActive(false);
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const recheck = () => {
      void checkAndroidMicrophonePermission().then(({ granted }) => {
        if (granted) setPermissionError(null);
      }).catch(() => {});
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  const clearPermissionError = useCallback(() => {
    setPermissionError(null);
  }, []);

  const stopListening = useCallback(() => {
    nativePcmCleanupRef.current?.();
    nativePcmCleanupRef.current = null;
    audioManager.stopMicrophone();
    interruptRef.current = null;
    assistantSpeakingRef.current = false;
    setIsMicActive(false);
    setMicLevel(0);
  }, []);

  const stopPlayback = useCallback(() => {
    if (Capacitor.getPlatform() === "android" && nativeBridge.isAvailable()) {
      void nativeBridge.stopPlayback().catch((err) => {
        console.warn("[NativeAudio] stopPlayback failed:", err);
      });
    }
    audioManager.stopPlayback();
    playbackActiveRef.current = false;
    resolvePlaybackWaiters();
    setOutputLevel(0);
  }, [resolvePlaybackWaiters]);

  const setAssistantSpeaking = useCallback((speaking: boolean) => {
    assistantSpeakingRef.current = speaking;
    audioManager.setAssistantSpeaking(speaking);
  }, []);

  const playAudioChunk = useCallback((base64Data: string, onEnd?: () => void) => {
    if (!base64Data || typeof base64Data !== "string") {
      onEnd?.();
      return;
    }

    playbackActiveRef.current = true;

    if (Capacitor.getPlatform() === "android" && nativeBridge.isAvailable()) {
      void nativeBridge.playPcm(base64Data, 24000)
        .then(() => onEnd?.())
        .catch((err) => {
          console.error("[NativeAudio] PCM output failed:", err);
          playbackActiveRef.current = false;
          resolvePlaybackWaiters();
          onEnd?.();
        });
      return;
    }
    audioManager.playAudioChunk(base64Data, onEnd);
  }, [resolvePlaybackWaiters]);

  const flushAudioQueue = useCallback(() => {
    if (Capacitor.getPlatform() === "android" && nativeBridge.isAvailable()) {
      void nativeBridge.flushPlayback().catch((err) => {
        console.warn("[NativeAudio] flushPlayback failed:", err);
      });
    }
  }, []);

  const waitForPlaybackIdle = useCallback(() => {
    if (!playbackActiveRef.current) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        playbackWaitersRef.current.delete(finish);
        resolve();
      };

      playbackWaitersRef.current.add(finish);

      // The event may have arrived between the active check and waiter
      // registration. Re-check after registration to close that race.
      if (!playbackActiveRef.current) finish();
    });
  }, []);

  const playEncodedAudio = useCallback((base64Data: string, onEnd?: () => void) => {
    if (!base64Data || typeof base64Data !== "string") {
      onEnd?.();
      return;
    }
    playbackActiveRef.current = true;
    audioManager.playEncodedAudio(base64Data, onEnd);
  }, []);

  // Keep audio visualization responsive without forcing the entire React tree
  // to render at 60fps. The audio engine itself stays realtime; UI telemetry
  // only needs ~15fps on low-end Android hardware.
  useEffect(() => {
    let cancelled = false;
    let lastMic = -1;
    let lastOutput = -1;

    const updateLevels = () => {
      if (cancelled) return;
      const levels = audioManager.getLevels();
      const mic = Capacitor.getPlatform() === "android"
        ? nativeMicLevelRef.current
        : levels.micLevel;

      if (Math.abs(mic - lastMic) > 0.018) {
        lastMic = mic;
        setMicLevel(mic);
      }
      if (Math.abs(levels.outputLevel - lastOutput) > 0.018) {
        lastOutput = levels.outputLevel;
        setOutputLevel(levels.outputLevel);
      }

      window.setTimeout(updateLevels, 66);
    };

    updateLevels();

    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      nativePcmCleanupRef.current?.();
      nativePcmCleanupRef.current = null;
      playbackActiveRef.current = false;
      resolvePlaybackWaiters();
      audioManager.cleanup();
    };
  }, [resolvePlaybackWaiters]);

  return {
    isMicActive,
    micLevel,
    outputLevel,
    permissionError,
    clearPermissionError,
    startListening,
    stopListening,
    stopPlayback,
    setAssistantSpeaking,
    playAudioChunk,
    playEncodedAudio,
    flushAudioQueue,
    waitForPlaybackIdle,
  };
}
