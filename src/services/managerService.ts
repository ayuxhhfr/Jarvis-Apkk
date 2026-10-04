/**
 * JARVIS Manager Service.
 *
 * Gemini 3.8 Flash is the authoritative reasoning/orchestration layer.
 * Gemini Live is deliberately kept out of this service: Live is only the
 * realtime voice I/O engine.
 */

import { CHAT_MODEL } from "../config/modelConfig";

export interface ManagerRequest {
  message: string;
  systemInstruction?: string;
  history?: Array<{ role: "user" | "model"; text: string }>;
  context?: string;
  image?: { data: string; mimeType?: string };
}

export class ManagerService {
  public async send(
    options: ManagerRequest,
    onChunk?: (chunk: string) => void,
    onToolCall?: (toolCall: { name: string; args: any }) => void
  ): Promise<string> {
    const res = await fetch("/api/gemini/manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.message,
        systemInstruction: options.systemInstruction,
        history: options.history || [],
        context: options.context || "",
        image: options.image,
        model: CHAT_MODEL,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Manager HTTP ${res.status}`);
    }

    if (!res.body) throw new Error("Manager returned no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          const parsed = JSON.parse(data);
          if (parsed.error && !parsed.text) {
            throw new Error(parsed.error);
          }

          if (parsed.toolCall && onToolCall) {
            onToolCall(parsed.toolCall);
          }

          if (parsed.text) {
            fullText += parsed.text;
            onChunk?.(parsed.text);
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    return fullText;
  }
}

export const managerService = new ManagerService();
