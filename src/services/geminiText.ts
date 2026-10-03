/**
 * Text and REST fallback service for JARVIS.
 * Handles text queries, conversation history, and voice synthesis for text mode.
 */

import { CHAT_MODEL, LIVE_MODEL, VOICE } from "../config/jarvisConfig";

export interface ChatRequestOptions {
  message: string;
  systemInstruction?: string;
  history?: Array<{ role: "user" | "model"; text: string }>;
  model?: string;
  image?: {
    data: string;
    mimeType?: string;
  };
  images?: Array<{
    data: string;
    mimeType?: string;
  }>;
}

export interface StatusResponse {
  ok: boolean;
  model: string;
  hasKey: boolean;
  status: string;
}

export class GeminiTextService {
  /**
   * Check server health and Gemini configuration.
   */
  public async checkStatus(): Promise<StatusResponse> {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      return {
        ok: false,
        model: CHAT_MODEL,
        hasKey: false,
        status: err instanceof Error ? err.message : "Server unavailable",
      };
    }
  }

  /**
   * Send a text message to the server chat endpoint with streaming response.
   */
  public async sendTextMessageStream(
    options: ChatRequestOptions,
    onChunk: (chunk: string) => void,
    onToolCall?: (toolCall: { name: string; args: any }) => void
  ): Promise<string> {
    const res = await fetch("/api/gemini/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.message,
        systemInstruction: options.systemInstruction,
        history: options.history || [],
        model: options.model || CHAT_MODEL,
        image: options.image,
        images: options.images,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }

    if (!res.body) {
      throw new Error("No response body received from server");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error && !parsed.text) {
                throw new Error(parsed.error);
              }
              if (parsed.toolCall && onToolCall) {
                onToolCall(parsed.toolCall);
              }
              if (parsed.text) {
                fullText += parsed.text;
                onChunk(parsed.text);
              }
            } catch (err: any) {
              if (err?.message && !data.startsWith("{")) {
                fullText += data;
                onChunk(data);
              } else if (err?.message && data.includes('"error"')) {
                throw err;
              }
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    return fullText;
  }

  /**
   * Generate speech audio for text output when voice output is enabled.
   */
  public async textToSpeech(text: string, voiceName: string = VOICE, signal?: AbortSignal): Promise<string | null> {
    try {
      const res = await fetch("/api/gemini/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: voiceName,
        }),
        signal,
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      return data.audio || null;
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("TTS generation aborted");
      } else {
        console.warn("TTS generation warning:", err);
      }
      return null;
    }
  }
}

export const geminiText = new GeminiTextService();
