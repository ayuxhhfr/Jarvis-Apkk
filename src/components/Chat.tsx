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
  const scrollFrameRef = useRef<number | null>(null);

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

    // Streaming can update the last message many times per second. Coalesce
    // those scroll operations into one frame and avoid animated scrolling
    // while text/audio is actively arriving.
    if (isNewMessageAdded || isNearBottomRef.current) {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      const isStreaming = messages.some((message) => message.isStreaming || message.status === "streaming");
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const el = containerRef.current;
        if (!el) return;
        if (isStreaming) {
          el.scrollTop = el.scrollHeight;
        } else {
          bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      });
    }
  }, [messages]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`w-full h-full overflow-y-auto px-4 py-2 space-y-1.5 ${className}`}
    >
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
};
