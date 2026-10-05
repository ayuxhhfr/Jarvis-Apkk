/**
 * Conversation and transcript message data types for JARVIS.
 * Follows the clean specification:
 * { id, role: "user" | "assistant", content, timestamp, status?: "streaming" | "complete" | "interrupted" }
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  status?: "streaming" | "complete" | "interrupted";
  isVoice?: boolean;

  // Backward compatibility properties for any legacy references
  sender?: "user" | "jarvis" | "ira" | string;
  text?: string;
  isStreaming?: boolean;
  image?: {
    data: string;
    mimeType?: string;
  };

  /** Precise request/response timing for latency diagnostics. All durations are milliseconds. */
  timing?: {
    requestAt: number;
    firstResponseAt?: number;
    completedAt?: number;
    timeToFirstMs?: number;
    totalMs?: number;
  };
}
