/**
 * Hook for voice hardware control, microphone capture, audio playback,
 * amplitude analysis, and interruption handling.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { audioManager, AudioChunkCallback, InterruptCallback } from "../services/audioManager";

export function useVoice() {
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [outputLevel, setOutputLevel] = useState<number>(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const animFrameRef = useRef<number | null>(null);

  const startListening = useCallback(async (onAudioChunk?: AudioChunkCallback, onInterrupt?: InterruptCallback) => {
    try {
      setPermissionError(null);
      if (onAudioChunk) {
        audioManager.setOnAudioChunk(onAudioChunk);
      }
      if (onInterrupt) {
        audioManager.setOnInterrupt(onInterrupt);
      }
      await audioManager.startMicrophone();
      setIsMicActive(true);
    } catch (err) {
      console.error("Microphone access error:", err);
      let message = "Microphone access denied or unavailable";
      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          message = "Microphone permission was denied. Please allow microphone access in your browser settings.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          message = "No microphone hardware found on this device.";
        }
      }
      setPermissionError(message);
      setIsMicActive(false);
      throw new Error(message);
    }
  }, []);

  const stopListening = useCallback(() => {
    audioManager.stopMicrophone();
    setIsMicActive(false);
    setMicLevel(0);
  }, []);

  const stopPlayback = useCallback(() => {
    audioManager.stopPlayback();
    setOutputLevel(0);
  }, []);

  const setAssistantSpeaking = useCallback((speaking: boolean) => {
    audioManager.setAssistantSpeaking(speaking);
  }, []);

  const playAudioChunk = useCallback((base64Data: string, onEnd?: () => void) => {
    audioManager.playAudioChunk(base64Data, onEnd);
  }, []);

  const playEncodedAudio = useCallback((base64Data: string, onEnd?: () => void) => {
    audioManager.playEncodedAudio(base64Data, onEnd);
  }, []);

  // Keep audio visualization responsive without forcing the entire React tree
  // to render at 60fps. The audio engine itself stays realtime; UI telemetry
  // only needs ~15fps on low-end Android hardware.
  useEffect(() => {
    let cancelled = false;

    const updateLevels = () => {
      if (cancelled) return;
      const levels = audioManager.getLevels();
      setMicLevel(levels.micLevel);
      setOutputLevel(levels.outputLevel);
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
