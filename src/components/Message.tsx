/**
 * Single-message JARVIS presentation for the live screen.
 * Streaming assistant output is progressively revealed with a subtle cursor.
 */
import React, { useEffect, useRef, useState } from "react";
import { ChatMessage } from "../types/message";
import { Volume2 } from "lucide-react";

interface MessageProps {
  message: ChatMessage;
}

const StreamingText: React.FC<{
  content: string;
  active: boolean;
}> = ({ content, active }) => {
  const [visible, setVisible] = useState(active ? "" : content);
  const visibleRef = useRef(visible);
  const targetRef = useRef(content);
  const activeRef = useRef(active);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    targetRef.current = content;
  }, [content]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      if (!active) {
        visibleRef.current = content;
        setVisible(content);
      }
      return;
    }

    if (!active) {
      visibleRef.current = content;
      setVisible(content);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const reveal = () => {
      if (cancelled) return;

      const target = targetRef.current;
      const current = visibleRef.current;

      if (!activeRef.current) {
        visibleRef.current = target;
        setVisible(target);
        return;
      }

      if (current.length >= target.length) return;

      // Reveal a small batch when streaming is fast, while keeping the
      // response visibly progressive instead of waiting for the full chunk.
      const gap = target.length - current.length;
      const step = gap > 80 ? 3 : gap > 24 ? 2 : 1;
      const next = target.slice(0, Math.min(target.length, current.length + step));

      visibleRef.current = next;
      setVisible(next);

      timer = window.setTimeout(reveal, gap > 80 ? 8 : 12);
    };

    reveal();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [content, active]);

  // If the app/user has requested reduced motion, do not animate text.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    visibleRef.current = content;
    setVisible(content);
  }, [content]);

  return <>{visible}</>;
};

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  const isUser = message.role === "user" || message.sender === "user";
  const content = message.content || message.text || "";
  const isStreaming = message.status === "streaming" || message.isStreaming;
  const isInterrupted = message.status === "interrupted";
  const name = message.sender === "ira" ? "IRA" : isUser ? "YOU" : "JARVIS";

  return (
    <div className="w-full max-w-2xl mx-auto flex justify-center select-text animate-messageIn">
      <div className="w-full text-center px-2 sm:px-5">
        <div
          className={`mb-2 text-[9px] sm:text-[10px] font-mono tracking-[0.30em] uppercase ${
            isUser ? "text-cyan-400/65" : "text-cyan-300/75"
          }`}
        >
          {isStreaming ? `${name} • SPEAKING` : name}
        </div>

        {message.image?.data && (
          <div className="mb-3 max-w-full overflow-hidden rounded-2xl border border-cyan-400/10 bg-black/20">
            <img
              src={
                message.image.data.startsWith("data:")
                  ? message.image.data
                  : `data:${message.image.mimeType || "image/jpeg"};base64,${message.image.data}`
              }
              alt="Uploaded visual context"
              className="mx-auto max-h-44 w-auto rounded-xl object-contain sm:max-h-56"
            />
          </div>
        )}

        <p
          className={`whitespace-pre-wrap break-words font-sans text-[clamp(15px,4.2vw,21px)] leading-[1.55] tracking-[0.01em] ${
            isUser ? "text-cyan-50" : "text-white/95"
          }`}
        >
          <StreamingText content={content} active={!isUser && Boolean(isStreaming)} />
          {!isUser && isStreaming && (
            <span
              aria-hidden="true"
              className="jarvis-response-cursor ml-1 inline-block h-[1.05em] w-[2px] translate-y-[0.12em] rounded-full bg-cyan-300 align-baseline"
            />
          )}
        </p>

        <div className="mt-3 flex items-center justify-center gap-2 text-[9px] font-mono tracking-[0.16em] uppercase text-neutral-600">
          {message.isVoice && <Volume2 className="h-3 w-3 opacity-60" />}
          {isStreaming && (
            <span className="flex h-3 items-end gap-0.5">
              <i className="h-1.5 w-0.5 animate-pulse rounded-full bg-cyan-400" />
              <i className="h-2.5 w-0.5 animate-pulse rounded-full bg-cyan-400" />
              <i className="h-1 w-0.5 animate-pulse rounded-full bg-cyan-400" />
            </span>
          )}
          {isInterrupted && <span>interrupted</span>}
        </div>
      </div>
    </div>
  );
};

export const Message = React.memo(MessageComponent);
