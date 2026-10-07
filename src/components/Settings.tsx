/**
 * Settings Modal for JARVIS.
 * Configures assistant personality, voice preferences, Live model specification,
 * system instruction editing, and hardware connection diagnostics.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Brain,
  Check,
  Cpu,
  Info,
  KeyRound,
  Mic2,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import { AssistantSettings, ConnectionStatus } from "../types/assistant";
import { MemoryItem } from "../types/memory";
import { AVAILABLE_VOICES } from "../config/voiceConfig";
import {
  CHAT_MODEL,
  CHAT_MODEL_NAME,
  LIVE_MODEL,
  LIVE_MODEL_NAME,
  MEMORY_MODEL_NAME,
} from "../config/modelConfig";
import { ASSISTANT_PROFILES } from "../config/assistantProfiles";
import { memoryService } from "../services/memoryService";
import {
  getAndroidApiKey,
  setAndroidApiKey,
  validateAndroidApiKey,
} from "../services/androidRuntime";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AssistantSettings;
  onSave: (newSettings: Partial<AssistantSettings>) => void;
  connectionStatus: ConnectionStatus;
  isMicActive: boolean;
}

type SettingsTab = "general" | "character" | "voice" | "system" | "about";

const TABS: Array<{
  id: SettingsTab;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}> = [
  { id: "general", label: "GENERAL", Icon: SlidersHorizontal },
  { id: "character", label: "CHARACTER", Icon: UserRound },
  { id: "voice", label: "VOICE", Icon: Mic2 },
  { id: "system", label: "SYSTEM", Icon: Cpu },
  { id: "about", label: "ABOUT", Icon: Info },
];

const Toggle: React.FC<{
  checked: boolean;
  onChange?: (value: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange?.(!checked)}
    className={`relative h-7 w-12 shrink-0 rounded-full border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
      checked
        ? "border-cyan-300/40 bg-cyan-400/90"
        : "border-white/10 bg-white/[0.07]"
    }`}
  >
    <span
      className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200 ${
        checked ? "translate-x-[22px]" : "translate-x-[2px]"
      }`}
    />
  </button>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-3 px-0.5 text-[clamp(10px,2.1vw,12px)] font-mono uppercase tracking-[0.24em] text-neutral-500">
    {children}
  </div>
);

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <div
    className={`overflow-hidden rounded-[18px] border border-white/[0.075] bg-[#0a0b10]/90 ${className}`}
  >
    {children}
  </div>
);

export const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  connectionStatus,
  isMicActive,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [selectedProfileId, setSelectedProfileId] = useState(
    settings.selectedProfileId || (settings.voice === "Aoede" ? "ira" : "jarvis")
  );
  const [assistantName, setAssistantName] = useState(settings.assistantName);
  const [voice, setVoice] = useState(settings.voice);
  const [liveModel, setLiveModel] = useState(settings.liveModel || LIVE_MODEL);
  const [brainModel, setBrainModel] = useState(settings.brainModel || CHAT_MODEL);
  const [backgroundModel, setBackgroundModel] = useState(settings.backgroundModel || "auto");
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled);
  const [backgroundVoiceMode, setBackgroundVoiceMode] = useState(
    settings.backgroundVoiceMode ?? false
  );
  const [systemInstruction, setSystemInstruction] = useState(settings.systemInstruction);
  const [androidApiKey, setAndroidApiKeyState] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStep, setSaveStep] = useState<"idle" | "checking" | "saving">("idle");

  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isMemoriesOpen, setIsMemoriesOpen] = useState(false);
  const [clearConfirming, setClearConfirming] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setActiveTab("general");
    setSelectedProfileId(
      settings.selectedProfileId || (settings.voice === "Aoede" ? "ira" : "jarvis")
    );
    setAssistantName(settings.assistantName);
    setVoice(settings.voice);
    setLiveModel(settings.liveModel || LIVE_MODEL);
    setBrainModel(settings.brainModel || CHAT_MODEL);
    setBackgroundModel(settings.backgroundModel || "auto");
    setVoiceEnabled(settings.voiceEnabled);
    setBackgroundVoiceMode(settings.backgroundVoiceMode ?? false);
    setSystemInstruction(settings.systemInstruction);
    setAndroidApiKeyState(getAndroidApiKey());
    setApiKeyStatus("");
    setIsSaving(false);
    setSaveStep("idle");
    setIsMemoriesOpen(false);
  }, [isOpen, settings]);

  const loadMemories = useCallback(async () => {
    try {
      setMemoryEnabled(memoryService.isEnabled());
      setMemories(await memoryService.getMemories());
    } catch {
      setMemories([]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadMemories();
    return memoryService.subscribe(() => {
      void loadMemories();
    });
  }, [isOpen, loadMemories]);

  const configured = useMemo(() => Boolean(getAndroidApiKey().trim()), [androidApiKey]);

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

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setIsMemoriesOpen(false);
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

    if (enteredKey && enteredKey !== currentStoredKey) {
      try {
        setSaveStep("checking");
        setApiKeyStatus("Checking Gemini access…");
        await validateAndroidApiKey(enteredKey);
        setApiKeyStatus("Gemini access verified");
      } catch (err) {
        setIsSaving(false);
        setSaveStep("idle");
        setApiKeyStatus(
          err instanceof Error ? err.message : "API key validation failed"
        );
        return;
      }
    } else if (!enteredKey && currentStoredKey) {
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
      backgroundVoiceMode,
      systemInstruction,
    });

    window.setTimeout(onClose, 220);
  };

  const resetInstruction = () => {
    setSystemInstruction(
      selectedProfileId === "ira"
        ? ASSISTANT_PROFILES.ira.systemInstruction
        : ASSISTANT_PROFILES.jarvis.systemInstruction
    );
  };

  if (!isOpen) return null;

  const tabContent = {
    general: (
      <div className="space-y-6">
        <SectionLabel>Startup & Appearance</SectionLabel>

        <Panel>
          <div className="flex min-h-[76px] items-center justify-between gap-5 border-b border-white/[0.055] px-5 py-4">
            <div className="min-w-0">
              <div className="text-[clamp(13px,3.2vw,15px)] font-mono tracking-[0.06em] text-neutral-200">
                BACKGROUND VOICE MODE
              </div>
              <p className="mt-1 text-[clamp(10px,2.4vw,12px)] leading-5 text-neutral-500">
                Visible foreground service waits for your wake phrase
              </p>
            </div>
            <Toggle
              checked={backgroundVoiceMode}
              onChange={setBackgroundVoiceMode}
              label="Background voice mode"
            />
          </div>

          <div className="flex min-h-[76px] items-center justify-between gap-5 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[clamp(13px,3.2vw,15px)] font-mono tracking-[0.06em] text-neutral-200">
                UI ANIMATIONS
              </div>
              <p className="mt-1 text-[clamp(10px,2.4vw,12px)] leading-5 text-neutral-500">
                Motion and orb transitions are enabled
              </p>
            </div>
            <Toggle checked={true} label="UI animations" />
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionLabel>Assistant Identity</SectionLabel>
          <input
            value={assistantName}
            onChange={(e) => setAssistantName(e.target.value)}
            aria-label="Assistant name"
            className="h-12 w-full rounded-[13px] border border-white/[0.075] bg-black/30 px-4 text-[clamp(14px,3.6vw,17px)] text-white outline-none transition-colors placeholder:text-neutral-700 focus:border-cyan-300/40"
          />
        </Panel>

        <Panel className="p-5">
          <SectionLabel>Connection</SectionLabel>
          <div className="flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connectionStatus === "online"
                  ? "bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,.8)]"
                  : "bg-amber-300"
              }`}
            />
            <span className="text-[clamp(13px,3.2vw,15px)] font-mono capitalize text-neutral-200">
              {connectionStatus}
            </span>
            <span className="text-[clamp(9px,2.2vw,11px)] font-mono uppercase tracking-[0.12em] text-neutral-600">
              MIC {isMicActive ? "ACTIVE" : "STANDBY"}
            </span>
          </div>
        </Panel>
      </div>
    ),

    character: (
      <div className="space-y-6">
        <SectionLabel>Assistant Character</SectionLabel>

        <div className="space-y-3">
          {[
            {
              id: "jarvis",
              name: "JARVIS",
              description: "Calm, intelligent personal assistant",
              voiceName: "Enceladus",
            },
            {
              id: "ira",
              name: "Ira",
              description: "Warm Indian Hinglish voice persona",
              voiceName: "Aoede",
            },
          ].map((profile) => {
            const selected = selectedProfileId === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => handleSelectProfile(profile.id)}
                aria-pressed={selected}
                className={`group w-full rounded-[18px] border p-5 text-left transition-all duration-200 ${
                  selected
                    ? "border-cyan-300/55 bg-cyan-400/[0.055] shadow-[inset_0_0_0_1px_rgba(34,211,238,.08)]"
                    : "border-white/[0.075] bg-[#0a0b10] hover:border-white/[0.13]"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[clamp(16px,4vw,19px)] font-mono text-white">
                    {profile.name}
                  </span>
                  <span className="shrink-0 text-[clamp(9px,2.2vw,11px)] font-mono text-cyan-300/80">
                    {profile.voiceName}
                  </span>
                </div>
                <p className="mt-2 text-[clamp(11px,2.6vw,13px)] leading-5 text-neutral-500">
                  {profile.description}
                </p>
                {selected && (
                  <div className="mt-3 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-cyan-300">
                    <Check size={13} strokeWidth={2.2} />
                    Active character
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>System Personality</SectionLabel>
            <button
              type="button"
              onClick={resetInstruction}
              className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-cyan-300/80 hover:text-cyan-200"
            >
              <RefreshCcw size={12} />
              Reset
            </button>
          </div>

          <textarea
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            aria-label="System personality"
            rows={8}
            className="w-full resize-y rounded-[13px] border border-white/[0.075] bg-black/35 p-4 font-mono text-[clamp(11px,2.6vw,13px)] leading-6 text-neutral-300 outline-none transition-colors focus:border-cyan-300/35"
          />
        </Panel>
      </div>
    ),

    voice: (
      <div className="space-y-6">
        <SectionLabel>Gemini Voice & Microphone</SectionLabel>

        <Panel className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[clamp(13px,3.2vw,15px)] font-mono text-neutral-200">
                <KeyRound size={16} className="shrink-0 text-cyan-300/80" />
                GEMINI API KEY
              </div>
              <p className="mt-1 text-[clamp(10px,2.3vw,12px)] text-neutral-500">
                Protected Android Keystore storage
              </p>
            </div>

            <span
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.08em] ${
                configured
                  ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300"
                  : "border-amber-400/20 bg-amber-400/[0.06] text-amber-300"
              }`}
            >
              {configured ? "Configured" : "Not configured"}
            </span>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              type="password"
              value={androidApiKey}
              onChange={(e) => {
                setAndroidApiKeyState(e.target.value);
                setApiKeyStatus("");
              }}
              placeholder={configured ? "Enter new key to replace" : "Paste Gemini API key"}
              className="min-w-0 h-11 flex-1 rounded-[12px] border border-white/[0.075] bg-black/35 px-3 font-mono text-[clamp(10px,2.5vw,12px)] text-white outline-none focus:border-cyan-300/35"
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="shrink-0 rounded-[12px] border border-white/[0.09] bg-white/[0.035] px-4 font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-300 transition-colors hover:border-cyan-300/25 hover:text-cyan-200 disabled:opacity-50"
            >
              {isSaving && saveStep === "checking" ? "CHECK…" : "REPLACE"}
            </button>
          </div>

          {apiKeyStatus && (
            <div className="mt-3 flex items-start gap-2 text-[10px] font-mono leading-5 text-cyan-300/80">
              <Activity size={13} className="mt-0.5 shrink-0" />
              <span>{apiKeyStatus}</span>
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[clamp(13px,3.2vw,15px)] font-mono text-neutral-200">
                <Volume2 size={16} className="text-cyan-300/80" />
                VOICE OUTPUT
              </div>
              <p className="mt-1 text-[clamp(10px,2.3vw,12px)] text-neutral-500">
                Native Gemini audio through Android AudioTrack
              </p>
            </div>
            <Toggle checked={voiceEnabled} onChange={setVoiceEnabled} label="Voice output" />
          </div>

          <div className="mt-5">
            <label className="text-[10px] font-mono uppercase tracking-[0.18em] text-neutral-500">
              Voice Persona
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="mt-2 h-11 w-full rounded-[12px] border border-white/[0.075] bg-black/35 px-3 font-mono text-[clamp(10px,2.6vw,12px)] text-white outline-none focus:border-cyan-300/35"
            >
              {AVAILABLE_VOICES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {item.description}
                </option>
              ))}
            </select>
          </div>
        </Panel>
      </div>
    ),

    system: (
      <div className="space-y-6">
        <SectionLabel>System Runtime</SectionLabel>

        <Panel className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] border border-emerald-300/15 bg-emerald-300/[0.05]">
              <Wifi size={16} className="text-emerald-300" />
            </div>
            <div>
              <div className="text-[clamp(13px,3.2vw,15px)] font-mono text-white">
                Native Bridge Online
              </div>
              <div className="mt-0.5 text-[10px] font-mono text-neutral-600">
                Android action bridge available
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[clamp(13px,3.2vw,15px)] font-mono text-neutral-200">
                AI MODELS
              </div>
              <div className="mt-1 text-[10px] font-mono text-neutral-600">
                Runtime routing
              </div>
            </div>
            <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-cyan-300/70">
              Active
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {[
              ["BRAIN", brainModel || CHAT_MODEL],
              ["LIVE", liveModel || LIVE_MODEL],
              ["MEMORY", MEMORY_MODEL_NAME],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 rounded-[12px] border border-white/[0.055] bg-black/20 px-3.5 py-3"
              >
                <span className="text-[9px] font-mono tracking-[0.15em] text-neutral-600">
                  {label}
                </span>
                <span className="max-w-[72%] break-all text-right font-mono text-[clamp(10px,2.5vw,12px)] text-neutral-200">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[clamp(13px,3.2vw,15px)] font-mono text-neutral-200">
                <Brain size={16} className="text-cyan-300/80" />
                PERSISTENT LONG-TERM MEMORY
              </div>
              <p className="mt-1 text-[clamp(10px,2.3vw,12px)] text-neutral-500">
                Remember durable facts across sessions
              </p>
            </div>
            <Toggle
              checked={memoryEnabled}
              onChange={(enabled) => {
                setMemoryEnabled(enabled);
                memoryService.setEnabled(enabled);
              }}
              label="Persistent long-term memory"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setIsMemoriesOpen((value) => !value)}
              className="text-[10px] font-mono uppercase tracking-[0.12em] text-cyan-300 hover:text-cyan-200"
            >
              {isMemoriesOpen ? "Hide" : "View"} Memories ({memories.length})
            </button>
            {memories.length > 0 && (
              <button
                type="button"
                onClick={() => setClearConfirming(true)}
                className="text-[10px] font-mono uppercase tracking-[0.12em] text-rose-400/80 hover:text-rose-300"
              >
                Clear All
              </button>
            )}
          </div>

          {isMemoriesOpen && (
            <div className="mt-3 space-y-2 border-t border-white/[0.055] pt-3">
              {memories.length === 0 ? (
                <p className="py-3 text-[11px] font-mono text-neutral-600">
                  No memories stored yet.
                </p>
              ) : (
                memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="flex items-start gap-3 rounded-[12px] border border-white/[0.055] bg-black/20 px-3 py-2.5"
                  >
                    <p className="min-w-0 flex-1 text-[clamp(11px,2.6vw,13px)] leading-5 text-neutral-300">
                      {memory.content}
                    </p>
                    <button
                      type="button"
                      onClick={(event) => void handleDeleteMemory(memory.id, event)}
                      aria-label="Delete memory"
                      className="mt-0.5 shrink-0 text-neutral-600 transition-colors hover:text-rose-300"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}

              {clearConfirming && (
                <div className="flex items-center gap-2 rounded-[12px] border border-rose-400/15 bg-rose-400/[0.035] p-3">
                  <span className="flex-1 text-[10px] font-mono text-rose-200/80">
                    Delete all persistent memories?
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleClearAllMemories()}
                    className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-[9px] font-mono uppercase text-rose-300"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearConfirming(false)}
                    className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-[9px] font-mono uppercase text-neutral-400"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    ),

    about: (
      <div className="space-y-6">
        <SectionLabel>About JARVIS</SectionLabel>

        <Panel className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[12px] border border-cyan-300/15 bg-cyan-300/[0.04]">
              <ShieldCheck size={18} className="text-cyan-300/80" />
            </div>
            <div>
              <div className="text-[clamp(16px,4vw,19px)] text-white">
                JARVIS AI Assistant
              </div>
              <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.16em] text-neutral-600">
                Personal assistant system
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {[
              ["VERSION", "V2.0.0"],
              ["ENGINE", LIVE_MODEL_NAME.replace(" Flash Live Preview", " Live")],
              ["PLATFORM", "Capacitor Android"],
              ["WAKE WORD", "Android SpeechRecognizer"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-5 border-b border-white/[0.045] pb-3 last:border-0 last:pb-0"
              >
                <span className="text-[10px] font-mono tracking-[0.15em] text-neutral-600">
                  {label}
                </span>
                <span className="text-right text-[clamp(10px,2.6vw,13px)] font-mono text-neutral-300">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="rounded-[15px] border border-amber-300/15 bg-amber-300/[0.035] px-4 py-3 text-[10px] font-mono leading-5 text-amber-200/75">
          Keep the JARVIS tab active for wake-word detection. Microphone access is required for voice activation.
        </div>
      </div>
    ),
  }[activeTab];

  return (
    <div className="jarvis-settings fixed inset-0 z-[70] overflow-hidden bg-[#04060a] text-[#e7e8f0]">
      <style>{`
        .jarvis-settings {
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
          font-size: clamp(14px, 1.1vw + 8px, 16px);
        }
        .jarvis-settings button,
        .jarvis-settings input,
        .jarvis-settings textarea,
        .jarvis-settings select {
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }
        @media (max-width: 420px) {
          .jarvis-settings .settings-side-padding { padding-left: 16px; padding-right: 16px; }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(38,212,255,.065),transparent_42%),linear-gradient(180deg,#06080d_0%,#030407_100%)]" />

      <div
        className="relative flex h-full min-h-0 flex-col"
        style={{
          paddingTop: "max(env(safe-area-inset-top, 0px), 18px)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)",
        }}
      >
        <header className="settings-side-padding shrink-0 border-b border-white/[0.065] px-5 pb-4 pt-1">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-cyan-300/20 bg-cyan-300/[0.045] shadow-[0_0_28px_rgba(34,211,238,.07)]">
                <SlidersHorizontal size={20} strokeWidth={1.8} className="text-cyan-200" />
              </div>

              <div className="min-w-0">
                <h2 className="truncate text-[clamp(19px,5.2vw,25px)] font-semibold tracking-[0.01em] text-white">
                  JARVIS Configuration
                  <span className="ml-1.5 text-cyan-300">✦</span>
                </h2>
                <p className="mt-0.5 truncate text-[clamp(9px,2.2vw,11px)] font-mono uppercase tracking-[0.22em] text-neutral-600">
                  System Settings & Preferences
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-white/[0.08] bg-white/[0.025] text-neutral-400 transition-all hover:border-cyan-300/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <X size={23} strokeWidth={1.7} />
            </button>
          </div>
        </header>

        <nav
          aria-label="JARVIS settings sections"
          className="settings-side-padding shrink-0 overflow-x-auto border-b border-white/[0.06] px-5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex min-w-max gap-2">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectTab(id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 font-mono text-[clamp(9px,2.3vw,11px)] uppercase tracking-[0.13em] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                    active
                      ? "border-cyan-300/35 bg-cyan-300/[0.09] text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,.055)]"
                      : "border-white/[0.07] bg-white/[0.025] text-neutral-500 hover:border-white/[0.14] hover:text-neutral-200"
                  }`}
                >
                  <Icon size={14} strokeWidth={1.7} />
                  {label}
                  {active && (
                    <span className="absolute -bottom-[13px] left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,.7)]" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="settings-side-padding min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto w-full max-w-[720px] pb-5">
            {tabContent}
          </div>
        </main>

        <footer className="shrink-0 border-t border-white/[0.065] bg-[#04060a]/95 px-5 py-2.5 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
            <span className="hidden text-[9px] font-mono uppercase tracking-[0.16em] text-neutral-700 min-[380px]:block">
              Preferences auto-save
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-[11px] px-4 text-[10px] font-mono uppercase tracking-[0.12em] text-neutral-500 transition-colors hover:text-neutral-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-cyan-400 px-5 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#031015] shadow-[0_0_20px_rgba(34,211,238,.12)] transition-all hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? (
                  <Activity size={13} className="animate-pulse" />
                ) : (
                  <Check size={13} strokeWidth={2.5} />
                )}
                {isSaving ? (saveStep === "checking" ? "Checking" : "Saving") : "Save Changes"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};
