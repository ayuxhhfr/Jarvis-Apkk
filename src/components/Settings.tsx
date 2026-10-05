/**
 * Settings Modal for JARVIS.
 * Configures assistant personality, voice preferences, Live model specification,
 * system instruction editing, and hardware connection diagnostics.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  RotateCcw,
  Check,
  Sparkles,
  Mic,
  Radio,
  Volume2,
  Cpu,
  Brain,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { AssistantSettings, ConnectionStatus } from "../types/assistant";
import { MemoryItem } from "../types/memory";
import { AVAILABLE_VOICES } from "../config/voiceConfig";
import { CHAT_MODEL, CHAT_MODEL_NAME, LIVE_MODEL, LIVE_MODEL_NAME, THINKING_LEVEL } from "../config/modelConfig";
import { JARVIS_SYSTEM_INSTRUCTION } from "../config/jarvisConfig";
import { ASSISTANT_PROFILES } from "../config/assistantProfiles";
import { memoryService } from "../services/memoryService";
import { getAndroidApiKey, setAndroidApiKey, validateAndroidApiKey } from "../services/androidRuntime";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AssistantSettings;
  onSave: (newSettings: Partial<AssistantSettings>) => void;
  connectionStatus: ConnectionStatus;
  isMicActive: boolean;
}

export const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  connectionStatus,
  isMicActive,
}) => {
  const [selectedProfileId, setSelectedProfileId] = useState(
    settings.selectedProfileId || (settings.voice === "Aoede" ? "ira" : "jarvis")
  );
  const [assistantName, setAssistantName] = useState(settings.assistantName);
  const [voice, setVoice] = useState(settings.voice);
  const [liveModel, setLiveModel] = useState(settings.liveModel || LIVE_MODEL);
  const [brainModel, setBrainModel] = useState(settings.brainModel || CHAT_MODEL);
  const [backgroundModel, setBackgroundModel] = useState(settings.backgroundModel || "auto");
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled);
  const [systemInstruction, setSystemInstruction] = useState(settings.systemInstruction);
  const [savedNotice, setSavedNotice] = useState(false);
  const [androidApiKey, setAndroidApiKeyState] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStep, setSaveStep] = useState<"idle" | "checking" | "saving">("idle");

  useEffect(() => {
    if (isOpen) {
      setSelectedProfileId(settings.selectedProfileId || (settings.voice === "Aoede" ? "ira" : "jarvis"));
      setAssistantName(settings.assistantName);
      setVoice(settings.voice);
      setLiveModel(settings.liveModel || LIVE_MODEL);
      setBrainModel(settings.brainModel || CHAT_MODEL);
      setBackgroundModel(settings.backgroundModel || "auto");
      setVoiceEnabled(settings.voiceEnabled);
      setSystemInstruction(settings.systemInstruction);
      setAndroidApiKeyState(getAndroidApiKey());
      setApiKeyStatus("");
      setIsSaving(false);
      setSaveStep("idle");
    }
  }, [isOpen, settings]);

  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    if (profileId === "ira") {
      setAssistantName("Ira");
      setVoice("Aoede");
      setSystemInstruction(ASSISTANT_PROFILES.ira.systemInstruction);
    } else {
      setAssistantName("JARVIS");
      setVoice("Enceladus");
      setSystemInstruction(ASSISTANT_PROFILES.jarvis.systemInstruction);
    }
  };

  // Memory state
  const [memoryEnabled, setMemoryEnabled] = useState<boolean>(true);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isMemoriesOpen, setIsMemoriesOpen] = useState(false);
  const [clearConfirming, setClearConfirming] = useState(false);

  const loadMemories = useCallback(async () => {
    try {
      setMemoryEnabled(memoryService.isEnabled());
      const all = await memoryService.getMemories();
      setMemories(all);
    } catch {
      // Safe fallback
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadMemories();
      const unsub = memoryService.subscribe(() => {
        loadMemories();
      });
      return unsub;
    }
  }, [isOpen, loadMemories]);

  if (!isOpen) return null;

  const handleToggleMemory = (enabled: boolean) => {
    setMemoryEnabled(enabled);
    memoryService.setEnabled(enabled);
  };

  const handleDeleteMemory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await memoryService.deleteMemory(id);
    await loadMemories();
  };

  const handleClearAllMemories = async () => {
    await memoryService.clearMemories();
    await loadMemories();
    setClearConfirming(false);
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);

    const currentStoredKey = getAndroidApiKey().trim();
    const enteredKey = androidApiKey.trim();

    // Don't re-run a network model check when the API key hasn't changed.
    // This makes normal settings saves effectively instant.
    if (enteredKey && enteredKey !== currentStoredKey) {
      try {
        setSaveStep("checking");
        setApiKeyStatus("Checking Gemini API key + model access...");
        await validateAndroidApiKey(enteredKey);
        setApiKeyStatus("Gemini model check passed");
      } catch (err) {
        setIsSaving(false);
        setSaveStep("idle");
        setApiKeyStatus(err instanceof Error ? err.message : "API key validation failed");
        return;
      }
    } else if (!enteredKey) {
      setAndroidApiKey("");
    }

    setSaveStep("saving");
    onSave({
      selectedProfileId,
      assistantName,
      voice,
      liveModel,
      brainModel,
      backgroundModel,
      voiceEnabled,
      systemInstruction,
    });
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 600);
  };

  const handleResetInstruction = () => {
    if (selectedProfileId === "ira") {
      setSystemInstruction(ASSISTANT_PROFILES.ira.systemInstruction);
    } else {
      setSystemInstruction(ASSISTANT_PROFILES.jarvis.systemInstruction);
    }
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case "project":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "preference":
        return "bg-emerald-500/10 text-[#00ffaa] border-[#00ffaa]/20";
      case "technical":
        return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      case "instruction":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "personal":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      default:
        return "bg-neutral-500/10 text-neutral-400 border-neutral-500/20";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0c0e11] border border-white/[0.1] shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#0f1216]">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#00ffaa]" />
            <h2 className="text-base font-semibold tracking-wider text-white uppercase font-mono">
              JARVIS Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
          {/* Status & Diagnostics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div>
              <div className="text-[10px] font-mono uppercase text-neutral-500 tracking-wider">
                Connection
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 font-mono text-xs text-[#00ffaa]">
                <Radio className="w-3 h-3" />
                <span className="capitalize">{connectionStatus}</span>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase text-neutral-500 tracking-wider">
                Microphone
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 font-mono text-xs text-neutral-300">
                <Mic className="w-3 h-3" />
                <span>{isMicActive ? "Active" : "Standby"}</span>
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <div className="text-[10px] font-mono uppercase text-neutral-500 tracking-wider">
                Architecture
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 font-mono text-xs text-cyan-400">
                <Cpu className="w-3 h-3" />
                <span>Live WebSocket</span>
              </div>
            </div>
          </div>

          {/* Android Gemini API Key */}
          <div className="p-4 rounded-xl bg-[#12161a] border border-white/[0.08] space-y-3">
            <div>
              <div className="text-sm font-medium text-white">Android Gemini API Key</div>
              <div className="text-xs text-neutral-400 mt-1">Required for the APK voice/text runtime.</div>
            </div>
            <input
              type="password"
              value={androidApiKey}
              onChange={(e) => { setAndroidApiKeyState(e.target.value); setApiKeyStatus(""); }}
              placeholder="AIza..."
              className="w-full px-3 py-2.5 rounded-xl bg-[#0b0e11] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-white font-mono text-xs"
            />
            {apiKeyStatus && <div className={`text-[11px] ${apiKeyStatus === "API key verified" ? "text-[#00ffaa]" : "text-red-400"}`}>{apiKeyStatus}</div>}
          </div>

          {/* AI Model Routing */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono uppercase text-neutral-400 tracking-wider">
                AI Models
              </label>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00ffaa]/10 text-[#00ffaa] border border-[#00ffaa]/20">
                Default Routing
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#12161a] border border-white/[0.08] space-y-2">
                <div className="text-[10px] font-mono uppercase text-neutral-500">Brain</div>
                <select
                  value={brainModel}
                  onChange={(e) => setBrainModel(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0b0e11] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-white text-xs"
                >
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
                  <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                  <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                </select>
                <div className="text-[10px] text-neutral-500">Reasoning, conversation & decisions</div>
              </div>

              <div className="p-3 rounded-xl bg-[#12161a] border border-white/[0.08] space-y-2">
                <div className="text-[10px] font-mono uppercase text-neutral-500">Voice</div>
                <select
                  value={liveModel}
                  onChange={(e) => setLiveModel(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0b0e11] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-white text-xs"
                >
                  <option value="gemini-3.1-flash-live-preview">Gemini 3.1 Flash Live Preview</option>
                  <option value="gemini-3.8-live">Gemini 3.8 Live</option>
                </select>
                <div className="text-[10px] text-neutral-500">Realtime voice input/output</div>
              </div>

              <div className="p-3 rounded-xl bg-[#12161a] border border-white/[0.08] space-y-2">
                <div className="text-[10px] font-mono uppercase text-neutral-500">Background</div>
                <select
                  value={backgroundModel}
                  onChange={(e) => setBackgroundModel(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0b0e11] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-white text-xs"
                >
                  <option value="auto">Auto</option>
                  <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
                </select>
                <div className="text-[10px] text-neutral-500">Memory & background tasks</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#12161a] border border-white/[0.08] text-[11px] font-mono">
              <div className="text-white font-medium">{CHAT_MODEL_NAME} brain default</div>
              <div className="text-neutral-500 mt-1">Voice default: {LIVE_MODEL_NAME} · Thinking: {THINKING_LEVEL}</div>
            </div>
          </div>

          {/* Assistant Voice & Persona Selector */}
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-neutral-400 tracking-wider">
              Assistant Voice & Persona
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSelectProfile("jarvis")}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  selectedProfileId === "jarvis"
                    ? "bg-[#00ffaa]/10 border-[#00ffaa] text-white shadow-[0_0_15px_rgba(0,255,170,0.15)]"
                    : "bg-[#12161a] border-white/[0.08] text-neutral-400 hover:text-white hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm text-white">
                  <span>JARVIS</span>
                  {selectedProfileId === "jarvis" && (
                    <span className="w-2 h-2 rounded-full bg-[#00ffaa]" />
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                  Calm, refined male voice (Enceladus)
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProfile("ira")}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  selectedProfileId === "ira"
                    ? "bg-[#00ffaa]/10 border-[#00ffaa] text-white shadow-[0_0_15px_rgba(0,255,170,0.15)]"
                    : "bg-[#12161a] border-white/[0.08] text-neutral-400 hover:text-white hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm text-white">
                  <span>Ira</span>
                  {selectedProfileId === "ira" && (
                    <span className="w-2 h-2 rounded-full bg-[#00ffaa]" />
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                  Warm Indian female AI (Hinglish, Aoede voice)
                </p>
              </button>
            </div>
          </div>

          {/* Assistant Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase text-neutral-400 tracking-wider">
              Assistant Name
            </label>
            <input
              type="text"
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-[#12161a] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-white font-sans text-sm"
            />
          </div>

          {/* Voice Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase text-neutral-400 tracking-wider">
              Voice Persona
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-[#12161a] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-white font-sans text-sm"
            >
              {AVAILABLE_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} - {v.description}
                </option>
              ))}
            </select>
          </div>

          {/* Voice Output Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#12161a] border border-white/[0.08]">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-[#00ffaa]" />
                Voice Audio Output
              </div>
              <div className="text-xs text-neutral-400">
                Speak responses aloud using native Gemini voice synthesis
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00ffaa]"></div>
            </label>
          </div>

          {/* Long-Term Memory Section */}
          <div className="p-4 rounded-xl bg-[#12161a] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-white flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[#00ffaa]" />
                  Persistent Long-Term Memory
                </div>
                <div className="text-xs text-neutral-400">
                  Allow JARVIS to remember key facts, preferences, and projects across sessions
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={memoryEnabled}
                  onChange={(e) => handleToggleMemory(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00ffaa]"></div>
              </label>
            </div>

            {/* Memory List Accordion / Drawer */}
            <div className="pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsMemoriesOpen(!isMemoriesOpen)}
                  className="flex items-center gap-1.5 text-xs font-mono text-[#00ffaa] hover:underline cursor-pointer"
                >
                  {isMemoriesOpen ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      Hide Memories ({memories.length})
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      View Memories ({memories.length})
                    </>
                  )}
                </button>

                {memories.length > 0 && isMemoriesOpen && (
                  <div>
                    {clearConfirming ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-rose-300">Are you sure?</span>
                        <button
                          type="button"
                          onClick={handleClearAllMemories}
                          className="px-2 py-0.5 text-[11px] font-mono rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors cursor-pointer"
                        >
                          Yes, Clear All
                        </button>
                        <button
                          type="button"
                          onClick={() => setClearConfirming(false)}
                          className="px-2 py-0.5 text-[11px] font-mono rounded bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1] transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setClearConfirming(true)}
                        className="flex items-center gap-1 text-[11px] font-mono text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear All Memories
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isMemoriesOpen && (
                <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                  {memories.length === 0 ? (
                    <div className="p-3 text-center text-xs text-neutral-500 font-mono bg-white/[0.01] rounded-lg border border-white/[0.04]">
                      No memories stored yet. Tell JARVIS "Remember that..." via voice or text.
                    </div>
                  ) : (
                    memories.map((mem) => (
                      <div
                        key={mem.id}
                        className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-black/40 border border-white/[0.06] group hover:border-white/[0.15] transition-all"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-xs text-neutral-200 leading-relaxed break-words font-sans">
                            {mem.content}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] font-mono">
                            <span
                              className={`px-1.5 py-0.5 rounded border uppercase text-[9px] ${getCategoryBadgeClass(
                                mem.category
                              )}`}
                            >
                              {mem.category}
                            </span>
                            <span className="text-neutral-500">
                              {new Date(mem.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteMemory(mem.id, e)}
                          title="Delete memory"
                          className="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-white/[0.04] transition-colors shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Editable System Instruction */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono uppercase text-neutral-400 tracking-wider">
                System Instructions
              </label>
              <button
                type="button"
                onClick={handleResetInstruction}
                className="flex items-center gap-1 text-[11px] font-mono text-[#00ffaa] hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Default
              </button>
            </div>
            <textarea
              value={systemInstruction}
              onChange={(e) => setSystemInstruction(e.target.value)}
              rows={8}
              className="w-full p-3 rounded-xl bg-[#12161a] border border-white/[0.08] focus:border-[#00ffaa]/60 focus:outline-none text-neutral-200 font-mono text-xs leading-relaxed resize-y"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.08] bg-[#0f1216]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-mono uppercase tracking-wider font-semibold bg-[#00ffaa] text-black hover:bg-[#00e599] transition-all active:scale-95 shadow-lg shadow-[#00ffaa]/20 cursor-pointer disabled:opacity-70 disabled:cursor-wait"
          >
            {savedNotice ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : isSaving ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                {saveStep === "checking" ? "Checking Gemini..." : "Saving..."}
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
