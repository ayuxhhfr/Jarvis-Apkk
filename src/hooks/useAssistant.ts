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
import { isAndroidApp } from "../services/androidRuntime";

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

  // Persist conversation history changes
  useEffect(() => {
    try {
      defaultMemoryStore.saveConversationHistory(messages);
    } catch (err) {
      console.warn("Failed to persist conversation history:", err);
    }
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
  } = useVoice();

  // Gemini Live WebSocket bridge hook
  const {
    status: liveStatus,
    errorMessage: liveError,
    connect: connectLive,
    sendAudio,
    sendInterrupt,
    geminiLive,
  } = useGeminiLive({
    model: settings.liveModel,
    voice: settings.voice,
    thinkingLevel: settings.thinkingLevel,
    systemInstruction: settings.systemInstruction,
    voiceOnly: true,
  });

  /**
   * Universal user interruption handler.
   */
  const handleInterrupt = useCallback(() => {
    // 1. Stop audio playback & speech
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
  }, [stopPlayback, setAssistantSpeaking, sendInterrupt, isMicActive]);

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
      speechReceivedInCurrentTurnRef.current = true;

      // Transition to speaking state
      if (stateRef.current !== "speaking") {
        setState("speaking");
        setAssistantSpeaking(true);
      }

      if (settingsRef.current.voiceEnabled) {
        playAudioChunk(base64Audio, () => {
          // Playback finished if queue is empty
          if (stateRef.current === "speaking" && !speechReceivedInCurrentTurnRef.current) {
            setState(isMicActive ? "listening" : "idle");
            setAssistantSpeaking(false);
          }
        });
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

    // User speech recognition transcript from Gemini Live
    const unsubUserTranscript = geminiLive.onUserTranscript(async ({ text: userText, finished }) => {
      const clean = userText.trim();
      if (!clean) return;

      if (!currentUserIdRef.current) {
        const id = "user-" + Date.now();
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
        sessionService.recordActivity(true);
        sessionService.consumeReturnEvent();

        // Declared outside the try so the catch block can clean up the placeholder message.
        let assistantMsgId = "";
        try {
          const browserIntent = parseBrowserIntent(clean, browserManager.isCurrentSiteYouTube());
          if (browserIntent) browserManager.executeTool(browserIntent.name, browserIntent.args);

          const memoryIntent = memoryService.parseMemoryIntent(clean);
          if (memoryIntent) {
            if (memoryIntent.type === "save" && memoryIntent.content) await memoryService.saveMemory(memoryIntent.content, memoryIntent.category, 3, "voice_command");
            else if (memoryIntent.type === "delete" && memoryIntent.target) await memoryService.deleteMemoryByPattern(memoryIntent.target);
            else if (memoryIntent.type === "clear") await memoryService.clearMemories();
          } else {
            await learnImplicitMemory(clean, "voice_command");
          }

          const screenIntent = screenShareService.parseScreenShareIntent(clean);
          if (screenIntent) {
            if (screenIntent.type === "start") await screenShareService.start();
            else if (screenIntent.type === "stop") screenShareService.stop();
          }

          const memoryContext = await memoryService.getRelevantContext(clean).catch(() => "");
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
            reply += chunk;
            setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? {
              ...m, content: reply, text: reply, status: "streaming", isStreaming: true,
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

          setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? {
            ...m, content: reply, text: reply, status: "complete", isStreaming: false,
          } : m));

          if (reply && settingsRef.current.voiceEnabled && geminiLive.connected) {
            setState("speaking");
            setAssistantSpeaking(true);
            geminiLive.speakText(reply);
          } else {
            setState("idle");
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to get response from JARVIS manager";
          console.warn("Manager voice turn failed:", err);
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
          setActiveError(message);
          setState("idle");
          stopPlayback();
          setAssistantSpeaking(false);
        } finally {
          currentUserIdRef.current = null;
        }
      }
    });

    // Server-side interruption acknowledgement
    const unsubInterrupted = geminiLive.onInterrupted(() => {
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
      setState(isMicActive ? "listening" : "idle");
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

    // Model turn complete
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

      // If audio is finished or voice is disabled, return to listening/idle
      setTimeout(() => {
        if (stateRef.current === "speaking" || stateRef.current === "thinking") {
          setState(isMicActive ? "listening" : "idle");
          setAssistantSpeaking(false);
        }
      }, 500);
    });

    return () => {
      unsubAudio();
      unsubText();
      unsubUserTranscript();
      unsubInterrupted();
      unsubToolCall();
      unsubTurnComplete();
    };
  }, [geminiLive, isMicActive, playAudioChunk, setAssistantSpeaking, stopPlayback]);

  /**
   * Toggle Voice Microphone.
   */
  const toggleListening = useCallback(async () => {
    if (isAndroidApp()) {
      // Android now uses the same raw PCM Live path as desktop, but connects
      // directly to Google's Live WebSocket instead of the Node server.
      if (androidMicActive) {
        try {
          // Flush Google's automatic VAD before stopping the local mic.
          sendInterrupt();
          stopListening();
        } finally {
          setAndroidMicActive(false);
          stopPlayback();
          setAssistantSpeaking(false);
          setState("idle");
        }
        return;
      }

      try {
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

        setState("listening");
        setAndroidMicActive(true);

        await startListening(
          (base64Pcm) => sendAudio(base64Pcm),
          () => handleInterrupt()
        );
      } catch (err) {
        setAndroidMicActive(false);
        setState("idle");
        setActiveError(err instanceof Error ? err.message : "Failed to activate microphone");
      }
      return;
    }

    if (isMicActive) {
      stopListening();
      stopPlayback();
      setAssistantSpeaking(false);
      setState("idle");
    } else {
      try {
        if (stateRef.current === "speaking") {
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
        setState("listening");
        if (settingsRef.current.selectedProfileId === "ira" && ASSISTANT_PROFILES.ira.initialGreeting) {
          const profile = ASSISTANT_PROFILES.ira;
          if (geminiLive.connected && profile.initialGreeting) geminiLive.speakText(profile.initialGreeting);
        }
        await startListening((base64Pcm) => sendAudio(base64Pcm), () => handleInterrupt());
      } catch (err) {
        setState("idle");
        setActiveError(err instanceof Error ? err.message : "Failed to activate microphone");
      }
    }
  }, [androidMicActive, isMicActive, stopListening, stopPlayback, setAssistantSpeaking, geminiLive, connectLive, startListening, sendAudio, handleInterrupt]);

  /**
   * Send text message.
   */
  const sendTextMessage = useCallback(
    async (text: string, image?: { data: string; mimeType: string }) => {
      const trimmed = text.trim();
      if (!trimmed && !image) return;

      // Stop any current speaking/playback
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

      // 1. Check if command is a direct browser action and execute immediately
      const browserIntent = parseBrowserIntent(trimmed, browserManager.isCurrentSiteYouTube());
      if (browserIntent) {
        browserManager.executeTool(browserIntent.name, browserIntent.args);
      }

      // 2. Check if command is an explicit screen share command
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

      // 3. Explicit memory commands are deterministic; otherwise ask Gemini
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
        await learnImplicitMemory(trimmed, "inferred");
      }

      // 4. Retrieve relevant memory context for the current query
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
          history: messagesRef.current.slice(-10).map((m) => ({
            role: m.role === "user" || m.sender === "user" ? "user" : "model",
            text: m.content || m.text || "",
          })),
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

        if (settingsRef.current.voiceEnabled && replyAccumulator && geminiLive.connected) {
          setState("speaking");
          setAssistantSpeaking(true);
          geminiLive.speakText(replyAccumulator);
        } else {
          setState("idle");
        }
      } catch (err) {
        setState("idle");
        setActiveError(err instanceof Error ? err.message : "Failed to get response from JARVIS manager");
      }
    },
    [geminiLive, stopPlayback, setAssistantSpeaking, isMicActive, connectLive]
  );

  sendTextMessageRef.current = sendTextMessage;

  const loadConversation = useCallback((conversation: ChatMessage[]) => {
    stopPlayback();
    setAssistantSpeaking(false);
    setMessages(Array.isArray(conversation) ? conversation : []);
    setState("idle");
  }, [stopPlayback, setAssistantSpeaking]);

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
  }, []);

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

      // Use Gemini 3.1 Live as the voice layer for greetings too.
      // Keep the old TTS path only as a compatibility fallback if Live is unavailable.
      if (settingsRef.current.voiceEnabled) {
        try {
          if (geminiLive.connected) {
            setAssistantSpeaking(true);
            geminiLive.speakText(text);
          } else {
            const audio = await geminiText.textToSpeech(text, settingsRef.current.voice);
            if (audio) {
              setAssistantSpeaking(true);
              playAudioChunk(audio, () => setAssistantSpeaking(false));
            }
          }
        } catch (err) {
          console.warn("Failed to generate return greeting:", err);
        }
      }
    },
    [geminiLive, playAudioChunk, setAssistantSpeaking]
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