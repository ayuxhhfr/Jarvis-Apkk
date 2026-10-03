/**
 * Hook for managing the Gemini Live API WebSocket session.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { geminiLive, LiveSessionConfig } from "../services/geminiLive";
import { ConnectionStatus } from "../types/assistant";

export function useGeminiLive(initialConfig?: LiveSessionConfig) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const configRef = useRef(initialConfig);

  useEffect(() => {
    configRef.current = initialConfig;
  }, [initialConfig]);

  const connect = useCallback(async (customConfig?: LiveSessionConfig) => {
    setStatus("connecting");
    setErrorMessage(null);
    try {
      await geminiLive.connect(customConfig || configRef.current);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Connection failed");
    }
  }, []);

  const disconnect = useCallback(() => {
    geminiLive.disconnect();
    setStatus("disconnected");
  }, []);

  const reconfigure = useCallback((customConfig: LiveSessionConfig) => {
    configRef.current = customConfig;
    geminiLive.reconfigure(customConfig);
  }, []);

  const sendAudio = useCallback((base64Pcm: string) => {
    geminiLive.sendAudio(base64Pcm);
  }, []);

  const sendText = useCallback((text: string) => {
    geminiLive.sendText(text);
  }, []);

  const sendInterrupt = useCallback(() => {
    geminiLive.sendInterrupt();
  }, []);

  useEffect(() => {
    const unsubConnect = geminiLive.onConnect(() => {
      setStatus("online");
      setErrorMessage(null);
    });

    const unsubDisconnect = geminiLive.onDisconnect(() => {
      setStatus("disconnected");
    });

    const unsubError = geminiLive.onError((err) => {
      setStatus("error");
      setErrorMessage(err);
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubError();
    };
  }, []);

  return {
    status,
    errorMessage,
    connect,
    disconnect,
    reconfigure,
    sendAudio,
    sendText,
    sendInterrupt,
    geminiLive,
  };
}
