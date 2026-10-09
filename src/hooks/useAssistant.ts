/**
 * Assistant Orchestration Hook for JARVIS.
 * Unified conversation and response pipeline connecting Gemini Live,
 * speech recognition transcription, real-time streaming transcripts,
 * audio playback, tool calls, and interruption handling.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { AssistantState, AssistantSettings, ConnectionStatus } from "../types/assistant";
import { ChatMessage } from "../types/message";
import { ScreenShareStatus } from "../types/screenShare";
import { JARVIS_SYSTEM_INSTRUCTION } from "../config/jarvisConfig";
import { CHAT_MODEL, LIVE_MODEL } from "../config/modelConfig";
import { DEFAULT_VOICE } from "../config/voiceConfig";
import { ASSISTANT_PROFILES, DEFAULT_PROFILE_ID } from "../config/assistantProfiles";
import { useGeminiLive } from "./useGeminiLive";
import { useVoice } from "./useVoice";
import { geminiText } from "../services/geminiText";
import { managerService } from "../services/managerService";
import { parseBrowserIntent } from "../services/browserTools";
import { memoryService } from "../services/memoryService";
import { memoryLearner } from "../services/memoryLearner";
import { browserManager } from "../services/browserManager";
import { defaultMemoryStore } from "../services/memoryStore";
import { screenShareService } from "../services/screenShareService";
import { sessionService } from "../services/sessionService";
import { isAndroidApp, speakAndroid } from "../services/androidRuntime";
import { tryOpenAndroidAppCommand, startAndroidWakeWord } from "../services/androidAppActions";

export function useAssistant() {
  // Gemini decides whether ordinary conversation contains durable user knowledge.
  // Explicit "remember/forget" commands still bypass this gate for deterministic control.
  const learnImplicitMemory = useCallback(async (text: string, source: "voice_command" | "inferred") => {
    try {
      // Instant rule-based save first, AI classification + retry queue in the background.
      await memoryLearner.learn(text, source);
    } catch (err) {
      console.warn("Memory learning skipped:", err);
    }
  }, []);

  // Retry memories that could not be classified while Gemini was busy/offline.
  useEffect(() => {
    void memoryLearner.drain();
    const timer = setInterval(() => { void memoryLearner.drain(); }, 60000);
    const onOnline = () => { void memoryLearner.drain(); };
    window.addEventListener("online", onOnline);
    return () => { clearInterval(timer); window.removeEventListener("online", onOnline); };
  }, []);
  const [state, setState] = useState<AssistantState>("idle");
  const [settings, setSettings] = useState<AssistantSettings>(() => {
    try {
      const saved = localStorage.getItem("jarvis_assistant_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.selectedProfileId === "ira") {
          return {
            assistantName: "Ira",
            voice: "Aoede",
            voiceEnabled: true,
            liveModel: LIVE_MODEL,
            brainModel: CHAT_MODEL,
            backgroundModel: "auto",
            thinkingLevel: "minimal",
            systemInstruction: ASSISTANT_PROFILES.ira.systemInstruction,
            selectedProfileId: "ira",
            ...parsed,
          };
        }
        return {
          assistantName: "JARVIS",
          voice: DEFAULT_VOICE,
          voiceEnabled: true,
          liveModel: LIVE_MODEL,
          brainModel: CHAT_MODEL,
          backgroundModel: "auto",
          thinkingLevel: "minimal",
          systemInstruction: JARVIS_SYSTEM_INSTRUCTION,
          selectedProfileId: "jarvis",
          ...parsed,
        };
      }
    } catch {
      // Fallback to default
    }
    return {
      assistantName: "JARVIS",
      voice: DEFAULT_VOICE,
      voiceEnabled: true,
      liveModel: LIVE_MODEL,
      brainModel: CHAT_MODEL,
      backgroundModel: "auto",
      thinkingLevel: "minimal",
      systemInstruction: JARVIS_SYSTEM_INSTRUCTION,
      selectedProfileId: "jarvis",
    };
  });

  // Screen share status state
  const [screenShareStatus, setScreenShareStatus] = useState<ScreenShareStatus>(() =>
    screenShareService.getStatus()
  );

  // Load persisted conversation history on initialize
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return defaultMemoryStore.getConversationHistory() || [];
    } catch {
      return [];
    }
  });

  const [currentTranscript, setCurrentTranscript] = useState<string>("");
  const [activeError, setActiveError] = useState<string | null>(null);
  const [androidMicActive, setAndroidMicActive] = useState(false);
  const sendTextMessageRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Synchronization refs
  const stateRef = useRef(state);
  stateRef.current = state;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const currentTurnIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const speechReceivedInCurrentTurnRef = useRef<boolean>(false);
  const mountedRef = useRef(true);

  // Voice-turn identity guards. Native VAD, Gemini transcript completion, and
  // React callbacks are asynchronous; these refs make one physical utterance
  // resolve to exactly one manager request even if multiple callbacks arrive.
  const voiceTurnSequenceRef = useRef(0);
  const voiceCaptureActiveRef = useRef(false);
  const userSpeechActiveRef = useRef(false);
  const activeVoiceTurnIdRef = useRef<number | null>(null);
  const pendingVoiceTurnIdRef = useRef<number | null>(null);
  const voiceRequestTurnIdRef = useRef<number | null>(null);
  const handledVoiceTranscriptIdsRef = useRef<Set<number>>(new Set());
  const fallbackVoiceTranscriptSequenceRef = useRef(0);

  // Output identity guards prevent an interrupted response from completing
  // after a newer barge-in has already taken over the interaction.
  const voiceOutputSequenceRef = useRef(0);
  const activeVoiceOutputIdRef = useRef<number | null>(null);

  // Persist only stable conversation states. During streaming, assistant text can
  // change many times per second; synchronous localStorage JSON serialization
  // on every chunk causes visible Android WebView jank.
  useEffect(() => {
    const isStreaming = messages.some((message) => message.isStreaming || message.status === "streaming");
    if (isStreaming) return;

    const timer = window.setTimeout(() => {
      try {
        defaultMemoryStore.saveConversationHistory(messages);
      } catch (err) {
        console.warn("Failed to persist conversation history:", err);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [messages]);

  // Voice capture & audio playback hook
  const {
    isMicActive,
    micLevel,
    outputLevel,
    startListening,
    stopListening,
    playAudioChunk,
    stopPlayback,
    setAssistantSpeaking,
    permissionError,
    clearPermissionError,
    flushAudioQueue,
    waitForPlaybackIdle,
  } = useVoice();

  // Gemini Live WebSocket bridge hook
  const {
    status: liveStatus,
    errorMessage: liveError,
    connect: connectLive,
    sendAudio,
    sendInterrupt,
    sendAudioStreamEnd,
    clearError: clearLiveError,
    geminiLive,
  } = useGeminiLive({
    model: settings.liveModel,
    voice: settings.voice,
    thinkingLevel: settings.thinkingLevel,
    systemInstruction: settings.systemInstruction,
    voiceOnly: true,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const invalidateVoiceOutput = useCallback(() => {
    activeVoiceOutputIdRef.current = null;
    voiceOutputSequenceRef.current += 1;
  }, []);

  const resetVoiceTurnTracking = useCallback((invalidateRequest = true) => {
    voiceCaptureActiveRef.current = false;
    userSpeechActiveRef.current = false;
    activeVoiceTurnIdRef.current = null;
    pendingVoiceTurnIdRef.current = null;
    if (invalidateRequest) voiceRequestTurnIdRef.current = null;
    invalidateVoiceOutput();
  }, [invalidateVoiceOutput]);

  // Speaks the genuine manager reply through the existing voice architecture.
  //
  // Previously this returned false whenever the Gemini Live socket was not yet
  // connected, and every caller treated false as "stay silent". On the very
  // first turn the Live handshake is still in flight (sendTextMessage starts it
  // deliberately without awaiting so it never delays the brain request), so the
  // reply was always discarded and the app produced text with no audio.
  //
  // Now it gives Live a bounded chance to come up, then falls back to the
  // already-configured Gemini TTS path. No second speech system, no simulated
  // playback, no fabricated audio. Returns true only when real audio was
  // actually queued.
  const speakAssistantReply = useCallback(async (text: string): Promise<boolean> => {
    const reply = text.trim();
    if (!reply || !settingsRef.current.voiceEnabled) return false;

    if (!geminiLive.connected) {
      try {
        await Promise.race([
          connectLive({
            voice: settingsRef.current.voice,
            systemInstruction:
              settingsRef.current.systemInstruction || JARVIS_SYSTEM_INSTRUCTION,
            model: settingsRef.current.liveModel,
            thinkingLevel: settingsRef.current.thinkingLevel,
            voiceOnly: true,
          }),
          new Promise((resolve) => window.setTimeout(resolve, 2500)),
        ]);
      } catch (err) {
        console.warn("[Voice] Live connect before speak failed:", err);
      }
    }

    if (geminiLive.connected) {
      const outputId = ++voiceOutputSequenceRef.current;
      activeVoiceOutputIdRef.current = outputId;
      // Response text is ready now; SPEAKING starts only when the first real
      // audio chunk arrives from the existing Live playback path.
      setAssistantSpeaking(false);
      setState("response_ready");
      geminiLive.speakText(reply);
      return true;
    }

    // Live unavailable: speak the same genuine reply through the configured
    // Gemini TTS path that deliverGreeting already relies on.
    try {
      const audio = await geminiText.textToSpeech(reply, settingsRef.current.voice);
      if (!audio) return false;
      const outputId = ++voiceOutputSequenceRef.current;
      activeVoiceOutputIdRef.current = outputId;
      setState("speaking");
      setAssistantSpeaking(true);
      playAudioChunk(audio, () => {
        if (!mountedRef.current || activeVoiceOutputIdRef.current !== outputId) return;
        activeVoiceOutputIdRef.current = null;
        setAssistantSpeaking(false);
        setState("idle");
      });
      return true;
    } catch (err) {
      console.warn("[Voice] TTS fallback failed:", err);
      return false;
    }
  }, [geminiLive, connectLive, playAudioChunk, setAssistantSpeaking]);

  const completeVoicePlayback = useCallback((outputId: number) => {
    void waitForPlaybackIdle().then(() => {
      if (!mountedRef.current || activeVoiceOutputIdRef.current !== outputId) return;
      activeVoiceOutputIdRef.current = null;
      setAssistantSpeaking(false);

      if (voiceCaptureActiveRef.current && isAndroidApp()) {
        // Android voice turns are one-shot: the capture stayed open through
        // THINKING/SPEAKING only so real speech could barge in. Once the reply
        // has fully played, the turn ends back at IDLE.
        voiceCaptureActiveRef.current = false;
        userSpeechActiveRef.current = false;
        activeVoiceTurnIdRef.current = null;
        pendingVoiceTurnIdRef.current = null;
        stopListening();
        setAndroidMicActive(false);
        setState("idle");
      } else {
        // Desktop keeps the microphone open for continuous conversation and
        // returns to LISTENING, matching the pre-existing behavior.
        setState(voiceCaptureActiveRef.current ? "listening" : "idle");
      }
    });
  }, [waitForPlaybackIdle, setAssistantSpeaking, stopListening]);

  useEffect(() => {
    if (state !== "thinking") return;
    const timer = window.setTimeout(() => {
      if (stateRef.current !== "thinking") return;
      stopPlayback();
      setAssistantSpeaking(false);
      setState("idle");
      setActiveError("JARVIS took too long to respond. The turn was reset — tap the mic to try again.");
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [state, stopPlayback, setAssistantSpeaking]);

  // Deterministic native Android app-launch path. It runs before Gemini so commands
  // such as "open YouTube", "launch WhatsApp", or "start Spotify" never depend on
  // model tool-calling and feel instant.
  const runAndroidAppCommand = useCallback(async (text: string, isVoice: boolean): Promise<boolean> => {
    if (!isAndroidApp()) return false;
    try {
      const app = await tryOpenAndroidAppCommand(text);
      if (!app) return false;

      const reply = `Opening ${app.name} now, Boss.`;
      const now = Date.now();
      const id = (settingsRef.current.selectedProfileId || "jarvis") + "-app-" + now;
      setMessages((prev) => [...prev, {
        id,
        role: "assistant",
        sender: (settingsRef.current.selectedProfileId || "jarvis") as any,
        content: reply,
        text: reply,
        timestamp: now,
        status: "complete",
        isStreaming: false,
        isVoice,
      }]);

      // speakAssistantReply is async: it must be awaited. Using the Promise
      // directly in a condition would always be truthy and permanently skip the
      // native fallback below.
      const spoke = isVoice ? await speakAssistantReply(reply) : false;
      if (spoke) {
        // SPEAKING is entered by the first real audio chunk.
      } else if (isVoice && settingsRef.current.voiceEnabled) {
        await speakAndroid(reply).catch(() => {});
        setState("idle");
      } else {
        setState("idle");
      }
      return true;
    } catch (error) {
      setActiveError(error instanceof Error ? error.message : "Unable to open that Android app.");
      setState("idle");
      return true;
    }
  }, [geminiLive, setAssistantSpeaking, speakAssistantReply]);


  /**
   * Universal user interruption handler.
   */
  const handleInterrupt = useCallback(() => {
    // 1. Stop audio playback & speech
    invalidateVoiceOutput();
    flushAudioQueue();
    stopPlayback();
    setAssistantSpeaking(false);

    // 2. Cancel Live response on model session
    sendInterrupt();

    // 3. Mark current assistant message as interrupted (KEEP text, do NOT delete)
    if (currentTurnIdRef.current) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentTurnIdRef.current
            ? { ...m, status: "interrupted", isStreaming: false }
            : m
        )
      );
    }
    currentTurnIdRef.current = null;
    setCurrentTranscript("");

    // 4. Switch to LISTENING immediately if mic is active, or idle
    setState(isMicActive ? "listening" : "idle");
  }, [invalidateVoiceOutput, flushAudioQueue, stopPlayback, setAssistantSpeaking, sendInterrupt, isMicActive]);

  // Native Android VAD detects a genuine user voice onset while JARVIS is
  // speaking. Stop local playback immediately, but DO NOT send audioStreamEnd:
  // Gemini's START_OF_ACTIVITY_INTERRUPTS server VAD must keep receiving the
  // user's new utterance so the complete barge-in command is preserved.
  const handleAndroidBargeIn = useCallback(() => {
    // Stop local audio immediately and suppress any in-flight model packets.
    // Do not send audioStreamEnd here; the user's new speech must keep flowing
    // until the server VAD detects the new turn boundary.
    invalidateVoiceOutput();
    geminiLive.prepareForBargeIn();
    flushAudioQueue();
    stopPlayback();
    setAssistantSpeaking(false);
    setState("user_speaking");
  }, [invalidateVoiceOutput, geminiLive, flushAudioQueue, stopPlayback, setAssistantSpeaking]);

  const beginVoiceTurn = useCallback(() => {
    if (!voiceCaptureActiveRef.current || userSpeechActiveRef.current) return;
    // A manager request is already in flight for the previous utterance. Do
    // not create a parallel request from microphone audio while THINKING.
    if (voiceRequestTurnIdRef.current !== null) return;

    const turnId = ++voiceTurnSequenceRef.current;
    activeVoiceTurnIdRef.current = turnId;
    pendingVoiceTurnIdRef.current = null;
    userSpeechActiveRef.current = true;

    if (
      stateRef.current === "listening" ||
      stateRef.current === "speaking" ||
      stateRef.current === "response_ready"
    ) {
      setState("user_speaking");
    }
  }, []);

  const handleUserSpeechStart = useCallback(() => {
    if (!voiceCaptureActiveRef.current || userSpeechActiveRef.current) return;

    // During actual SPEAKING, useVoice invokes the interruption callback after
    // this onset callback. RESPONSE_READY has no audible playback yet, so the
    // orchestration layer cancels that queued output directly.
    if (stateRef.current === "response_ready") {
      handleAndroidBargeIn();
    }

    beginVoiceTurn();
  }, [handleAndroidBargeIn, beginVoiceTurn]);

  const handleUserSpeechEnd = useCallback(() => {
    if (!voiceCaptureActiveRef.current || !userSpeechActiveRef.current) return;

    const turnId = activeVoiceTurnIdRef.current;
    userSpeechActiveRef.current = false;
    activeVoiceTurnIdRef.current = null;

    if (turnId == null || voiceRequestTurnIdRef.current !== null) return;

    pendingVoiceTurnIdRef.current = turnId;
    setState("thinking");
    // This is the single end-of-turn signal for this native VAD utterance.
    sendAudioStreamEnd();
  }, [sendAudioStreamEnd]);

  // Connect to Gemini Live on mount with temporal context
  useEffect(() => {
    if (isAndroidApp()) return;
    const temporalContext = sessionService.getTemporalContext(
      settings.assistantName,
      settings.voice
    );
    void (async () => {
      const persistentMemory = await memoryService.getPersistentContext();
      const fullInstruction =
        (settings.systemInstruction || JARVIS_SYSTEM_INSTRUCTION) +
        "\n" +
        temporalContext +
        persistentMemory;

      connectLive({
        voice: settings.voice,
        systemInstruction: fullInstruction,
        model: settings.liveModel,
        thinkingLevel: settings.thinkingLevel,
      voiceOnly: true,
        });
    })();
  }, [connectLive]);

  // Sync settings changes with Live session if reconfigured
  const updateSettings = useCallback(
    (newSettings: Partial<AssistantSettings>) => {
      setSettings((prev) => {
        const updated = { ...prev, ...newSettings };
        try {
          localStorage.setItem("jarvis_assistant_settings", JSON.stringify(updated));
        } catch {
          // Ignore
        }

        // Cleanly disconnect and reconnect live session on voice/profile change to guarantee update on server
        if (
          newSettings.voice !== undefined ||
          newSettings.liveModel !== undefined ||
          newSettings.systemInstruction !== undefined ||
          newSettings.selectedProfileId !== undefined
        ) {
          geminiLive.disconnect();
          setTimeout(async () => {
            const temporal = sessionService.getTemporalContext(
              updated.assistantName,
              updated.voice
            );
            const persistentMemory = await memoryService.getPersistentContext();
            const fullInstruction =
              (updated.systemInstruction || JARVIS_SYSTEM_INSTRUCTION) +
              "\n" +
              temporal +
              persistentMemory;

            connectLive({
              voice: updated.voice,
              systemInstruction: fullInstruction,
              model: updated.liveModel,
              thinkingLevel: updated.thinkingLevel,
            voiceOnly: true,
            });
          }, 200);
        }

        return updated;
      });
    },
    [geminiLive, connectLive]
  );

  // Subscribe to Screen Share Service state and frames
  useEffect(() => {
    const unsubState = screenShareService.onStateChange((status) => {
      setScreenShareStatus(status);
    });

    const unsubFrame = screenShareService.onFrame((frame) => {
      if (geminiLive.connected) {
        geminiLive.sendScreenFrame(frame.base64, frame.mimeType);
      }
    });

    return () => {
      unsubState();
      unsubFrame();
    };
  }, [geminiLive]);

  // Listen to Gemini Live Events
  useEffect(() => {
    // Audio chunk received from Gemini Live
    const unsubAudio = geminiLive.onAudio((base64Audio) => {
      if (activeVoiceOutputIdRef.current === null) return;
      speechReceivedInCurrentTurnRef.current = true;

      // Actual audio output has started; RESPONSE_READY now becomes SPEAKING.
      if (stateRef.current !== "speaking") {
        setState("speaking");
        setAssistantSpeaking(true);
      }

      if (settingsRef.current.voiceEnabled) {
        // A transient PCM/network gap must not end the voice turn.
        // Gemini Live turnComplete owns the speaking-state transition.
        playAudioChunk(base64Audio);
      }
    });

    // Progressive assistant text chunk received (from outputAudioTranscription or modelTurn parts)
    const unsubText = geminiLive.onTextChunk((chunk) => {
      if (!chunk) return;

      if (!currentTurnIdRef.current) {
        const id = (settingsRef.current.selectedProfileId || "jarvis") + "-" + Date.now();
        currentTurnIdRef.current = id;
        setCurrentTranscript(chunk);

        setMessages((prev) => [
          ...prev,
          {
            id,
            role: "assistant",
            sender: (settingsRef.current.selectedProfileId || "jarvis") as any,
            content: chunk,
            text: chunk,
            timestamp: Date.now(),
            status: "streaming",
            isStreaming: true,
            isVoice: true,
          },
        ]);
      } else {
        setCurrentTranscript((prev) => {
          const updated = prev + chunk;
          setMessages((msgs) =>
            msgs.map((m) =>
              m.id === currentTurnIdRef.current
                ? {
                    ...m,
                    content: updated,
                    text: updated,
                    status: "streaming",
                    isStreaming: true,
                  }
                : m
            )
          );
          return updated;
        });
      }

      if (stateRef.current === "thinking" || stateRef.current === "listening") {
        setState("speaking");
        setAssistantSpeaking(true);
      }
    });

    // User speech recognition transcript from Gemini Live. Gemini Live emits
    // one buffered transcript event per utterance; the transcript id and voice
    // turn id together protect against duplicate native/server/effect callbacks.
    const unsubUserTranscript = geminiLive.onUserTranscript(async ({ text: userText, finished }) => {
      const clean = userText.trim();
      if (!clean || !voiceCaptureActiveRef.current) return;

      const normalizedTranscriptId = ++fallbackVoiceTranscriptSequenceRef.current;
      if (handledVoiceTranscriptIdsRef.current.has(normalizedTranscriptId)) return;
      handledVoiceTranscriptIdsRef.current.add(normalizedTranscriptId);
      if (handledVoiceTranscriptIdsRef.current.size > 40) {
        const oldest = handledVoiceTranscriptIdsRef.current.values().next().value;
        if (typeof oldest === "number") handledVoiceTranscriptIdsRef.current.delete(oldest);
      }

      let turnId = pendingVoiceTurnIdRef.current ?? activeVoiceTurnIdRef.current;
      if (turnId == null) {
        // Desktop/web relies on Gemini server VAD instead of native speech
        // activity callbacks, so the first finalized transcript creates the turn.
        if (!finished) return;
        turnId = ++voiceTurnSequenceRef.current;
      }

      if (pendingVoiceTurnIdRef.current !== null && turnId !== pendingVoiceTurnIdRef.current) return;
      if (voiceRequestTurnIdRef.current !== null) return;

      if (finished) {
        pendingVoiceTurnIdRef.current = null;
        activeVoiceTurnIdRef.current = null;
        userSpeechActiveRef.current = false;
        voiceRequestTurnIdRef.current = turnId;
        setState("thinking");
      }

      if (!currentUserIdRef.current) {
        const id = "user-voice-" + turnId;
        currentUserIdRef.current = id;
        setMessages((prev) => [
          ...prev,
          {
            id,
            role: "user",
            sender: "user",
            content: clean,
            text: clean,
            timestamp: Date.now(),
            status: "complete",
            isVoice: true,
          },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentUserIdRef.current
              ? { ...m, content: clean, text: clean }
              : m
          )
        );
      }

      if (finished) {
        const requestAt = Date.now();
        const requestPerf = performance.now();
        let firstResponseAt: number | undefined;
        sessionService.recordActivity(true);
        sessionService.consumeReturnEvent();

        // Declared outside the try so the catch block can clean up the placeholder message.
        let assistantMsgId = "";
        try {
          if (await runAndroidAppCommand(clean, true)) {
            currentUserIdRef.current = null;
            return;
          }
          if (voiceRequestTurnIdRef.current !== turnId) return;
          const browserIntent = parseBrowserIntent(clean, browserManager.isCurrentSiteYouTube());
          if (browserIntent) browserManager.executeTool(browserIntent.name, browserIntent.args);

          const memoryIntent = memoryService.parseMemoryIntent(clean);
          if (memoryIntent) {
            if (memoryIntent.type === "save" && memoryIntent.content) await memoryService.saveMemory(memoryIntent.content, memoryIntent.category, 3, "voice_command");
            else if (memoryIntent.type === "delete" && memoryIntent.target) await memoryService.deleteMemoryByPattern(memoryIntent.target);
            else if (memoryIntent.type === "clear") await memoryService.clearMemories();
          } else {
            // Memory learning must never sit on the critical response path.
          // Quick local facts are saved synchronously inside memoryLearner;
          // the Gemini classifier continues in the background.
          void learnImplicitMemory(clean, "voice_command");
          }

          const screenIntent = screenShareService.parseScreenShareIntent(clean);
          if (screenIntent) {
            if (screenIntent.type === "start") await screenShareService.start();
            else if (screenIntent.type === "stop") screenShareService.stop();
          }

          const memoryContext = await memoryService.getRelevantContext(clean).catch(() => "");
          if (voiceRequestTurnIdRef.current !== turnId) return;
          const temporalContext = sessionService.getTemporalContext(settingsRef.current.assistantName, settingsRef.current.voice);
          const browserContext = browserManager.getAssistantContext();
          const activeFrame = screenShareService.isSharing() ? screenShareService.captureFrame(true) || screenShareService.getLatestFrame() : null;
          const combinedContext = [temporalContext, browserContext, memoryContext].filter(Boolean).join("\n");

          assistantMsgId = (settingsRef.current.selectedProfileId || "jarvis") + "-" + Date.now();
          setMessages((prev) => [...prev, {
            id: assistantMsgId, role: "assistant",
            sender: (settingsRef.current.selectedProfileId || "jarvis") as any,
            content: "", text: "", timestamp: Date.now(),
            status: "streaming", isStreaming: true, isVoice: true,
          }]);
          setState("thinking");

          let reply = "";
          await managerService.send({
            message: clean,
            systemInstruction: settingsRef.current.systemInstruction || JARVIS_SYSTEM_INSTRUCTION,
            history: messagesRef.current.slice(-10).map((m) => ({
              role: m.role === "user" || m.sender === "user" ? "user" : "model",
              text: m.content || m.text || "",
            })),
            context: combinedContext,
            image: activeFrame ? { data: activeFrame.base64, mimeType: activeFrame.mimeType } : undefined,
            model: settingsRef.current.brainModel || CHAT_MODEL,
          }, (chunk) => {
            if (voiceRequestTurnIdRef.current !== turnId) return;
            if (!firstResponseAt) firstResponseAt = Date.now();
            reply += chunk;
            const now = Date.now();
            setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? {
              ...m,
              content: reply,
              text: reply,
              status: "streaming",
              isStreaming: true,
              timing: {
                requestAt,
                firstResponseAt,
                timeToFirstMs: firstResponseAt ? Math.max(0, firstResponseAt - requestAt) : undefined,
                completedAt: now,
                totalMs: Math.max(0, Math.round(performance.now() - requestPerf)),
              },
            } : m));
          }, async (toolCall) => {
            try {
              if (toolCall.name === "start_screen_share") await screenShareService.start();
              else if (toolCall.name === "stop_screen_share") screenShareService.stop();
              else if (toolCall.name === "save_memory") await memoryService.saveMemory(toolCall.args?.content || "", toolCall.args?.category, toolCall.args?.importance || 3, "voice_command");
              else if (toolCall.name === "delete_memory") await memoryService.deleteMemoryByPattern(toolCall.args?.target || "");
              else if (toolCall.name === "clear_memories") await memoryService.clearMemories();
              else browserManager.executeTool(toolCall.name, toolCall.args || {});
            } catch (toolErr) {
              console.warn("Manager tool execution warning:", toolErr);
            }
          });

          if (voiceRequestTurnIdRef.current !== turnId) return;
          const completedAt = Date.now();
          const totalMs = Math.max(0, Math.round(performance.now() - requestPerf));
          setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? {
            ...m,
            content: reply,
            text: reply,
            status: "complete",
            isStreaming: false,
            timing: {
              requestAt,
              firstResponseAt,
              completedAt,
              timeToFirstMs: firstResponseAt ? Math.max(0, firstResponseAt - requestAt) : undefined,
              totalMs,
            },
          } : m));

          if (!reply || !(await speakAssistantReply(reply))) {
            setState("idle");
          }
        } catch (err) {
          if (voiceRequestTurnIdRef.current !== turnId) return;
          const message = err instanceof Error ? err.message : "Failed to get response from JARVIS manager";
          console.warn("Manager voice turn failed:", err);
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
          setActiveError(message);
          setState("idle");
          stopPlayback();
          setAssistantSpeaking(false);
        } finally {
          currentUserIdRef.current = null;
          if (voiceRequestTurnIdRef.current === turnId) {
            voiceRequestTurnIdRef.current = null;
          }
        }
      }
    });

    // Server-side interruption acknowledgement
    const unsubInterrupted = geminiLive.onInterrupted(() => {
      invalidateVoiceOutput();
      flushAudioQueue();
      stopPlayback();
      setAssistantSpeaking(false);
      if (currentTurnIdRef.current) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentTurnIdRef.current
              ? { ...m, status: "interrupted", isStreaming: false }
              : m
          )
        );
        currentTurnIdRef.current = null;
        setCurrentTranscript("");
      }
      setState(voiceCaptureActiveRef.current ? "listening" : "idle");
    });

    // Tool call received from Gemini Live
    const unsubToolCall = geminiLive.onToolCall(async (toolCall) => {
      let result: any = { success: true };

      try {
        if (toolCall.name === "start_screen_share") {
          const started = await screenShareService.start();
          result = {
            success: started.success,
            errorType: started.errorType,
            message: started.message || (started.success ? "Screen sharing is active." : "Screen sharing failed to start."),
          };
        } else if (toolCall.name === "stop_screen_share") {
          screenShareService.stop();
          result = { success: true, message: "Screen sharing stopped." };
        } else if (toolCall.name === "save_memory") {
          const content = toolCall.args?.content || "";
          const category = toolCall.args?.category;
          const importance = toolCall.args?.importance || 3;
          const saved = await memoryService.saveMemory(content, category, importance, "voice_command");
          result = { success: !!saved, memory: saved, message: "Memory saved successfully." };
        } else if (toolCall.name === "search_memories") {
          const query = toolCall.args?.query || "";
          const memories = await memoryService.searchMemories(query, 5);
          result = { success: true, memories };
        } else if (toolCall.name === "get_memories") {
          const category = toolCall.args?.category;
          const memories = await memoryService.getMemories(category ? { category } : undefined);
          result = { success: true, memories };
        } else if (toolCall.name === "delete_memory") {
          const target = toolCall.args?.target || "";
          const count = await memoryService.deleteMemoryByPattern(target);
          result = {
            success: count > 0,
            count,
            message: count > 0 ? "Memory deleted successfully." : "No matching memory found.",
          };
        } else if (toolCall.name === "clear_memories") {
          await memoryService.clearMemories();
          result = { success: true, message: "All memories cleared." };
        } else {
          // Browser tools
          result = browserManager.executeTool(toolCall.name, toolCall.args);
        }
      } catch (err) {
        console.warn("Tool execution warning:", err);
        result = { success: false, error: err instanceof Error ? err.message : "Tool error" };
      }

      geminiLive.sendToolResponse(toolCall.id, toolCall.name, result);

      // Tool protocol is intentionally invisible in chat history.
      // Gemini's spoken/model response remains the only user-facing action feedback.

    });

    // Live generation is complete. The assistant remains SPEAKING until the
    // actual playback engine reports that its queued audio has drained.
    const unsubTurnComplete = geminiLive.onTurnComplete(() => {
      speechReceivedInCurrentTurnRef.current = false;
      if (currentTurnIdRef.current) {
        const turnId = currentTurnIdRef.current;
        currentTurnIdRef.current = null;
        setCurrentTranscript("");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === turnId ? { ...m, status: "complete", isStreaming: false } : m
          )
        );
      }

      const outputId = activeVoiceOutputIdRef.current;
      if (outputId !== null) {
        completeVoicePlayback(outputId);
      }
    });

    return () => {
      unsubAudio();
      unsubText();
      unsubUserTranscript();
      unsubInterrupted();
      unsubToolCall();
      unsubTurnComplete();
    };
  }, [
    geminiLive,
    playAudioChunk,
    setAssistantSpeaking,
    stopPlayback,
    invalidateVoiceOutput,
    flushAudioQueue,
    runAndroidAppCommand,
    speakAssistantReply,
    completeVoicePlayback,
    learnImplicitMemory,
  ]);

  /**
   * Toggle Voice Microphone.
   */
  const toggleListening = useCallback(async () => {
    if (isAndroidApp()) {
      // Android uses native PCM capture plus native VAD. The capture remains
      // open through THINKING/SPEAKING so real user speech can barge in.
      if (androidMicActive) {
        resetVoiceTurnTracking();
        try {
          // Flush Google's automatic VAD before stopping the local mic.
          sendInterrupt();
          stopListening();
        } finally {
          setAndroidMicActive(false);
          flushAudioQueue();
          stopPlayback();
          setAssistantSpeaking(false);
          setState("idle");
        }
        return;
      }

      try {
        resetVoiceTurnTracking();
        voiceCaptureActiveRef.current = true;
        stopPlayback();
        setAssistantSpeaking(false);

        if (!geminiLive.connected) {
          const persistentMemory = await memoryService.getPersistentContext();
          const temporal = sessionService.getTemporalContext(
            settingsRef.current.assistantName,
            settingsRef.current.voice
          );
          await connectLive({
            voice: settingsRef.current.voice,
            systemInstruction:
              (settingsRef.current.systemInstruction || JARVIS_SYSTEM_INSTRUCTION) +
              "\n" +
              temporal +
              persistentMemory,
            model: settingsRef.current.liveModel,
            thinkingLevel: settingsRef.current.thinkingLevel,
            voiceOnly: true,
          });
        }

        await startListening(
          (base64Pcm) => {
            if (voiceCaptureActiveRef.current) sendAudio(base64Pcm);
          },
          () => handleAndroidBargeIn(),
          handleUserSpeechEnd,
          handleUserSpeechStart,
        );

        setAndroidMicActive(true);
        setState("listening");
      } catch (err) {
        resetVoiceTurnTracking();
        stopListening();
        setAndroidMicActive(false);
        setState("idle");
        setActiveError(err instanceof Error ? err.message : "Failed to activate microphone");
      }
      return;
    }

    if (isMicActive) {
      resetVoiceTurnTracking();
      stopListening();
      flushAudioQueue();
      stopPlayback();
      setAssistantSpeaking(false);
      setState("idle");
    } else {
      try {
        resetVoiceTurnTracking();
        voiceCaptureActiveRef.current = true;

        if (stateRef.current === "speaking" || stateRef.current === "response_ready") {
          flushAudioQueue();
          stopPlayback();
          setAssistantSpeaking(false);
        }
        if (!geminiLive.connected) {
          const persistentMemory = await memoryService.getPersistentContext();
          const temporal = sessionService.getTemporalContext(
            settingsRef.current.assistantName,
            settingsRef.current.voice
          );
          await connectLive({
            voice: settingsRef.current.voice,
            systemInstruction:
              (settingsRef.current.systemInstruction || JARVIS_SYSTEM_INSTRUCTION) +
              "\n" +
              temporal +
              persistentMemory,
            model: settingsRef.current.liveModel,
            thinkingLevel: settingsRef.current.thinkingLevel,
          voiceOnly: true,
          });
        }

        await startListening(
          (base64Pcm) => {
            if (voiceCaptureActiveRef.current) sendAudio(base64Pcm);
          },
          () => handleInterrupt(),
        );
        setState("listening");

        if (settingsRef.current.selectedProfileId === "ira" && ASSISTANT_PROFILES.ira.initialGreeting) {
          const profile = ASSISTANT_PROFILES.ira;
          if (profile.initialGreeting) {
            // Fire-and-forget: a rejected speak must not break the mic session.
            void speakAssistantReply(profile.initialGreeting).catch(() => {});
          }
        }
      } catch (err) {
        resetVoiceTurnTracking();
        stopListening();
        setState("idle");
        setActiveError(err instanceof Error ? err.message : "Failed to activate microphone");
      }
    }
  }, [
    androidMicActive,
    isMicActive,
    resetVoiceTurnTracking,
    stopListening,
    flushAudioQueue,
    stopPlayback,
    setAssistantSpeaking,
    geminiLive,
    connectLive,
    startListening,
    sendAudio,
    sendInterrupt,
    handleInterrupt,
    handleAndroidBargeIn,
    handleUserSpeechEnd,
    handleUserSpeechStart,
    speakAssistantReply,
  ]);

  /**
   * Send text message.
   */
  const sendTextMessage = useCallback(
    async (text: string, image?: { data: string; mimeType: string }) => {
      const trimmed = text.trim();
      if (!trimmed && !image) return;

      // Stop any current speaking/playback
      invalidateVoiceOutput();
      flushAudioQueue();
      stopPlayback();
      setAssistantSpeaking(false);

      // Start the latency clock at the exact moment the request is submitted.
      const requestAt = Date.now();
      const requestPerf = performance.now();

      // Append user message
      const userMsgId = "user-" + requestAt;
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        sender: "user",
        content: trimmed,
        text: trimmed,
        timestamp: requestAt,
        status: "complete",
        isVoice: false,
        image,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Ultra-fast deterministic utility path: device-local time never needs a
      // network round-trip or model inference. This keeps simple clock checks
      // effectively instant while Gemini 3.5 remains the brain for real queries.
      const isLocalTimeQuery = /^(?:what(?:['’]s| is)?\s+time(?:\s+(?:right\s+now|rn|now))?|whats\s+time(?:\s+(?:right\s+now|rn|now))?|what\s+time\s+is\s+it|current\s+time|time\s+(?:right\s+now|rn|now))\??$/i.test(trimmed);
      if (isLocalTimeQuery && !image) {
        const now = new Date();
        const reply = `It is ${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, Boss.`;
        const completedAt = Date.now();
        const assistantMsgId = (settingsRef.current.selectedProfileId || "jarvis") + "-" + completedAt;
        const totalMs = Math.max(0, Math.round(performance.now() - requestPerf));
        setMessages((prev) => [...prev, {
          id: assistantMsgId,
          role: "assistant",
          sender: (settingsRef.current.selectedProfileId || "jarvis") as any,
          content: reply,
          text: reply,
          timestamp: completedAt,
          status: "complete",
          isStreaming: false,
          isVoice: !!settingsRef.current.voiceEnabled,
          timing: {
            requestAt,
            firstResponseAt: completedAt,
            completedAt,
            timeToFirstMs: totalMs,
            totalMs,
          },
        }]);
        if (!(await speakAssistantReply(reply))) {
          setState("idle");
        }
        return;
      }

      // 1. Check if command is a direct native Android app action and execute immediately
      if (await runAndroidAppCommand(trimmed, false)) return;

      // 2. Check if command is a direct browser action and execute immediately
      const browserIntent = parseBrowserIntent(trimmed, browserManager.isCurrentSiteYouTube());
      if (browserIntent) {
        browserManager.executeTool(browserIntent.name, browserIntent.args);
      }

      // 3. Check if command is an explicit screen share command
      const screenIntent = screenShareService.parseScreenShareIntent(trimmed);
      if (screenIntent) {
        try {
          if (screenIntent.type === "start") {
            await screenShareService.start();
          } else if (screenIntent.type === "stop") {
            screenShareService.stop();
          }
        } catch (err) {
          console.warn("Error running screen share intent:", err);
        }
      }

      // 4. Explicit memory commands are deterministic; otherwise ask Gemini
      // whether this message contains durable information worth remembering.
      const memoryIntent = memoryService.parseMemoryIntent(trimmed);
      if (memoryIntent) {
        try {
          if (memoryIntent.type === "save" && memoryIntent.content) {
            await memoryService.saveMemory(
              memoryIntent.content,
              memoryIntent.category,
              3,
              "user_explicit"
            );
          } else if (memoryIntent.type === "delete" && memoryIntent.target) {
            await memoryService.deleteMemoryByPattern(memoryIntent.target);
          } else if (memoryIntent.type === "clear") {
            await memoryService.clearMemories();
          }
        } catch (err) {
          console.warn("Error running memory intent:", err);
        }
      } else {
        // Do not make every normal chat message wait for the memory classifier.
        // The classifier is background-only; JARVIS should start answering immediately.
        void learnImplicitMemory(trimmed, "inferred");
      }

      // 5. Retrieve relevant memory context for the current query
      let memoryContext = "";
      try {
        if (memoryIntent?.type === "query") {
          const allMemories = await memoryService.getMemories();
          if (allMemories.length > 0) {
            const listStr = allMemories.map((m) => `- ${m.content} (${m.category})`).join("\n");
            memoryContext = `\n\n[USER SAVED MEMORIES LIST]:\n${listStr}\n(Summarize these memories naturally for the user.)`;
          } else {
            memoryContext = `\n\n[USER SAVED MEMORIES LIST]:\n(No saved memories currently exist. Let the user know you don't have any memories saved yet.)`;
          }
        } else {
          memoryContext = await memoryService.getRelevantContext(trimmed);
        }
      } catch (err) {
        console.warn("Failed to get memory context:", err);
      }

      // Record user activity in session tracker
      sessionService.recordActivity(true);

      // Retrieve temporal context and consume any pending return event for this interaction
      const temporalContext = sessionService.getTemporalContext(
        settingsRef.current.assistantName,
        settingsRef.current.voice
      );
      const browserContext = browserManager.getAssistantContext();
      sessionService.consumeReturnEvent();

      // Set state to thinking
      setState("thinking");

      // Check for screen frame if screen sharing is active
      const activeFrame = screenShareService.isSharing()
        ? screenShareService.captureFrame(true) || screenShareService.getLatestFrame()
        : null;

      // Construct combined contextual payload
      const combinedContext = [temporalContext, browserContext, memoryContext].filter(Boolean).join("\n");
      // Gemini 3.8 is the authoritative manager for every user query.
      // Gemini 3.1 Live only speaks the manager's final answer.
      try {
        if (settingsRef.current.voiceEnabled && !geminiLive.connected) {
          // Never block the brain request on the realtime voice connection.
          // A Live setup/reconnect can be slow or temporarily unavailable; the
          // authoritative 3.5 Flash answer must start immediately.
          void connectLive({
            voice: settingsRef.current.voice,
            systemInstruction: settingsRef.current.systemInstruction || JARVIS_SYSTEM_INSTRUCTION,
            model: settingsRef.current.liveModel,
            thinkingLevel: settingsRef.current.thinkingLevel,
            voiceOnly: true,
          }).catch((err) => console.warn("[Latency] Live reconnect failed:", err));
        }

        const assistantMsgId = (settingsRef.current.selectedProfileId || "jarvis") + "-" + Date.now();
        setMessages((prev) => [...prev, {
          id: assistantMsgId, role: "assistant",
          sender: (settingsRef.current.selectedProfileId || "jarvis") as any,
          content: "", text: "", timestamp: Date.now(),
          status: "streaming", isStreaming: true, isVoice: !!settingsRef.current.voiceEnabled,
        }]);

        let replyAccumulator = "";
        let firstResponseAt: number | undefined;
        setState("thinking");
        await managerService.send({
          message: trimmed,
          systemInstruction: settingsRef.current.systemInstruction || JARVIS_SYSTEM_INSTRUCTION,
          history: (() => {
            const recent = messagesRef.current.slice(-8).map((m) => ({
              role: (m.role === "user" || m.sender === "user" ? "user" : "model") as "user" | "model",
              text: (m.content || m.text || "").slice(-1800),
            }));
            let chars = 0;
            return recent.reverse().filter((item) => {
              const size = item.text.length;
              if (chars + size > 7000) return false;
              chars += size;
              return true;
            }).reverse();
          })(),
          context: combinedContext,
          image: image ? { data: image.data, mimeType: image.mimeType } : (activeFrame ? { data: activeFrame.base64, mimeType: activeFrame.mimeType } : undefined),
          model: settingsRef.current.brainModel || CHAT_MODEL,
        }, (chunk) => {
          if (!firstResponseAt) firstResponseAt = Date.now();
          replyAccumulator += chunk;
          const now = Date.now();
          const firstMs = firstResponseAt ? Math.max(0, firstResponseAt - requestAt) : undefined;
          setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? {
            ...m,
            content: replyAccumulator,
            text: replyAccumulator,
            status: "streaming",
            isStreaming: true,
            timing: {
              requestAt,
              firstResponseAt,
              timeToFirstMs: firstMs,
              completedAt: now,
              totalMs: Math.max(0, performance.now() - requestPerf),
            },
          } : m));
        }, async (toolCall) => {
          try {
            if (toolCall.name === "start_screen_share") await screenShareService.start();
            else if (toolCall.name === "stop_screen_share") screenShareService.stop();
            else if (toolCall.name === "save_memory") await memoryService.saveMemory(toolCall.args?.content || "", toolCall.args?.category, toolCall.args?.importance || 3, "user_explicit");
            else if (toolCall.name === "delete_memory") await memoryService.deleteMemoryByPattern(toolCall.args?.target || "");
            else if (toolCall.name === "clear_memories") await memoryService.clearMemories();
            else browserManager.executeTool(toolCall.name, toolCall.args || {});
          } catch (toolErr) {
            console.warn("Manager tool execution warning:", toolErr);
          }
        });

        const completedAt = Date.now();
        const totalMs = Math.max(0, Math.round(performance.now() - requestPerf));
        setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? {
          ...m,
          content: replyAccumulator,
          text: replyAccumulator,
          status: "complete",
          isStreaming: false,
          timing: {
            requestAt,
            firstResponseAt,
            completedAt,
            timeToFirstMs: firstResponseAt ? Math.max(0, firstResponseAt - requestAt) : undefined,
            totalMs,
          },
        } : m));

        if (!replyAccumulator || !(await speakAssistantReply(replyAccumulator))) {
          setState("idle");
        }
      } catch (err) {
        setState("idle");
        setActiveError(err instanceof Error ? err.message : "Failed to get response from JARVIS manager");
      }
    },
    [geminiLive, invalidateVoiceOutput, flushAudioQueue, stopPlayback, setAssistantSpeaking, isMicActive, connectLive, speakAssistantReply]
  );

  sendTextMessageRef.current = sendTextMessage;

  const loadConversation = useCallback((conversation: ChatMessage[]) => {
    invalidateVoiceOutput();
    stopPlayback();
    setAssistantSpeaking(false);
    setMessages(Array.isArray(conversation) ? conversation : []);
    setState("idle");
  }, [invalidateVoiceOutput, stopPlayback, setAssistantSpeaking]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    try {
      defaultMemoryStore.clearConversationHistory();
    } catch {
      // Safe fallback
    }
  }, []);

  const dismissError = useCallback(() => {
    setActiveError(null);
    clearPermissionError();
    clearLiveError();
  }, [clearPermissionError, clearLiveError]);

  const startScreenShare = useCallback(async () => {
    const res = await screenShareService.start();
    if (!res.success && res.message) {
      setActiveError(res.message);
    } else if (res.success) {
      setActiveError(null);
      // Announce screen share active in chat
      const id = "jarvis-" + Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "assistant",
          sender: "jarvis",
          content: "Screen sharing is active. I can now see your screen.",
          text: "Screen sharing is active. I can now see your screen.",
          timestamp: Date.now(),
          status: "complete",
          isVoice: false,
        },
      ]);
    }
    return res;
  }, []);

  const stopScreenShare = useCallback(() => {
    screenShareService.stop();
  }, []);

  const deliverGreeting = useCallback(
    async (text: string) => {
      const isIra =
        settingsRef.current.selectedProfileId === "ira" ||
        settingsRef.current.voice === "Aoede";
      const returnMsgId = (isIra ? "ira" : "jarvis") + "-return-" + Date.now();

      // Display the automatic return greeting in the UI immediately
      setMessages((prev) => [
        ...prev,
        {
          id: returnMsgId,
          role: "assistant",
          sender: isIra ? "ira" : "jarvis",
          content: text,
          text,
          timestamp: Date.now(),
          status: "complete",
          isVoice: true,
        },
      ]);

      // Use Gemini 3.1 Live as the voice layer for greetings too. speakAssistantReply
      // now owns the Live-first / TTS-fallback logic, so there is no second
      // playback path here. Launch must stay silent, so callers that render the
      // return greeting without audio simply don't invoke this.
      if (settingsRef.current.voiceEnabled) {
        try {
          await speakAssistantReply(text);
        } catch (err) {
          console.warn("Failed to generate return greeting:", err);
        }
      }
    },
    [geminiLive, playAudioChunk, setAssistantSpeaking, speakAssistantReply]
  );

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  const overallStatus: ConnectionStatus = isAndroidApp()
    ? "online"
    : (permissionError || liveError ? "error" : liveStatus);

  return {
    state,
    settings,
    updateSettings,
    messages,
    currentTranscript,
    isMicActive: isAndroidApp() ? androidMicActive : isMicActive,
    micLevel,
    outputLevel,
    connectionStatus: overallStatus,
    activeError: activeError || permissionError || liveError,
    screenShareStatus,
    isScreenSharing: screenShareStatus.state === "SHARING",
    startScreenShare,
    stopScreenShare,
    toggleListening,
    sendTextMessage,
    handleInterrupt,
    clearMessages,
    loadConversation,
    dismissError,
    deliverGreeting,
    reconnect: connectLive,
  };
}
