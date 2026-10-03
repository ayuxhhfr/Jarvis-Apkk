/**
 * Text and REST fallback service for JARVIS.
 * Handles text queries, conversation history, and voice synthesis for text mode.
 */

import { CHAT_MODEL, LIVE_MODEL, VOICE } from "../config/jarvisConfig";
import { isAndroidApp, getAndroidApiKey } from "./androidRuntime";

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
   * Ask Gemini whether a user message contains durable personal/project/preference
   * information worth saving. This deliberately runs before local heuristics so
   * JARVIS does not save every conversational sentence.
   */
  public async classifyMemoryCandidate(message: string): Promise<{
    shouldRemember: boolean;
    content?: string;
    category?: "personal" | "preference" | "project" | "instruction" | "routine" | "technical" | "other";
    importance?: number;
    reason?: string;
  }> {
    const prompt = message.trim();
    if (!prompt) return { shouldRemember: false, reason: "empty" };

    const system = `You are the long-term memory gatekeeper for a personal AI assistant.
Decide whether the USER MESSAGE contains stable information that would be useful across future conversations.
SAVE examples: identity/name, stable preferences, coding skills/interests, technologies they use, ongoing projects, recurring routines, explicit behavioral instructions, important long-term goals.
DO NOT SAVE: greetings, questions, temporary tasks, one-off requests, transient emotions, ordinary conversation, facts about the assistant, or information that is only useful for this single turn.
A statement like "I like coding" SHOULD be saved as a preference/technical interest. "I am using TypeScript for this project" can be saved as technical/project context if it appears durable.
Return ONLY valid JSON: {"shouldRemember":boolean,"content":string,"category":"personal|preference|project|instruction|routine|technical|other","importance":1-5,"reason":string}.
Rewrite saved content as a concise third-person fact about the user. Never invent facts.`;

    const body = {
      message: prompt,
      systemInstruction: system,
      model: CHAT_MODEL,
      history: [],
    };

    try {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Memory classifier HTTP ${res.status}`);
      const raw = await res.text();
      const text = raw.split("\n").filter(Boolean).map((line) => {
        if (!line.startsWith("data: ")) return "";
        const data = line.slice(6).trim();
        if (data === "[DONE]") return "";
        try { return JSON.parse(data).text || ""; } catch { return ""; }
      }).join("").trim();
      const cleaned = text.replace(/^\s*\`\`\`(?:json)?/i, "").replace(/\`\`\`\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      return parsed;
    } catch (serverErr) {
      // Android has no Node server, so use the same Gemini model directly.
      if (!isAndroidApp()) return { shouldRemember: false, reason: "classifier unavailable" };
      try {
        const key = getAndroidApiKey().trim();
        if (!key) return { shouldRemember: false, reason: "no Android Gemini key" };
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(CHAT_MODEL) + ":generateContent?key=" + encodeURIComponent(key),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0 },
            }),
          }
        );
        if (!res.ok) throw new Error(`Direct memory classifier HTTP ${res.status}`);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
        return JSON.parse(text.replace(/^\\s*\`\`\`(?:json)?/i, "").replace(/\`\`\`\\s*$/i, "").trim());
      } catch (androidErr) {
        console.warn("Gemini memory classifier unavailable:", serverErr, androidErr);
        return { shouldRemember: false, reason: "classifier unavailable" };
      }
    }
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
