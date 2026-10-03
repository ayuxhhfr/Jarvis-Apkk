/**
 * BrowserContent Component.
 * The ONLY element responsible for rendering the external website or clean fallback states.
 * Strictly guarantees that the JARVIS shell is NEVER rendered inside this container.
 */

import React, { useState, useEffect, useRef } from "react";
import { ExternalLink, ShieldAlert, RotateCw, ArrowLeft, Globe } from "lucide-react";

interface BrowserContentProps {
  browserUrl: string | null;
  loading: boolean;
  isBlocked: boolean;
  onLoad: () => void;
  onError: () => void;
  onOpenExternal: () => void;
  onGoBack: () => void;
  onReload: () => void;
}

export const BrowserContent: React.FC<BrowserContentProps> = ({
  browserUrl,
  loading,
  isBlocked,
  onLoad,
  onError,
  onOpenExternal,
  onGoBack,
  onReload,
}) => {
  const [showEmbedNotice, setShowEmbedNotice] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Detect websites with known strict X-Frame-Options (Google, YouTube, Spotify, Reddit, Netflix, etc.)
  useEffect(() => {
    if (!browserUrl) {
      setShowEmbedNotice(false);
      return;
    }

    setShowEmbedNotice(false);

    // Well-known sites that send X-Frame-Options: SAMEORIGIN or DENY
    const isStrictDomain = /google\.com|youtube\.com|spotify\.com|instagram\.com|netflix\.com|reddit\.com|x\.com|twitter\.com/i.test(
      browserUrl
    );

    if (isStrictDomain) {
      const timer = setTimeout(() => {
        setShowEmbedNotice(true);
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [browserUrl]);

  // 1. Empty State: browserUrl is null
  if (!browserUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#07090c] text-neutral-400 select-none p-6">
        <Globe className="w-12 h-12 text-neutral-600 mb-3 stroke-[1.2]" />
        <h3 className="text-base font-medium text-neutral-200 font-mono tracking-wide">
          Ready to browse
        </h3>
        <p className="text-xs text-neutral-500 font-sans mt-1">
          Enter a web address or ask JARVIS to open a website.
        </p>
      </div>
    );
  }

  // Domain name extraction for error & info notices
  const domain = (() => {
    try {
      return new URL(browserUrl).hostname.replace(/^www\./, "");
    } catch {
      return browserUrl;
    }
  })();

  // 2. Blocked State (X-Frame-Options or CSP failure)
  if (isBlocked) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#07090c] text-neutral-300 p-6 select-none animate-fadeIn">
        <div className="max-w-md w-full p-6 rounded-2xl bg-[#0f1318] border border-amber-500/25 shadow-2xl flex flex-col items-center text-center space-y-4">
          <div className="p-3 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-white font-mono tracking-wider uppercase">
              Website can't be displayed inside JARVIS
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed font-sans">
              <strong className="text-neutral-200">{domain}</strong> enforces strict security
              policies (<code className="text-amber-300 font-mono">X-Frame-Options</code>) that prevent
              it from being embedded inside another application.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2.5 pt-2 w-full">
            <button
              onClick={onOpenExternal}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#00ffaa] text-black font-mono font-medium hover:bg-[#00e599] transition-all text-xs cursor-pointer shadow-md"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in New Tab</span>
            </button>

            <button
              onClick={onReload}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-mono text-xs cursor-pointer transition-all"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Try Again</span>
            </button>

            <button
              onClick={onGoBack}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-neutral-300 font-mono text-xs cursor-pointer transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Normal Web Content Rendering
  return (
    <div className="relative w-full h-full bg-[#050608] overflow-hidden">
      {/* The isolated website iframe. Src ALWAYS comes strictly from browserUrl. */}
      <iframe
        key={browserUrl}
        ref={iframeRef}
        src={browserUrl}
        title="JARVIS Browser"
        className="w-full h-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-downloads"
        onLoad={onLoad}
        onError={() => {
          onError();
          setShowEmbedNotice(true);
        }}
      />

      {/* Helpful banner for embedding-restricted websites (YouTube, Google, etc.) */}
      {showEmbedNotice && (
        <div className="absolute top-4 left-4 right-4 max-w-lg mx-auto p-3.5 rounded-2xl bg-[#0c1015]/95 border border-white/[0.1] text-xs shadow-2xl backdrop-blur-md animate-fadeIn z-20 space-y-2">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold text-white font-mono text-[11px] tracking-wider uppercase">
                {domain} Security Notice
              </div>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                If the page displays a connection refusal, open it directly in a dedicated tab.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
            <button
              onClick={onOpenExternal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00ffaa] text-black font-mono font-medium hover:bg-[#00e599] transition-all text-xs cursor-pointer shadow-sm"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in New Tab</span>
            </button>

            <button
              onClick={() => setShowEmbedNotice(false)}
              className="ml-auto px-2.5 py-1 text-neutral-400 hover:text-white text-xs font-mono"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
