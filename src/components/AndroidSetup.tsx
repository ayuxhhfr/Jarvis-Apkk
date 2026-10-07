import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  readAndroidClipboard,
  setAndroidApiKey,
  validateAndroidApiKey,
} from "../services/androidRuntime";

interface AndroidSetupProps {
  onComplete: () => void;
}

export const AndroidSetup: React.FC<AndroidSetupProps> = ({ onComplete }) => {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"error" | "success" | "info">("info");
  const [testing, setTesting] = useState(false);
  const [pasted, setPasted] = useState(false);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(
      () => setStatus(""),
      statusKind === "error" ? 7000 : 3500
    );
    return () => window.clearTimeout(timer);
  }, [status, statusKind]);

  const handlePaste = async () => {
    const value = (await readAndroidClipboard()).trim();
    if (!value) {
      setStatusKind("error");
      setStatus("Clipboard is empty or unavailable.");
      return;
    }
    setApiKey(value);
    setPasted(true);
    setStatusKind("info");
    setStatus("API key pasted from clipboard.");
  };

  const handleTestAndContinue = async () => {
    const value = apiKey.trim();
    if (!value || testing) return;

    setTesting(true);
    setStatus("");
    try {
      await validateAndroidApiKey(value);
      setAndroidApiKey(value);
      setStatusKind("success");
      setStatus("Gemini brain + Live voice verified.");
      window.setTimeout(onComplete, 450);
    } catch (error) {
      setStatusKind("error");
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-5 bg-[#030307] text-[#e7e8f0]">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(32,217,255,0.10),transparent_42%),radial-gradient(circle_at_85%_90%,rgba(0,220,255,0.05),transparent_35%)]" />
      <div className="relative w-full max-w-[640px] rounded-[28px] border border-white/[0.10] bg-[#0a0f14]/[0.98] shadow-[0_30px_100px_rgba(0,0,0,.65)] overflow-hidden">
        <div className="px-7 pt-8 pb-7 sm:px-9">
          <div className="flex flex-col items-center text-center">
            <div className="w-[72px] h-[72px] rounded-[22px] border border-cyan-400/25 bg-cyan-400/[0.07] flex items-center justify-center shadow-[0_0_35px_rgba(32,217,255,.12)]">
              <KeyRound className="w-8 h-8 text-cyan-200" />
            </div>
            <h1 className="mt-6 text-[25px] font-semibold tracking-[0.10em] text-white uppercase">SET UP JARVIS</h1>
            <p className="mt-3 max-w-[510px] text-sm leading-7 text-neutral-400">
              Add the API key required to activate JARVIS&apos;s existing intelligence and voice.{" "}
              <span className="text-neutral-300">You only need to complete this once.</span>
            </p>
          </div>

          <div className="mt-7 rounded-[23px] border border-white/[0.08] bg-[#070b10] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-[0.16em] text-cyan-200 font-mono uppercase">GOOGLE GEMINI API</span>
                  <span className="px-2 py-1 rounded-full border border-amber-300/20 bg-amber-300/[0.08] text-[9px] font-bold tracking-wider text-amber-200 uppercase">REQUIRED</span>
                </div>
                <p className="mt-2 text-xs leading-6 text-neutral-500">Required for JARVIS&apos;s intelligence, conversation, memory extraction, live voice, and Android command understanding.</p>
              </div>
            </div>

            <div className="mt-5 relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setStatus(""); setPasted(false); }}
                placeholder="Enter your Gemini API key"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-16 w-full rounded-2xl border border-white/[0.09] bg-black/30 px-4 pr-12 text-sm text-white outline-none focus:border-cyan-300/45 font-mono placeholder:text-neutral-600"
              />
              <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide API key" : "Show API key"} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-neutral-500 hover:text-white">
                {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <button onClick={() => void handlePaste()} className="h-12 rounded-xl border border-white/[0.08] bg-white/[0.035] text-[10px] font-mono text-neutral-300">
                {pasted ? "✓ PASTED" : "▣ PASTE"}
              </button>
              <button onClick={() => void handleTestAndContinue()} disabled={testing || !apiKey.trim()} className="h-12 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] text-[10px] font-mono text-cyan-200 disabled:opacity-35">
                {testing ? "CHECKING…" : "◈ TEST API"}
              </button>
              <button onClick={() => window.open("https://aistudio.google.com/app/apikey", "_blank", "noopener,noreferrer")} className="h-12 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] text-[10px] font-mono text-cyan-200">
                ↗ GET KEY
              </button>
            </div>

            <details className="mt-5">
              <summary className="cursor-pointer list-none text-[11px] font-mono text-neutral-500">
                <span className="text-cyan-300 mr-1">▸</span> HOW TO GET A KEY
              </summary>
              <div className="mt-3 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs leading-6 text-neutral-500">
                Open Google AI Studio, create or view a Gemini API key, copy it, then paste it here. Keep the key private.
              </div>
            </details>

            <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-start gap-2.5 text-[11px] leading-5 text-neutral-500">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-cyan-300/60" />
              <span>The saved key stays protected on this Android installation and is used only for JARVIS Gemini requests.</span>
            </div>
          </div>

          {status && (
            <div className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${
              statusKind === "error"
                ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-200"
                : statusKind === "success"
                  ? "border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-200"
                  : "border-white/[0.07] bg-white/[0.025] text-neutral-400"
            }`}>
              {status}
            </div>
          )}

          <button onClick={() => void handleTestAndContinue()} disabled={testing || !apiKey.trim()} className="mt-6 h-14 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-cyan-300 text-black text-sm font-bold tracking-[0.12em] uppercase disabled:opacity-35">
            {testing ? "CHECKING API" : "TEST, SAVE & CONTINUE"}
          </button>
        </div>
      </div>
    </div>
  );
};
