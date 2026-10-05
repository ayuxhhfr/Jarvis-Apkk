/**
 * Individual chat message component for JARVIS.
 * Follows strict assistant style:
 * - User: right aligned, subtle dark/green tinted bubble, compact width, rounded corners
 * - JARVIS: left aligned, subtle dark/glass bubble, compact width, subtle green accent
 * - Subtle speaking indicator (e.g. JARVIS • SPEAKING with pulsing dot) during active streaming/speech
 * - No avatars, no giant cards, no horizontal overflow
 */

import React from "react";
import { ChatMessage } from "../types/message";
import { Volume2 } from "lucide-react";

interface MessageProps {
  message: ChatMessage;
}

export const Message: React.FC<MessageProps> = ({ message }) => {
  const isUser = message.role === "user" || message.sender === "user";
  const content = message.content || message.text || "";
  const isStreaming = message.status === "streaming" || message.isStreaming;
  const isInterrupted = message.status === "interrupted";

  const formattedTime = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  const timing = message.timing;
  const timingLine = timing?.totalMs !== undefined
    ? `REQ ${new Date(timing.requestAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 })} → FIRST ${timing.firstResponseAt ? new Date(timing.firstResponseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }) : "—"} → DONE ${timing.completedAt ? new Date(timing.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }) : "—"} · TTFT ${timing.timeToFirstMs ?? "—"}ms · TOTAL ${timing.totalMs}ms`
    : undefined;

  return (
    <div
      className={`w-full flex flex-col ${
        isUser ? "items-end" : "items-start"
      } my-1 sm:my-2 select-text animate-messageIn`}
    >
      <div
        className={`max-w-[88%] sm:max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed transition-all shadow-md ${
          isUser
            ? "bg-[#0a1e15]/95 text-[#e6f7f0] border border-[#00ffaa]/20 rounded-tr-none shadow-[0_2px_12px_rgba(0,255,170,0.04)]"
            : "bg-[#0d1013]/95 text-[#e6e8eb] border border-white/[0.06] rounded-tl-none relative pl-[18px] backdrop-blur-sm shadow-[0_2px_12px_rgba(0,0,0,0.25)]"
        }`}
      >
        {/* Left accent indicator for JARVIS */}
        {!isUser && (
          <span className="absolute left-0 top-3 bottom-3 w-[2.5px] bg-[#00ffaa]/70 rounded-full" />
        )}

        {/* Subtle Speaking State Indicator when assistant is actively streaming/speaking */}
        {!isUser && isStreaming && (
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#00ffaa] mb-1 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ffaa] animate-pulse" />
            <span className="tracking-widest uppercase font-medium">
              {message.sender === "ira" ? "IRA" : "JARVIS"} • SPEAKING
            </span>
            <span className="flex items-center gap-0.5 ml-1">
              <span className="w-0.5 h-2 bg-[#00ffaa] animate-pulse" />
              <span className="w-0.5 h-3 bg-[#00ffaa] animate-pulse delay-75" />
              <span className="w-0.5 h-1.5 bg-[#00ffaa] animate-pulse delay-150" />
            </span>
          </div>
        )}

        {/* Render Attached Image if exists */}
        {message.image?.data && (
          <div className="mb-2 max-w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black/40">
            <img
              src={message.image.data.startsWith("data:") ? message.image.data : `data:${message.image.mimeType || "image/jpeg"};base64,${message.image.data}`}
              alt="Uploaded visual context"
              className="max-h-48 sm:max-h-64 object-contain w-auto rounded-lg mx-auto"
            />
          </div>
        )}

        {/* Message Content */}
        <p className="whitespace-pre-wrap break-words font-sans text-[13px] md:text-sm leading-relaxed">
          {content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#00ffaa] animate-pulse align-middle" />
          )}
        </p>

        {/* Footer: timestamp + status + voice badge */}
        <div
          className={`flex items-center gap-1.5 mt-1 font-mono text-[10px] select-none ${
            isUser ? "text-[#00ffaa]/60 justify-end" : "text-neutral-500 justify-start"
          }`}
        >
          {message.isVoice && <Volume2 className="w-2.5 h-2.5 opacity-60" />}
          <span>{formattedTime}</span>
          {timingLine && (
            <span className="block w-full basis-full text-[8px] leading-tight text-neutral-600 mt-0.5 break-all" title="Request / first response / completion timestamps and latency in milliseconds">
              {timingLine}
            </span>
          )}
          {isInterrupted && (
            <span className="text-neutral-500 italic ml-1">(interrupted)</span>
          )}
        </div>
      </div>
    </div>
  );
};
