/**
 * Clean live conversation surface.
 * The main JARVIS screen intentionally shows only the latest message.
 * Full history is available through the dedicated Conversations panel.
 */
import React from "react";
import { ChatMessage } from "../types/message";
import { Message } from "./Message";

interface ChatProps {
  messages: ChatMessage[];
  className?: string;
}

export const Chat: React.FC<ChatProps> = ({ messages, className = "" }) => {
  const latest = messages[messages.length - 1];
  if (!latest) return null;

  return (
    <div className={`w-full h-full flex items-center justify-center px-5 py-3 overflow-hidden ${className}`}>
      <Message message={latest} />
    </div>
  );
};
