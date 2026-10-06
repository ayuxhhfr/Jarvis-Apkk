/**
 * JARVIS - Personal Assistant Web Application.
 * Core application layout integrating the central digital Earth globe,
 * Gemini Live API real-time voice, streaming transcripts, and built-in browser overlay.
 */

import React, { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header";
import { AIOrb } from "./components/AIOrb";
import { VoiceButton } from "./components/VoiceButton";
import { StatusIndicator } from "./components/StatusIndicator";
import { Chat } from "./components/Chat";
import { InputBar } from "./components/InputBar";
import { Settings } from "./components/Settings";
import { AndroidSetup } from "./components/AndroidSetup";
import { BrowserView } from "./components/Browser/BrowserView";
import { browserManager } from "./services/browserManager";
import { screenShareService } from "./services/screenShareService";
import { sessionService } from "./services/sessionService";
import { useBrowser } from "./hooks/useBrowser";
import { useAssistant } from "./hooks/useAssistant";
import { getAndroidApiKey, isAndroidApp, speakAndroid, listenAndroidOnce } from "./services/androidRuntime";
import { startAndroidWakeWord, resumeAndroidWakeWord } from "./services/androidAppActions";
import { AlertCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { ChatSidebar, ChatSession } from "./components/ChatSidebar";

export default function App() {
  const {
    state,
    settings,
    updateSettings,
    messages,
    isMicActive,
    micLevel,
    outputLevel,
    connectionStatus,
    activeError,
    screenShareStatus,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    toggleListening,
    sendTextMessage,
    handleInterrupt,
    clearMessages,
    loadConversation,
    dismissError,
    deliverGreeting,
  } = useAssistant();

  const { browserOpen } = useBrowser();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAndroidSetup, setShowAndroidSetup] = useState(() => isAndroidApp() && !getAndroidApiKey());
  const [wakeWordActive, setWakeWordActive] = useState(() => isAndroidApp() && localStorage.getItem("jarvis_wake_word_enabled") === "true");
  const wakeCleanupRef = useRef<(() => void) | null>(null);
  const wakeCommandListeningRef = useRef(false);
  const [isChatsOpen, setIsChatsOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState(() => sessionService.getMetadata().currentSessionId);
  const [isChatExpanded, setIsChatExpanded] = useState(false);

  const toggleWakeWord = async () => {
    if (!isAndroidApp()) {
      console.warn("[JARVIS Wake Word] Wake word is available only in the Android app.");
      return;
    }

    if (wakeWordActive) {
      wakeCleanupRef.current?.();
      wakeCleanupRef.current = null;
      setWakeWordActive(false);
      localStorage.setItem("jarvis_wake_word_enabled", "false");
      return;
    }

    try {
      const cleanup = await startAndroidWakeWord("jarvis", async (command) => {
        if (command) {
          await sendTextMessage(command);
          await resumeAndroidWakeWord("jarvis");
          return;
        }

        // Two-stage wake flow: "Jarvis" -> acknowledgement -> one-shot command capture.
        if (wakeCommandListeningRef.current) return;
        wakeCommandListeningRef.current = true;
        try {
          await speakAndroid("Yes Boss, I'm listening.");
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          await listenAndroidOnce(
            async (text) => {
              if (text.trim()) await sendTextMessage(text.trim());
              await resumeAndroidWakeWord("jarvis");
              wakeCommandListeningRef.current = false;
            },
            () => {
              wakeCommandListeningRef.current = false;
            }
          );
        } catch {
          wakeCommandListeningRef.current = false;
        }
      }, (message) => {
        console.warn("[JARVIS Wake Word]", message);
      });

      wakeCleanupRef.current = cleanup;
      setWakeWordActive(true);
      localStorage.setItem("jarvis_wake_word_enabled", "true");
    } catch (error) {
      console.warn("[JARVIS Wake Word] failed to start", error);
      setWakeWordActive(false);
      localStorage.setItem("jarvis_wake_word_enabled", "false");
    }
  };

  useEffect(() => {
    if (!wakeWordActive || !isAndroidApp() || !getAndroidApiKey()) return;
    let cancelled = false;
    void (async () => {
      try {
        const cleanup = await startAndroidWakeWord("jarvis", async (command) => {
          if (cancelled) return;
          if (command) {
            await sendTextMessage(command);
            await resumeAndroidWakeWord("jarvis");
          } else if (!wakeCommandListeningRef.current) {
            wakeCommandListeningRef.current = true;
            try {
              await speakAndroid("Yes Boss, I'm listening.");
              await new Promise<void>((resolve) => setTimeout(resolve, 250));
              await listenAndroidOnce(
                async (text) => {
                  if (text.trim()) await sendTextMessage(text.trim());
                  await resumeAndroidWakeWord("jarvis");
                  wakeCommandListeningRef.current = false;
                },
                () => {
                  wakeCommandListeningRef.current = false;
                }
              );
            } catch {
              wakeCommandListeningRef.current = false;
              await resumeAndroidWakeWord("jarvis");
            }
          }
        });
        if (cancelled) cleanup();
        else wakeCleanupRef.current = cleanup;
      } catch {}
    })();
    return () => {
      cancelled = true;
      wakeCleanupRef.current?.();
      wakeCleanupRef.current = null;
    };
  }, []);

  // Live time and date for technical left information HUD
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");

  // Initialize sessionService on mount with deterministic flow and deliver return greeting if detected
  useEffect(() => {
    // 1. Load metadata & initialize session (calculates duration, classifies absence)
    const returnEvent = sessionService.initSession(settings.voice);

    // 2. Determine if a return event exists
    if (returnEvent && !returnEvent.consumed) {
      const isIra = settings.selectedProfileId === "ira" || settings.voice === "Aoede";
      const greetingText = isIra
        ? returnEvent.suggestedGreeting.ira
        : returnEvent.suggestedGreeting.jarvis;

      console.log("[JARVIS Return]\nAutomatic return greeting triggered.");

      // 3. Trigger the greeting immediately via the assistant's existing output path
      deliverGreeting(greetingText);

      // 4. Mark the event as consumed to prevent repeats
      sessionService.consumeReturnEvent();
      console.log("[JARVIS Return]\nReturn greeting consumed.");
    } else {
      console.log("[JARVIS Return]\nNo return greeting required.");
    }
  }, [deliverGreeting, settings.voice, settings.selectedProfileId]);


  // Keep the current conversation mirrored into the persistent sidebar index.
  useEffect(() => {
    if (!activeChatId) return;
    // Never serialize the full chat-session index for every streamed token.
    if (messages.some((message) => message.isStreaming || message.status === "streaming")) return;

    const timer = window.setTimeout(() => {
      try {
        const key = "jarvis_chat_sessions_v2";
        const raw = localStorage.getItem(key);
        const sessions = raw ? JSON.parse(raw) : [];
        const existing = Array.isArray(sessions) ? sessions : [];
        const titleMessage = messages.find(m => m.role === "user" && (m.content || m.text));
        const titleRaw = (titleMessage?.content || titleMessage?.text || "New conversation").trim();
        const session = {
          id: activeChatId,
          title: titleRaw.length > 34 ? titleRaw.slice(0, 34) + "…" : titleRaw,
          messages,
          updatedAt: Date.now(),
        };
        const merged = existing.some((s: any) => s.id === activeChatId)
          ? existing.map((s: any) => s.id === activeChatId ? session : s)
          : [session, ...existing];
        localStorage.setItem(key, JSON.stringify(merged.sort((a: any,b: any) => b.updatedAt - a.updatedAt).slice(0, 50)));
      } catch {}
    }, 400);

    return () => window.clearTimeout(timer);
  }, [messages, activeChatId]);

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setCurrentDate(
        now.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }).toUpperCase()
      );
    };

    updateDateTime();
    const timer = setInterval(updateDateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full h-[100dvh] flex flex-col justify-between overflow-hidden bg-[#08090a] text-[#e6e8eb] select-none">
      {showAndroidSetup && <AndroidSetup onComplete={() => setShowAndroidSetup(false)} />}
      {/* Background ambient lighting */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_40%,rgba(0,255,170,0.03)_0%,transparent_65%)]" />

      {/* Conditional Rendering between Browser Overlay and Normal JARVIS Interface */}
      {browserOpen ? (
        /* LAYER 2: JARVIS Built-In Browser Overlay */
        <BrowserView />
      ) : (
        /* LAYER 1: JARVIS Personal Assistant Shell */
        <div className="relative w-full h-full flex flex-col justify-between overflow-hidden">
          {/* Top Header */}
          <Header
            assistantName={settings.assistantName}
            status={connectionStatus}
            screenShareStatus={screenShareStatus}
            onStartScreenShare={startScreenShare}
            onStopScreenShare={stopScreenShare}
            onOpenInNewTab={() => screenShareService.openInNewTab()}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenBrowser={() => browserManager.open()}
            onOpenChats={() => setIsChatsOpen(true)}
            wakeWordActive={wakeWordActive}
            onToggleWakeWord={toggleWakeWord}
          />

          {/* Error Banner */}
          {activeError && (
            <div className="relative z-40 mx-4 mt-2 px-4 py-2.5 rounded-xl bg-rose-950/80 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between shadow-lg backdrop-blur-md animate-fadeIn gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{activeError}</span>
                {(screenShareStatus.isIframeRestricted ||
                  activeError.toLowerCase().includes("new tab")) && (
                  <a
                    href={typeof window !== "undefined" ? window.location.href : "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-mono text-[11px] border border-cyan-500/40 transition-colors"
                  >
                    Open in New Tab ↗
                  </a>
                )}
              </div>
              <button
                onClick={dismissError}
                className="p-1 hover:text-white transition-colors cursor-pointer shrink-0"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main Interactive Stage */}
          <main className="relative flex-1 flex flex-col items-center justify-center min-h-0 w-full max-w-7xl mx-auto px-4">
            {/* Left Information Area (Desktop only) */}
            <aside className="hidden lg:flex absolute left-8 top-12 flex-col gap-5 select-none pointer-events-none font-mono">
              <div className="space-y-1">
                <div className="text-2xl font-light tracking-[0.2em] text-white">
                  {currentTime || "00:00:00"}
                </div>
                <div className="text-[10px] tracking-[0.25em] text-neutral-500 font-medium">
                  {currentDate}
                </div>
              </div>

              <div className="w-12 h-[1px] bg-white/[0.08]" />

              <div className="max-w-[180px] space-y-1">
                <p className="text-[11px] leading-relaxed tracking-[0.15em] text-neutral-400 uppercase font-light">
                  "SAME THINKING.
                  <br />
                  DIFFERENT PERSPECTIVE."
                </p>
              </div>
            </aside>

            {/* Right Status Area (Desktop only) */}
            <aside className="hidden lg:flex absolute right-8 top-12 pointer-events-none">
              <StatusIndicator state={state} />
            </aside>

            {/* Center: Digital Earth Globe + Primary Voice Button */}
            <div className="relative flex flex-col items-center justify-center w-full transition-all duration-500 ease-out">
              {/* Globe Container */}
              <div className={`relative transition-all duration-300 flex items-center justify-center ${
                messages.length > 0
                  ? isChatExpanded
                    ? "w-28 h-28 xs:w-32 xs:h-32 sm:w-40 sm:h-40 md:w-52 md:h-52 lg:w-64 lg:h-64"
                    : "w-40 h-40 xs:w-44 xs:h-44 sm:w-56 sm:h-56 md:w-72 md:h-72 lg:w-80 lg:h-80"
                  : "w-52 h-52 xs:w-60 xs:h-60 sm:w-72 sm:h-72 md:w-80 md:h-80 lg:w-96 lg:h-96"
              }`}>
                <AIOrb
                  state={state}
                  micLevel={micLevel}
                  outputLevel={outputLevel}
                  className="w-full h-full"
                />
              </div>

              {/* Primary Microphone Button directly below globe */}
              <div className={`transition-all duration-300 z-20 ${
                messages.length > 0
                  ? "mt-1 sm:mt-2"
                  : "mt-3 sm:mt-5"
              }`}>
                <VoiceButton
                  state={state}
                  isMicActive={isMicActive}
                  micLevel={micLevel}
                  outputLevel={outputLevel}
                  onToggle={toggleListening}
                  onInterrupt={handleInterrupt}
                />
              </div>
            </div>

            {/* Desktop Small Information Cards (Clean and secondary) */}
            <div className="hidden lg:grid grid-cols-3 gap-3 w-full max-w-xl mx-auto mt-4 px-2 select-none pointer-events-none">
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center">
                <div className="text-[11px] font-mono font-medium text-white tracking-wider uppercase">
                  Ready
                </div>
                <div className="text-[10px] font-sans text-neutral-500 mt-0.5">
                  Tap the mic to start a conversation.
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center">
                <div className="text-[11px] font-mono font-medium text-[#00ffaa]/90 tracking-wider uppercase">
                  Powered by Gemini
                </div>
                <div className="text-[10px] font-sans text-neutral-500 mt-0.5">
                  Fast. Intelligent. Reliable.
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center">
                <div className="text-[11px] font-mono font-medium text-white tracking-wider uppercase">
                  Your Assistant
                </div>
                <div className="text-[10px] font-sans text-neutral-500 mt-0.5">
                  Talk. Type. Get things done.
                </div>
              </div>
            </div>

            {/* Live Conversation / Transcript Stream (Responsive Drawer) */}
            <div
              className={`absolute left-0 right-0 bottom-1 sm:bottom-2 w-full max-w-2xl mx-auto transition-all duration-300 flex flex-col z-20 min-h-0 ${
                messages.length > 0
                  ? isChatExpanded
                    ? "h-[38%] min-h-[180px]"
                    : "h-40 sm:h-48"
                  : "h-0 opacity-0 pointer-events-none"
              }`}
            >
              {messages.length > 0 && (
                <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-mono text-neutral-500 border-b border-white/[0.04] bg-[#0c0e11]/60 rounded-t-xl">
                  <span>CHAT HISTORY ({messages.length})</span>
                  <button
                    onClick={() => setIsChatExpanded(!isChatExpanded)}
                    className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
                  >
                    {isChatExpanded ? (
                      <>
                        <span>Minimize</span>
                        <ChevronDown className="w-3 h-3" />
                      </>
                    ) : (
                      <>
                        <span>Expand</span>
                        <ChevronUp className="w-3 h-3" />
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0 bg-[#0c0e11]/80 backdrop-blur-md rounded-xl border border-white/[0.06] overflow-hidden">
                <Chat messages={messages} onClear={clearMessages} />
              </div>
            </div>
          </main>

          {/* Bottom Text Input Bar */}
          <footer className="jarvis-safe-bottom w-full z-30 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
            <InputBar
              onSendMessage={sendTextMessage}
              onToggleMic={toggleListening}
              isMicActive={isMicActive}
              state={state}
            />
          </footer>
        </div>
      )}

      {isChatsOpen && (
        <ChatSidebar
          messages={messages}
          activeId={activeChatId}
          onClose={() => setIsChatsOpen(false)}
          onNew={() => {
            clearMessages();
            setActiveChatId("chat_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7));
            setIsChatsOpen(false);
          }}
          onSelect={(session: ChatSession) => {
            setActiveChatId(session.id);
            loadConversation(session.messages);
            setIsChatsOpen(false);
          }}
        />
      )}

      {/* Settings Modal (available from either view) */}
      {isSettingsOpen && (
        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          onSave={updateSettings}
          connectionStatus={connectionStatus}
          isMicActive={isMicActive}
        />
      )}
    </div>
  );
}
