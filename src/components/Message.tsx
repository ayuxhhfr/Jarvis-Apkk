/**
 * Single-message JARVIS presentation for the live screen.
 * Conversation history is intentionally kept out of the main viewport.
 */
import React from "react";
import { ChatMessage } from "../types/message";
import { Volume2 } from "lucide-react";

interface MessageProps { message: ChatMessage; }

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  const isUser = message.role === "user" || message.sender === "user";
  const content = message.content || message.text || "";
  const isStreaming = message.status === "streaming" || message.isStreaming;
  const isInterrupted = message.status === "interrupted";
  const name = message.sender === "ira" ? "IRA" : isUser ? "YOU" : "JARVIS";

  return (
    <div className="w-full max-w-2xl mx-auto flex justify-center select-text animate-messageIn">
      <div className="w-full text-center px-2 sm:px-5">
        <div className={`mb-2 text-[9px] sm:text-[10px] font-mono tracking-[0.30em] uppercase ${isUser ? "text-cyan-400/65" : "text-cyan-300/75"}`}>
          {isStreaming ? `${name} • SPEAKING` : name}
        </div>

        {message.image?.data && (
          <div className="mb-3 max-w-full overflow-hidden rounded-2xl border border-cyan-400/10 bg-black/20">
            <img
              src={message.image.data.startsWith("data:") ? message.image.data : `data:${message.image.mimeType || "image/jpeg"};base64,${message.image.data}`}
              alt="Uploaded visual context"
              className="max-h-44 sm:max-h-56 object-contain w-auto rounded-xl mx-auto"
            />
          </div>
        )}

        <p className={`whitespace-pre-wrap break-words font-sans text-[17px] sm:text-[19px] md:text-[21px] leading-[1.55] tracking-[0.01em] ${isUser ? "text-cyan-50" : "text-white/95"}`}>
          {content}
          {isStreaming && <span className="inline-block w-1.5 h-5 ml-1 bg-cyan-300 animate-pulse align-middle rounded-full" />}
        </p>

        <div className="mt-3 flex items-center justify-center gap-2 text-[9px] font-mono tracking-[0.16em] uppercase text-neutral-600">
          {message.isVoice && <Volume2 className="w-3 h-3 opacity-60" />}
          {isStreaming && <span className="flex gap-0.5 items-end h-3"><i className="w-0.5 h-1.5 bg-cyan-400 animate-pulse rounded-full"/><i className="w-0.5 h-2.5 bg-cyan-400 animate-pulse rounded-full"/><i className="w-0.5 h-1 bg-cyan-400 animate-pulse rounded-full"/></span>}
          {isInterrupted && <span>interrupted</span>}
        </div>
      </div>
    </div>
  );
};

export const Message = React.memo(MessageComponent);
