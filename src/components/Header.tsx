/**
 * Minimal top bar for JARVIS.
 * Displays branding, compact connection status, memory access and controls.
 */
import React from "react";
import { SlidersHorizontal, Compass, Monitor, X, Loader2, ExternalLink, Brain, MessageSquare } from "lucide-react";
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
  onOpenMemory?: () => void;
  onOpenBrowser?: () => void;
  onOpenChats?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  assistantName = "JARVIS", status, screenShareStatus, onStartScreenShare,
  onStopScreenShare, onOpenInNewTab, onOpenSettings, onOpenMemory, onOpenBrowser, onOpenChats,
}) => {
  const isSharing = screenShareStatus?.state === "SHARING";
  const isRequesting = screenShareStatus?.state === "REQUESTING";
  const isIframeRestricted = screenShareStatus?.isIframeRestricted;
  const statusInfo = (() => {
    switch (status) {
      case "online": return { label: "Online", dot: "bg-[#20d9ff] shadow-[0_0_8px_#20d9ff]", text: "text-[#20d9ff]" };
      case "connecting": return { label: "Connecting...", dot: "bg-amber-400 animate-pulse", text: "text-amber-400" };
      case "error": return { label: "Attention Required", dot: "bg-rose-500", text: "text-rose-400" };
      default: return { label: "Offline", dot: "bg-neutral-500", text: "text-neutral-400" };
    }
  })();

  return (
    <header className="jarvis-safe-top w-full flex items-center justify-between px-5 sm:px-7 py-2.5 border-b border-white/[0.045] bg-[#05050a]/55 backdrop-blur-md z-30 select-none">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-[18px] md:text-xl font-semibold tracking-[0.34em] text-white uppercase">{assistantName}</span>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} title={statusInfo.label} aria-label={statusInfo.label} />
        </div>
        <span className="text-[9px] tracking-[0.30em] font-mono text-neutral-500 uppercase">PERSONAL ASSISTANT</span>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {isSharing ? (
          <button type="button" onClick={onStopScreenShare} aria-label="Stop screen sharing" className="w-10 h-10 rounded-xl flex items-center justify-center text-cyan-300 bg-cyan-400/[0.08] border border-cyan-400/20">
            <X className="w-4 h-4"/>
          </button>
        ) : isRequesting ? (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-300 bg-amber-400/[0.06] border border-amber-400/15"><Loader2 className="w-4 h-4 animate-spin"/></div>
        ) : isIframeRestricted ? (
          <button type="button" onClick={onOpenInNewTab} aria-label="Open browser in new tab" className="w-10 h-10 rounded-xl flex items-center justify-center text-cyan-300 hover:bg-white/[0.05]"><ExternalLink className="w-4 h-4"/></button>
        ) : (
          <button type="button" onClick={onOpenBrowser} aria-label="Open JARVIS browser" className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-400 hover:text-cyan-300 hover:bg-white/[0.05]"><Compass className="w-[18px] h-[18px]"/></button>
        )}
        {onOpenMemory && <button onClick={onOpenMemory} aria-label="Memory Core" className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-400 hover:text-cyan-300 hover:bg-white/[0.05]"><Brain className="w-[18px] h-[18px]"/></button>}
        {onOpenChats && <button onClick={onOpenChats} aria-label="Conversations" className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-400 hover:text-cyan-300 hover:bg-cyan-300/[0.04]"><MessageSquare className="w-[18px] h-[18px]"/></button>}
        {onStartScreenShare && !isSharing && !isRequesting && !isIframeRestricted && <button type="button" onClick={onStartScreenShare} aria-label="Screen share" className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-400 hover:text-cyan-300 hover:bg-white/[0.05]"><Monitor className="w-[18px] h-[18px]"/></button>}
        <button onClick={onOpenSettings} aria-label="Settings" className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.05]"><SlidersHorizontal className="w-[18px] h-[18px]"/></button>
      </div>
    </header>
  );
};