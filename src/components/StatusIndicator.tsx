/**
 * Subtle vertical status indicator for JARVIS.
 * Shows LISTENING, THINKING, SPEAKING, and IDLE states with active state highlighted.
 */

import React from "react";
import { AssistantState } from "../types/assistant";

interface StatusIndicatorProps {
  state: AssistantState;
  className?: string;
}

const STATES: Array<{ key: AssistantState; label: string }> = [
  { key: "listening", label: "LISTENING" },
  { key: "thinking", label: "THINKING" },
  { key: "speaking", label: "SPEAKING" },
  { key: "idle", label: "IDLE" },
];

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  state,
  className = "",
}) => {
  return (
    <aside
      className={`flex flex-col gap-2.5 font-mono text-[11px] tracking-[0.2em] select-none ${className}`}
      aria-label="Assistant State"
    >
      <div className="text-[9px] uppercase tracking-[0.25em] text-neutral-600 mb-1 font-semibold">
        State
      </div>
      {STATES.map(({ key, label }) => {
        const isActive = state === key;
        return (
          <div
            key={key}
            className={`flex items-center gap-2.5 transition-all duration-300 ${
              isActive
                ? "text-[#20d9ff] font-medium opacity-100 translate-x-1"
                : "text-neutral-500 opacity-40 hover:opacity-60"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                isActive
                  ? "bg-[#20d9ff] shadow-[0_0_8px_#20d9ff] scale-125"
                  : "bg-neutral-600"
              }`}
            />
            <span>{label}</span>
          </div>
        );
      })}
    </aside>
  );
};
