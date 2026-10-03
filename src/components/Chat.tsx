/**
 * Chat Component for JARVIS.
 * Displays the live conversation feed.
 * Features:
 * - Independent smooth scrolling
 * - Intelligent auto-scroll (does not lock the user if they scroll up)
 * - Coexists cleanly with the central digital globe
 */

import React, { useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "../types/message";
import { Message } from "./Message";

interface ChatProps {
  messages: ChatMessage[];
  className?: string;
  onClear?: () => void;
}

export const Chat: React.FC<ChatProps> = ({ messages, className = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const prevMessagesLengthRef = useRef<number>(messages.length);

  // Monitor user scroll position to avoid forceful auto-scroll when user is reading past messages
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 60; // px from bottom
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom <= threshold;
  }, []);

  useEffect(() => {
    const isNewMessageAdded = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    // Scroll if user added a new message or is already near the bottom
    if (isNewMessageAdded || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`w-full h-full overflow-y-auto px-4 py-2 space-y-1.5 scroll-smooth ${className}`}
    >
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
};
