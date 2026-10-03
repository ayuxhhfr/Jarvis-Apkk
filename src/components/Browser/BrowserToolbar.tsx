/**
 * Browser Toolbar for JARVIS.
 * Contains navigation controls (back, forward, reload), address bar,
 * external pop-out trigger, and close button.
 */

import React from "react";
import { ChevronLeft, ChevronRight, RotateCw, X, ExternalLink } from "lucide-react";
import { BrowserAddressBar } from "./BrowserAddressBar";

interface BrowserToolbarProps {
  currentUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onClose: () => void;
}

export const BrowserToolbar: React.FC<BrowserToolbarProps> = ({
  currentUrl,
  canGoBack,
  canGoForward,
  loading,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onClose,
}) => {
  const handleOpenExternal = () => {
    if (currentUrl) {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="relative w-full flex items-center gap-2 px-3 py-2 bg-[#0c0f13] border-b border-white/[0.08] select-none z-10">
      {/* Navigation Buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={onGoBack}
          disabled={!canGoBack}
          aria-label="Back"
          title="Back"
          className={`p-1.5 rounded-lg transition-colors ${
            canGoBack
              ? "text-neutral-300 hover:text-white hover:bg-white/[0.08] active:scale-95 cursor-pointer"
              : "text-neutral-600 cursor-not-allowed"
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={onGoForward}
          disabled={!canGoForward}
          aria-label="Forward"
          title="Forward"
          className={`p-1.5 rounded-lg transition-colors ${
            canGoForward
              ? "text-neutral-300 hover:text-white hover:bg-white/[0.08] active:scale-95 cursor-pointer"
              : "text-neutral-600 cursor-not-allowed"
          }`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={onReload}
          aria-label="Reload"
          title="Reload"
          className="p-1.5 rounded-lg text-neutral-300 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-colors cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#00ffaa]" : ""}`} />
        </button>
      </div>

      {/* Address Bar */}
      <BrowserAddressBar
        currentUrl={currentUrl}
        onNavigate={onNavigate}
        loading={loading}
      />

      {/* Action Buttons: Pop-out & Close */}
      <div className="flex items-center gap-1">
        {currentUrl && (
          <button
            onClick={handleOpenExternal}
            title="Open in new window / tab"
            aria-label="Open in new window"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onClose}
          title="Close Browser (Return to JARVIS)"
          aria-label="Close browser"
          className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
