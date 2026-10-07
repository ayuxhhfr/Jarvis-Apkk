/**
 * JARVIS conversation surface.
 * "latest" keeps the home screen minimal; "history" renders the complete session.
 */
import React, { useEffect, useRef } from "react";
import { ChatMessage } from "../types/message";
import { Message } from "./Message";

interface ChatProps {
  messages: ChatMessage[];
  className?: string;
  mode?: "latest" | "history";
}

export const Chat: React.FC<ChatProps> = ({ messages, className = "", mode = "latest" }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== "history") return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, mode]);

  if (mode === "latest") {
    const latest = messages[messages.length - 1];
    if (!latest) return null;
    return (
      <div className={`w-full h-full flex items-center justify-center px-2 sm:px-5 py-2 overflow-hidden ${className}`}>
        <Message message={latest} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`w-full h-full overflow-y-auto px-4 sm:px-6 py-5 space-y-3 ${className}`}>
      {messages.length === 0 ? (
        <div className="h-full flex items-center justify-center text-sm font-mono text-neutral-600">
          No messages in this conversation.
        </div>
      ) : messages.map((message) => <Message key={message.id} message={message} />)}
    </div>
  );
};
