/**
 * Primary Voice Button component positioned directly below the globe.
 * Provides touch-friendly microphone toggle, real-time waveform pulse,
 * and current state text indicators.
 */

import React from "react";
import { Mic, MicOff, Square, Loader2 } from "lucide-react";
import { AssistantState } from "../types/assistant";

interface VoiceButtonProps {
  state: AssistantState;
  isMicActive: boolean;
  micLevel: number;
  outputLevel: number;
  onToggle: () => void;
  onInterrupt: () => void;
  className?: string;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  state,
  isMicActive,
  micLevel,
  outputLevel,
  onToggle,
  onInterrupt,
  className = "",
}) => {
  const getStatusLabel = () => {
    switch (state) {
      case "listening":
        return "Listening";
      case "thinking":
        return "Thinking";
      case "speaking":
        return "Speaking";
      case "idle":
      default:
        return isMicActive ? "Listening" : "Tap to speak";
    }
  };

  const handleClick = () => {
    if (state === "speaking") {
      // Direct interrupt when tapping while speaking
      onInterrupt();
    } else {
      onToggle();
    }
  };

  // Determine current active audio amplitude
  const activeLevel = state === "listening" ? micLevel : state === "speaking" ? outputLevel : 0;

  return (
    <div className={`flex flex-col items-center justify-center gap-3 select-none ${className}`}>
      {/* Outer interactive button */}
      <div className="relative flex items-center justify-center">
        {/* Audio Reactivity Glow Rings */}
        {(state === "listening" || state === "speaking") && (
          <>
            <div
              className="absolute inset-0 rounded-full bg-[#00ffaa]/15 blur-md pointer-events-none transition-transform duration-100"
              style={{
                transform: `scale(${1.2 + activeLevel * 0.8})`,
              }}
            />
            <div
              className="absolute inset-0 rounded-full border border-[#00ffaa]/30 pointer-events-none transition-transform duration-100"
              style={{
                transform: `scale(${1.15 + activeLevel * 0.5})`,
                opacity: 0.3 + activeLevel * 0.7,
              }}
            />
          </>
        )}

        {/* The Button */}
        <button
          onClick={handleClick}
          aria-label={getStatusLabel()}
          className={`relative z-10 flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 md:w-18 md:h-18 rounded-full transition-all duration-300 shadow-lg active:scale-95 cursor-pointer ${
            isMicActive || state === "speaking"
              ? "bg-[#0b1b15] border-2 border-[#00ffaa] text-[#00ffaa] shadow-[0_0_20px_rgba(0,255,170,0.25)]"
              : state === "thinking"
              ? "bg-[#111618] border-2 border-cyan-500/70 text-cyan-400"
              : "bg-[#111417] border border-white/[0.12] text-neutral-300 hover:text-white hover:border-[#00ffaa]/60 hover:bg-[#151c19]"
          }`}
        >
          {state === "thinking" ? (
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          ) : state === "speaking" ? (
            <div className="flex items-center justify-center gap-0.5 h-6">
              {/* Subtle animated speech waveform bars */}
              <span
                className="w-1 bg-[#00ffaa] rounded-full transition-all duration-75"
                style={{ height: `${8 + activeLevel * 16}px` }}
              />
              <span
                className="w-1 bg-[#00ffaa] rounded-full transition-all duration-75"
                style={{ height: `${12 + activeLevel * 20}px` }}
              />
              <span
                className="w-1 bg-[#00ffaa] rounded-full transition-all duration-75"
                style={{ height: `${6 + activeLevel * 14}px` }}
              />
            </div>
          ) : isMicActive ? (
            <Mic className="w-6 h-6 animate-pulse text-[#00ffaa]" />
          ) : (
            <Mic className="w-6 h-6 transition-transform group-hover:scale-105" />
          )}
        </button>
      </div>

      {/* State label text directly below */}
      <div className="flex flex-col items-center">
        <span
          className={`font-mono text-xs tracking-[0.2em] uppercase transition-colors duration-200 ${
            state === "listening" || state === "speaking"
              ? "text-[#00ffaa] font-medium"
              : state === "thinking"
              ? "text-cyan-400"
              : "text-neutral-400"
          }`}
        >
          {getStatusLabel()}
        </span>

        {state === "speaking" && (
          <span className="text-[10px] font-mono text-neutral-500 mt-0.5 tracking-wider">
            (Tap to interrupt)
          </span>
        )}
      </div>
    </div>
  );
};
