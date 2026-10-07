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
    <div className="fixed inset-0 z-[70] bg-[#030307] text-[#e7e8f0] overflow-hidden">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(86,72,255,0.10),transparent_38%),radial-gradient(circle_at_90%_70%,rgba(0,220,255,0.035),transparent_40%)]" />
      <div className="relative h-full flex flex-col" style={{paddingTop:"max(env(safe-area-inset-top,0px), 24px)",paddingBottom:"max(env(safe-area-inset-bottom,0px), 8px)"}}>
        <header className="shrink-0 px-6 pb-5 border-b border-white/[0.07] flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-[15px] border border-indigo-400/30 bg-gradient-to-br from-indigo-500/25 to-cyan-400/10 flex items-center justify-center shadow-[0_0_28px_rgba(99,102,241,.14)]">
              <Sparkles className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-[21px] font-semibold tracking-wide text-white">JARVIS Configuration <span className="text-cyan-300">✦</span></h2>
              <p className="mt-1 text-[11px] font-mono tracking-[0.18em] text-neutral-500 uppercase">System Settings & Preferences</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close settings" className="w-12 h-12 rounded-[15px] border border-white/[0.08] bg-white/[0.025] flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06]">
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="shrink-0 px-6 py-4 border-b border-white/[0.07] overflow-x-auto no-scrollbar">
          <div className="flex gap-2 min-w-max">
            {[
              ["general","◉","GENERAL"],["character","✧","CHARACTER"],["voice","♩","VOICE"],["system","▣","SYSTEM"],["about","ⓘ","ABOUT"]
            ].map(([id,icon,label]) => (
              <button key={id} onClick={()=>document.getElementById(`jarvis-settings-${id}`)?.scrollIntoView({behavior:"smooth",block:"start"})}
                className="px-4 py-2.5 rounded-full border border-white/[0.07] bg-white/[0.035] text-[11px] font-mono tracking-wider text-neutral-400 hover:text-white hover:border-cyan-400/30 whitespace-nowrap">
                <span className="mr-1.5">{icon}</span>{label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          <section id="jarvis-settings-general" className="space-y-5">
            <p className="text-[11px] font-mono tracking-[0.2em] text-neutral-500 uppercase">Startup & Appearance</p>
            <div className="space-y-0 rounded-2xl border border-white/[0.07] overflow-hidden bg-white/[0.012]">
              <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
                <div><div className="text-sm font-mono uppercase tracking-wider text-neutral-200">Background Voice Mode</div><div className="mt-1 text-[10px] text-neutral-500">Visible foreground service waits for your wake phrase</div></div>
                <label className="relative inline-flex cursor-pointer"><input type="checkbox" checked={settings.backgroundVoiceMode ?? false} onChange={e=>onSave({backgroundVoiceMode:e.target.checked})} className="sr-only peer"/><div className="w-14 h-7 rounded-full bg-neutral-800 peer-checked:bg-cyan-500 after:content-[''] after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-7"/></label>
              </div>
              <div className="flex items-center justify-between p-5">
                <div><div className="text-sm font-mono uppercase tracking-wider text-neutral-200">UI Animations</div><div className="mt-1 text-[10px] text-neutral-500">Enable motion and orb transitions</div></div>
                <label className="relative inline-flex cursor-pointer"><input type="checkbox" checked={true} readOnly className="sr-only peer"/><div className="w-14 h-7 rounded-full bg-cyan-500 after:content-[''] after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform after:translate-x-7"/></label>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
                <div className="text-[11px] font-mono tracking-[0.18em] text-neutral-500 uppercase mb-3">Assistant Identity</div>
                <input value={assistantName} onChange={e=>setAssistantName(e.target.value)} className="w-full h-12 rounded-xl bg-black/30 border border-white/[0.08] px-4 text-white outline-none focus:border-cyan-400/50" />
              </div>
              <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
                <div className="text-[11px] font-mono tracking-[0.18em] text-neutral-500 uppercase mb-3">Connection</div>
                <div className="flex items-center gap-3"><span className={`w-2.5 h-2.5 rounded-full ${connectionStatus==="online"?"bg-cyan-400 shadow-[0_0_10px_#22d3ee]":"bg-amber-400"}`}/><span className="font-mono text-sm text-neutral-200 capitalize">{connectionStatus}</span><span className="text-[10px] font-mono text-neutral-500">MIC {isMicActive?"ACTIVE":"STANDBY"}</span></div>
              </div>
            </div>
          </section>

          <section id="jarvis-settings-character" className="space-y-5">
            <p className="text-[11px] font-mono tracking-[0.2em] text-neutral-500 uppercase">Assistant Character</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[{id:"jarvis",name:"JARVIS",desc:"Calm, intelligent personal assistant",voice:"Enceladus"},{id:"ira",name:"Ira",desc:"Warm Indian Hinglish voice persona",voice:"Aoede"}].map(p=>(
                <button key={p.id} onClick={()=>handleSelectProfile(p.id)} className={`text-left p-5 rounded-2xl border ${selectedProfileId===p.id?"border-cyan-400/50 bg-cyan-400/[0.07]":"border-white/[0.07] bg-[#0b0b10]"}`}>
                  <div className="flex items-center justify-between"><span className="font-mono tracking-wider text-white">{p.name}</span><span className="text-[9px] font-mono text-cyan-300">{p.voice}</span></div>
                  <p className="mt-2 text-xs text-neutral-500">{p.desc}</p>
                </button>
              ))}
            </div>
            <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
              <label className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">System Personality</label>
              <textarea value={systemInstruction} onChange={e=>setSystemInstruction(e.target.value)} rows={7} className="mt-3 w-full rounded-xl bg-black/30 border border-white/[0.08] p-4 text-xs font-mono leading-6 text-neutral-300 outline-none focus:border-cyan-400/40 resize-y"/>
              <button onClick={handleResetInstruction} className="mt-3 text-[10px] font-mono text-cyan-300">↻ RESET DEFAULT</button>
            </div>
          </section>

          <section id="jarvis-settings-voice" className="space-y-5">
            <p className="text-[11px] font-mono tracking-[0.2em] text-neutral-500 uppercase">Gemini Voice & Microphone</p>
            <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
              <div className="flex items-center justify-between"><div><div className="text-sm font-mono text-neutral-200 uppercase">Gemini API Key</div><div className="mt-1 text-[10px] font-mono text-neutral-500">Android Keystore encrypted storage</div></div><span className="px-2.5 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-[9px] font-mono text-emerald-300 uppercase">Configured</span></div>
              <div className="mt-4 flex gap-2"><input type="password" value={androidApiKey} onChange={e=>{setAndroidApiKeyState(e.target.value);setApiKeyStatus("")}} placeholder="Enter a new key to replace it" className="min-w-0 flex-1 h-11 rounded-xl bg-black/30 border border-white/[0.08] px-3 text-xs font-mono text-white outline-none"/><button onClick={handleSave} className="px-4 rounded-xl bg-white/[0.05] border border-white/[0.08] text-[10px] font-mono text-neutral-300">REPLACE</button></div>
              {apiKeyStatus&&<p className="mt-2 text-[10px] text-cyan-300 font-mono">{apiKeyStatus}</p>}
            </div>
            <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
              <div className="flex items-center justify-between"><div><div className="text-sm font-mono uppercase text-neutral-200">Voice Output</div><div className="mt-1 text-[10px] text-neutral-500">Native Gemini audio through Android AudioTrack</div></div><label className="relative inline-flex cursor-pointer"><input type="checkbox" checked={voiceEnabled} onChange={e=>setVoiceEnabled(e.target.checked)} className="sr-only peer"/><div className="w-14 h-7 rounded-full bg-neutral-800 peer-checked:bg-cyan-500 after:content-[''] after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-7"/></label></div>
              <div className="mt-5"><label className="text-[10px] font-mono tracking-wider text-neutral-500 uppercase">Voice Persona</label><select value={voice} onChange={e=>setVoice(e.target.value)} className="mt-2 w-full h-11 rounded-xl bg-black/30 border border-white/[0.08] px-3 text-xs text-white outline-none">{AVAILABLE_VOICES.map(v=><option key={v.id} value={v.id}>{v.name} — {v.description}</option>)}</select></div>
            </div>
          </section>

          <section id="jarvis-settings-system" className="space-y-5">
            <p className="text-[11px] font-mono tracking-[0.2em] text-neutral-500 uppercase">Android Action Bridge</p>
            <div className="p-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.035]">
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]"/><div><div className="font-mono text-sm text-white">Native Bridge Online</div><div className="text-[10px] font-mono text-neutral-500">35 controlled capabilities registered</div></div></div>
              <div className="mt-5 grid grid-cols-2 gap-2 text-[10px] font-mono text-neutral-400"><span>App discovery</span><span>Camera & gallery</span><span>Call/SMS prepare</span><span>WhatsApp prepare</span><span>Alarm & timer</span><span>Maps & search</span><span>Media & volume</span><span>Torch & settings</span></div>
            </div>
            <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
              <div className="flex items-center justify-between"><div><div className="text-sm font-mono uppercase text-neutral-200">AI Models</div><div className="mt-1 text-[10px] text-neutral-500">Runtime routing</div></div><span className="text-[9px] font-mono text-cyan-300">ACTIVE ROUTING</span></div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/[0.07] p-3"><span className="text-[9px] font-mono text-neutral-500">BRAIN</span><p className="mt-2 text-xs font-mono text-white">{brainModel}</p></div>
                <div className="rounded-xl border border-white/[0.07] p-3"><span className="text-[9px] font-mono text-neutral-500">LIVE</span><p className="mt-2 text-xs font-mono text-white">{liveModel}</p></div>
                <div className="rounded-xl border border-white/[0.07] p-3"><span className="text-[9px] font-mono text-neutral-500">MEMORY</span><p className="mt-2 text-xs font-mono text-white">Gemini 2.5 Flash-Lite → fallback 3.5 Flash-Lite</p></div>
              </div>
            </div>
            <div className="p-5 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
              <div className="flex items-center justify-between"><div><div className="text-sm font-mono uppercase text-neutral-200">Persistent Long-Term Memory</div><div className="mt-1 text-[10px] text-neutral-500">Remember durable facts across sessions</div></div><label className="relative inline-flex cursor-pointer"><input type="checkbox" checked={memoryEnabled} onChange={e=>handleToggleMemory(e.target.checked)} className="sr-only peer"/><div className="w-14 h-7 rounded-full bg-neutral-800 peer-checked:bg-cyan-500 after:content-[''] after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-7"/></label></div>
              <button onClick={()=>setIsMemoriesOpen(v=>!v)} className="mt-4 text-[10px] font-mono text-cyan-300">{isMemoriesOpen?"HIDE":"VIEW"} MEMORIES ({memories.length})</button>
              {isMemoriesOpen&&<div className="mt-3 space-y-2 max-h-60 overflow-y-auto">{memories.length===0?<p className="text-xs font-mono text-neutral-600">No memories stored yet.</p>:memories.map(mem=><div key={mem.id} className="p-3 rounded-xl bg-black/30 border border-white/[0.06] flex items-start justify-between gap-2"><p className="text-xs text-neutral-300">{mem.content}</p><button onClick={e=>void handleDeleteMemory(mem.id,e)} className="text-neutral-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5"/></button></div>)}</div>}
              {memories.length>0&&<button onClick={()=>setClearConfirming(true)} className="mt-3 text-[10px] font-mono text-rose-400">CLEAR ALL MEMORIES</button>}
              {clearConfirming&&<div className="mt-2 flex gap-2"><button onClick={()=>void handleClearAllMemories()} className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-[10px] text-rose-300">CLEAR</button><button onClick={()=>setClearConfirming(false)} className="px-3 py-1.5 rounded-lg bg-white/[0.05] text-[10px] text-neutral-300">CANCEL</button></div>}
            </div>
          </section>

          <section id="jarvis-settings-about" className="space-y-5 pb-6">
            <p className="text-[11px] font-mono tracking-[0.2em] text-neutral-500 uppercase">About JARVIS</p>
            <div className="p-6 rounded-2xl border border-white/[0.07] bg-[#0b0b10]">
              <div className="text-lg text-white">JARVIS AI Assistant <span className="text-cyan-300">✦</span></div>
              <div className="mt-5 grid grid-cols-2 gap-y-4 text-xs font-mono"><span className="text-neutral-500">VERSION</span><span className="text-right text-neutral-300">V2.0.0</span><span className="text-neutral-500">ENGINE</span><span className="text-right text-neutral-300">Gemini Live</span><span className="text-neutral-500">PLATFORM</span><span className="text-right text-neutral-300">Capacitor Android</span><span className="text-neutral-500">WAKE WORD</span><span className="text-right text-neutral-300">Android SpeechRecognizer</span></div>
            </div>
            <div className="p-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] text-xs font-mono text-amber-200">Keep the JARVIS tab active for wake-word detection. Microphone access is required for voice activation.</div>
          </section>
        </div>

        <footer className="shrink-0 px-6 py-3 border-t border-white/[0.07] flex items-center justify-between bg-black/20">
          <span className="text-[9px] font-mono tracking-[0.18em] text-neutral-600 uppercase">Preferences auto-save</span>
          <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2 rounded-xl text-[10px] font-mono text-neutral-500">CANCEL</button><button onClick={handleSave} disabled={isSaving} className="px-5 py-2 rounded-xl bg-cyan-500 text-black text-[10px] font-mono font-bold tracking-wider disabled:opacity-50">{isSaving?saveStep==="checking"?"CHECKING API…":"SAVING…":"SAVE CHANGES"}</button></div>
        </footer>
      </div>
    </div>
  );
};
