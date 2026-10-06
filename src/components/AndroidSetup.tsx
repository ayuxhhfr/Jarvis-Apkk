import React, { useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Loader2,
} from "lucide-react";
import { validateAndroidApiKey } from "../services/androidRuntime";

interface AndroidSetupProps {
  onComplete: () => void;
}

export const AndroidSetup: React.FC<AndroidSetupProps> = ({ onComplete }) => {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);
  const [pasted, setPasted] = useState(false);

  const handlePaste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (value) {
        setApiKey(value.trim());
        setStatus("");
        setPasted(true);
        window.setTimeout(() => setPasted(false), 1200);
      }
    } catch {
      setStatus("Clipboard access was unavailable. Paste the key manually.");
    }
  };

  const handleTestAndContinue = async () => {
    const value = apiKey.trim();
    if (!value) {
      setStatus("Enter your Gemini API key first.");
      return;
    }

    setTesting(true);
    setStatus("Checking Gemini access...");
    try {
      await validateAndroidApiKey(value);
      setStatus("Gemini access verified.");
      window.setTimeout(onComplete, 250);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "API key validation failed.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#020507]/90 backdrop-blur-xl">
      <div className="relative w-full max-w-[620px] max-h-[92vh] overflow-y-auto rounded-[26px] border border-white/[0.10] bg-[#0b0f13]/95 shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#00ffaa]/[0.07] to-transparent pointer-events-none" />

        <div className="relative px-6 pt-8 pb-7 sm:px-8 sm:pt-9">
          <div className="flex flex-col items-center text-center">
            <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] border border-[#00ffaa]/20 bg-gradient-to-br from-[#00ffaa]/20 via-[#0f1e24] to-[#111827] shadow-[0_0_35px_rgba(0,255,170,0.12)]">
              <KeyRound className="h-8 w-8 text-[#00ffaa]" strokeWidth={1.7} />
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono tracking-[0.28em] text-[#00ffaa]/80 uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              JARVIS INITIALIZATION
            </div>

            <h1 className="mt-2 text-2xl sm:text-[28px] font-semibold tracking-[0.08em] text-white uppercase font-mono">
              Set Up JARVIS
            </h1>

            <p className="mt-3 max-w-[500px] text-sm sm:text-[15px] leading-7 text-neutral-400">
              Add the Gemini API key required to activate JARVIS&apos;s intelligence,
              conversation, memory extraction, voice, and Android actions.
              <span className="text-neutral-300"> You only need to complete this once.</span>
            </p>
          </div>

          <div className="mt-7 rounded-[22px] border border-[#00ffaa]/10 bg-[#080b0f]/80 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-[0.18em] text-[#bfe8dc] font-mono uppercase">
                    Google Gemini API
                  </span>
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2 py-1 text-[9px] font-bold tracking-wider text-amber-200 uppercase">
                    Required
                  </span>
                </div>
                <p className="mt-2 max-w-[470px] text-xs sm:text-[13px] leading-6 text-neutral-500">
                  Used by the JARVIS brain, realtime voice validation, memory
                  intelligence, and Android command processing.
                </p>
              </div>
            </div>

            <div className="mt-5 relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setStatus("");
                }}
                placeholder="Enter your Gemini API key"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-[58px] w-full rounded-2xl border border-white/[0.09] bg-[#10151a] px-4 pr-12 text-sm text-white outline-none transition focus:border-[#00ffaa]/45 focus:ring-4 focus:ring-[#00ffaa]/[0.06] font-mono placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 text-neutral-500 transition hover:bg-white/[0.05] hover:text-white"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4.5 w-4.5" />}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={handlePaste}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] text-xs font-mono text-neutral-300 transition hover:border-white/[0.16] hover:bg-white/[0.06]"
              >
                {pasted ? <CheckCircle2 className="h-4 w-4 text-[#00ffaa]" /> : <Clipboard className="h-4 w-4" />}
                {pasted ? "Pasted" : "Paste"}
              </button>

              <button
                type="button"
                onClick={handleTestAndContinue}
                disabled={testing || !apiKey.trim()}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#00ffaa]/15 bg-[#00ffaa]/[0.06] text-xs font-mono font-semibold text-[#8fe9ca] transition hover:border-[#00ffaa]/30 hover:bg-[#00ffaa]/[0.10] disabled:cursor-not-allowed disabled:opacity-35"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {testing ? "Testing..." : "Test API"}
              </button>

              <button
                type="button"
                onClick={() => window.open("https://aistudio.google.com/app/apikey", "_blank", "noopener,noreferrer")}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] text-xs font-mono font-semibold text-cyan-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.08]"
              >
                <ExternalLink className="h-4 w-4" />
                Get Key
              </button>
            </div>

            <details className="mt-5 group">
              <summary className="cursor-pointer list-none text-[11px] font-mono tracking-wide text-neutral-500 transition hover:text-neutral-300">
                <span className="mr-1 text-[#00ffaa]">▸</span> HOW TO GET A KEY
              </summary>
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 text-xs leading-6 text-neutral-500">
                Open Google AI Studio, create/view a Gemini API key, copy it,
                then paste it here. Keep the key private and use a restricted/auth
                key where possible.
              </div>
            </details>

            <div className="mt-5 flex items-start gap-2.5 border-t border-white/[0.06] pt-4 text-[11px] leading-5 text-neutral-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#00ffaa]/60" />
              <span>
                JARVIS stores the key locally on this Android installation and
                does not display it after setup. The key is used only for Gemini
                requests from this app.
              </span>
            </div>

            {status && (
              <div className={`mt-4 rounded-xl border px-3.5 py-3 text-xs font-mono leading-5 ${
                status.includes("verified")
                  ? "border-[#00ffaa]/20 bg-[#00ffaa]/[0.05] text-[#78e3c0]"
                  : "border-rose-400/20 bg-rose-400/[0.05] text-rose-300"
              }`}>
                {status}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleTestAndContinue}
            disabled={testing || !apiKey.trim()}
            className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#00ffaa] to-[#16d6ff] text-sm font-bold tracking-[0.12em] text-[#03100c] uppercase shadow-[0_12px_35px_rgba(0,255,170,0.14)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {testing ? "Testing Gemini..." : "Test, Save & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
};
