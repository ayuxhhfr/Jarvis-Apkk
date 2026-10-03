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
    memories?: Array<{
      content: string;
      category: "personal" | "preference" | "project" | "instruction" | "routine" | "technical" | "other";
      importance: number;
    }>;
    reason?: string;
  }> {
    const prompt = message.trim();
    if (!prompt) return { shouldRemember: false, reason: "empty" };

    const system = `You are JARVIS's long-term memory intelligence layer.
Analyze the USER MESSAGE for information that should survive future conversations.

MEMORY SHOULD INCLUDE:
- stable identity/profile: name, age, location if explicitly stated, role, important background
- preferences: likes/dislikes, communication style, UI/design preferences, favorite things
- technical profile: coding interests, languages, frameworks, tools, devices, skill areas
- projects: projects being built, repos, apps, games, goals, ongoing work
- instructions: durable rules for how the assistant should behave
- routines: recurring habits/workflows
- durable goals: long-term goals or plans

IMPORTANT: "I like coding" IS a memory and must be saved.
Also save "I use React/TypeScript", "I prefer dark UI", "I am building JARVIS", etc. when stated as durable facts.

DO NOT SAVE:
- greetings or filler
- questions with no stable user fact
- one-time commands/tasks
- temporary emotions
- facts about the assistant/provider
- transient details only relevant to this turn

Extract EVERY distinct durable fact from the message, not just one. If several facts are present, return several memory objects.
Rewrite each as a concise third-person fact about the user. Never invent information.
Importance: 5 = core identity/critical instruction, 4 = strong preference/project/technical profile, 3 = useful stable fact, 2 = weak preference, 1 = trivial.
Return ONLY valid JSON:
{"shouldRemember":true|false,"memories":[{"content":"...","category":"personal|preference|project|instruction|routine|technical|other","importance":1}],"reason":"..."}
If nothing durable exists, return {"shouldRemember":false,"memories":[],"reason":"..."}.`;

    const parse = (text: string) => {
      const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.memories)) {
        parsed.memories = parsed.memories
          .filter((m: any) => m && typeof m.content === "string" && m.content.trim())
          .map((m: any) => ({
            content: m.content.trim(),
            category: m.category || "other",
            importance: Math.min(5, Math.max(1, Number(m.importance) || 3)),
          }));
      }
      return parsed;
    };

    try {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, systemInstruction: system, model: CHAT_MODEL, history: [] }),
      });
      if (!res.ok) throw new Error(`Memory classifier HTTP ${res.status}`);
      const raw = await res.text();
      const text = raw.split("\n").filter(Boolean).map((line) => {
        if (!line.startsWith("data: ")) return "";
        const data = line.slice(6).trim();
        if (data === "[DONE]") return "";
        try { return JSON.parse(data).text || ""; } catch { return ""; }
      }).join("").trim();
      return parse(text);
    } catch (serverErr) {
      if (!isAndroidApp()) return { shouldRemember: false, memories: [], reason: "classifier unavailable" };
      try {
        const key = getAndroidApiKey().trim();
        if (!key) return { shouldRemember: false, memories: [], reason: "no Android Gemini key" };
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
        return parse(text);
      } catch (androidErr) {
        console.warn("Gemini memory classifier unavailable:", serverErr, androidErr);
        return { shouldRemember: false, memories: [], reason: "classifier unavailable" };
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
