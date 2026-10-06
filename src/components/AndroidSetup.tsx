import React, { useEffect, useState } from "react";
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
  X,
} from "lucide-react";
import {
  isAndroidApp,
  readAndroidClipboard,
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
    const timer = window.setTimeout(() => setStatus(""), statusKind === "error" ? 7000 : 3500);
    return () => window.clearTimeout(timer);
  }, [status, statusKind]);

  const showStatus = (message: string, kind: "error" | "success" | "info" = "error") => {
    setStatus(message);
    setStatusKind(kind);
  };

  const handlePaste = async () => {
    try {
      const value = isAndroidApp()
        ? await readAndroidClipboard()
        : await navigator.clipboard.readText();

      if (!value.trim()) {
        showStatus("Clipboard is empty. Copy your Gemini API key first.", "error");
        return;
      }

      setApiKey(value.trim());
      setStatus("");
      setPasted(true);
      window.setTimeout(() => setPasted(false), 1200);
    } catch {
      showStatus("Clipboard access is unavailable. Use manual paste or enter the key.", "error");
    }
  };

  const handleTestAndContinue = async () => {
    const value = apiKey.trim();
    if (!value) {
      showStatus("Enter your Gemini API key first.", "error");
      return;
    }

    setTesting(true);
    setStatus("");
    try {
      await validateAndroidApiKey(value);
      showStatus("Gemini access verified. JARVIS is ready.", "success");
      window.setTimeout(onComplete, 500);
    } catch (error) {
      showStatus(
        error instanceof Error ? error.message : "API key validation failed.",
        "error"
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 sm:p-6 bg-[#03111f]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(22,190,255,0.16),transparent_42%),radial-gradient(circle_at_15%_90%,rgba(0,255,170,0.08),transparent_34%)]" />

      <div className="relative w-full max-w-[620px] max-h-[92vh] overflow-y-auto rounded-[26px] border border-cyan-300/[0.12] bg-[#071019]/95 shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-cyan-300/[0.08] to-transparent pointer-events-none" />

        <div className="relative px-6 pt-8 pb-7 sm:px-8 sm:pt-9">
          <div className="flex flex-col items-center text-center">
            <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] border border-cyan-300/20 bg-gradient-to-br from-cyan-300/15 via-[#0b2635] to-[#101827] shadow-[0_0_35px_rgba(22,190,255,0.12)]">
              <KeyRound className="h-8 w-8 text-cyan-300" strokeWidth={1.7} />
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono tracking-[0.28em] text-cyan-300/80 uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              JARVIS INITIALIZATION
            </div>

            <h1 className="mt-2 text-2xl sm:text-[28px] font-semibold tracking-[0.08em] text-white uppercase font-mono">
              Set Up JARVIS
            </h1>

            <p className="mt-3 max-w-[500px] text-sm sm:text-[15px] leading-7 text-neutral-400">
              Add the Gemini API key required to activate JARVIS&apos;s intelligence,
              conversation, memory, voice, and Android actions.
              <span className="text-neutral-300"> You only need to complete this once.</span>
            </p>
          </div>

          <div className="mt-7 rounded-[22px] border border-cyan-300/10 bg-[#050b12]/85 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-[0.18em] text-cyan-100/85 font-mono uppercase">
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
                className="h-[58px] w-full rounded-2xl border border-white/[0.09] bg-[#101820] px-4 pr-12 text-sm text-white outline-none transition focus:border-cyan-300/45 focus:ring-4 focus:ring-cyan-300/[0.06] font-mono placeholder:text-neutral-600"
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
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] text-xs font-mono text-neutral-300 transition hover:border-cyan-300/20 hover:bg-cyan-300/[0.05]"
              >
                {pasted ? <CheckCircle2 className="h-4 w-4 text-cyan-300" /> : <Clipboard className="h-4 w-4" />}
                {pasted ? "Pasted" : "Paste"}
              </button>

              <button
                type="button"
                onClick={handleTestAndContinue}
                disabled={testing || !apiKey.trim()}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] text-xs font-mono font-semibold text-cyan-100 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.10] disabled:cursor-not-allowed disabled:opacity-35"
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
                <span className="mr-1 text-cyan-300">▸</span> HOW TO GET A KEY
              </summary>
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 text-xs leading-6 text-neutral-500">
                Open Google AI Studio, create/view a Gemini API key, copy it,
                then paste it here. Keep the key private.
              </div>
            </details>

            <div className="mt-5 flex items-start gap-2.5 border-t border-white/[0.06] pt-4 text-[11px] leading-5 text-neutral-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300/60" />
              <span>
                JARVIS stores the key locally on this Android installation and
                uses it for Gemini requests from this app.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestAndContinue}
            disabled={testing || !apiKey.trim()}
            className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 to-[#1de7ff] text-sm font-bold tracking-[0.12em] text-[#031019] uppercase shadow-[0_12px_35px_rgba(22,190,255,0.14)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {testing ? "Testing Gemini..." : "Test, Save & Continue"}
          </button>
        </div>
      </div>

      {status && (
        <div
          role="alertdialog"
          aria-live="assertive"
          className="fixed bottom-5 left-1/2 z-[120] w-[calc(100%-32px)] max-w-[430px] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#08131e]/[0.98] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          <div className="flex items-start gap-3">
            {statusKind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            ) : (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-neutral-500">
                {statusKind === "success" ? "JARVIS READY" : "SETUP ISSUE"}
              </p>
              <p className="mt-1 text-sm leading-5 text-neutral-200 break-words">{status}</p>
            </div>
            <button
              type="button"
              onClick={() => setStatus("")}
              aria-label="Close message"
              className="rounded-lg p-1 text-neutral-500 hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
