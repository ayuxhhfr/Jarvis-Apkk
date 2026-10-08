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

  const startListening = useCallback(async (
    onAudioChunk?: AudioChunkCallback,
    onInterrupt?: InterruptCallback,
    onSpeechEnd?: () => void,
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
        const granted = await requestAndroidMicrophonePermission();
        if (!granted) {
          throw new Error(
            "Microphone permission is denied. Allow Microphone for JARVIS in Android Settings, then try again."
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
    setOutputLevel(0);
  }, []);

  const setAssistantSpeaking = useCallback((speaking: boolean) => {
    assistantSpeakingRef.current = speaking;
    audioManager.setAssistantSpeaking(speaking);
  }, []);

  const playAudioChunk = useCallback((base64Data: string, onEnd?: () => void) => {
    if (Capacitor.getPlatform() === "android" && nativeBridge.isAvailable()) {
      void nativeBridge.playPcm(base64Data, 24000)
        .then(() => onEnd?.())
        .catch((err) => {
          console.error("[NativeAudio] PCM output failed:", err);
          onEnd?.();
        });
      return;
    }
    audioManager.playAudioChunk(base64Data, onEnd);
  }, []);

  const flushAudioQueue = useCallback(() => {
    if (Capacitor.getPlatform() === "android" && nativeBridge.isAvailable()) {
      void nativeBridge.flushPlayback().catch((err) => {
        console.warn("[NativeAudio] flushPlayback failed:", err);
      });
    }
  }, []);

  const playEncodedAudio = useCallback((base64Data: string, onEnd?: () => void) => {
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
      audioManager.cleanup();
    };
  }, []);

  return {
    isMicActive,
    micLevel,
    outputLevel,
    permissionError,
    startListening,
    stopListening,
    stopPlayback,
    setAssistantSpeaking,
    playAudioChunk,
    playEncodedAudio,
  };
}
