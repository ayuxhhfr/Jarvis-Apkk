/**
 * Minimal top bar for JARVIS.
 * Displays JARVIS branding, real-time connection status indicator, and settings trigger.
 */

import React from "react";
import { SlidersHorizontal, Globe, Monitor, X, Loader2, ExternalLink } from "lucide-react";
import { ConnectionStatus } from "../types/assistant";
import { ScreenShareStatus } from "../types/screenShare";

interface HeaderProps {
  assistantName?: string;
  status: ConnectionStatus;
  screenShareStatus?: ScreenShareStatus;
  onStartScreenShare?: () => void;
  onStopScreenShare?: () => void;
  onOpenInNewTab?: () => void;
  onOpenSettings: () => void;
  onOpenBrowser?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  assistantName = "JARVIS",
  status,
  screenShareStatus,
  onStartScreenShare,
  onStopScreenShare,
  onOpenInNewTab,
  onOpenSettings,
  onOpenBrowser,
}) => {
  const isSharing = screenShareStatus?.state === "SHARING";
  const isRequesting = screenShareStatus?.state === "REQUESTING";
  const isIframeRestricted = screenShareStatus?.isIframeRestricted;

  const getStatusDisplay = () => {
    switch (status) {
      case "online":
        return {
          label: "Online",
          dotColor: "bg-[#00ffaa] shadow-[0_0_8px_#00ffaa]",
          textColor: "text-[#00ffaa]",
        };
      case "connecting":
        return {
          label: "Connecting...",
          dotColor: "bg-amber-400 animate-pulse",
          textColor: "text-amber-400",
        };
      case "error":
        return {
          label: "Attention Required",
          dotColor: "bg-rose-500",
          textColor: "text-rose-400",
        };
      case "disconnected":
      default:
        return {
          label: "Offline",
          dotColor: "bg-neutral-500",
          textColor: "text-neutral-400",
        };
    }
  };

  const statusInfo = getStatusDisplay();

  return (
    <header className="w-full flex items-center justify-between px-4 py-2.5 sm:px-6 sm:py-3.5 border-b border-white/[0.05] bg-[#08090a]/80 backdrop-blur-md z-30 select-none">
      {/* Top Left: JARVIS / Ira Brand */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-lg md:text-xl font-bold tracking-[0.25em] text-white uppercase">
            {assistantName}
          </span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ffaa]/60" />
        </div>
        <span className="text-[10px] tracking-[0.28em] font-mono text-neutral-400 uppercase -mt-0.5">
          PERSONAL ASSISTANT
        </span>
      </div>

      {/* Top Right: Status & Action Controls */}
      <div className="flex items-center gap-1.5 sm:gap-3 md:gap-4">
        {/* Screen Sharing Control */}
        {isSharing ? (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-[#00ffaa]/40 text-xs font-mono text-[#00ffaa] shadow-[0_0_12px_rgba(0,255,170,0.2)] animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#00ffaa] shadow-[0_0_8px_#00ffaa]" />
            <span className="tracking-wider">SCREEN SHARING</span>
            {onStopScreenShare && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStopScreenShare();
                }}
                className="ml-1 p-0.5 rounded text-neutral-400 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
                title="Stop Screen Sharing"
                aria-label="Stop Screen Sharing"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : isRequesting ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-amber-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="hidden sm:inline">Requesting Screen...</span>
          </div>
        ) : isIframeRestricted ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onOpenInNewTab) onOpenInNewTab();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 transition-all border border-cyan-500/30 text-xs font-mono cursor-pointer"
            title="Open in standalone tab to enable Screen Sharing"
            aria-label="Open in New Tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Open in New Tab (Screen Share)</span>
          </button>
        ) : onStartScreenShare ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStartScreenShare();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.1] text-neutral-300 hover:text-[#00ffaa] transition-all border border-white/[0.08] hover:border-[#00ffaa]/40 text-xs font-mono cursor-pointer active:scale-95"
            title="Share Screen with JARVIS"
            aria-label="Share Screen"
          >
            <Monitor className="w-3.5 h-3.5 text-[#00ffaa]/80" />
            <span className="hidden sm:inline">Screen Share</span>
          </button>
        ) : null}

        {/* Connection status badge */}
        <div 
          className="flex items-center justify-center sm:gap-2 p-1.5 sm:px-2.5 sm:py-1 rounded-full bg-white/[0.03] border border-white/[0.06] text-[10px] sm:text-xs font-mono cursor-default shrink-0"
          title={`Connection Status: ${statusInfo.label}`}
        >
          <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${statusInfo.dotColor}`} />
          <span className={`hidden sm:inline ${statusInfo.textColor}`}>
            {statusInfo.label}
          </span>
        </div>

        {/* Browser shortcut button */}
        {onOpenBrowser && (
          <button
            onClick={onOpenBrowser}
            className="p-2 rounded-lg text-neutral-400 hover:text-[#00ffaa] hover:bg-white/[0.06] active:scale-95 transition-all border border-transparent hover:border-white/[0.08] cursor-pointer"
            title="Open JARVIS Browser"
            aria-label="Built-in Browser"
          >
            <Globe className="w-4 h-4" />
          </button>
        )}

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all border border-transparent hover:border-white/[0.08] cursor-pointer"
          title="Settings & Diagnostics"
          aria-label="Settings"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
