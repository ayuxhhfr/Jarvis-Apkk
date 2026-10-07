/**
 * Text and REST fallback service for JARVIS.
 * Handles text queries, conversation history, and voice synthesis for text mode.
 */

import { CHAT_MODEL, LIVE_MODEL, VOICE } from "../config/jarvisConfig";
import { isAndroidApp, getAndroidApiKey } from "./androidRuntime";
import { MEMORY_MODEL } from "../config/modelConfig";

export interface ChatRequestOptions {
  message: string;
  systemInstruction?: string;
  history?: Array<{ role: "user" | "model"; text: string }>;
  model?: string;
  image?: { data: string; mimeType?: string };
  images?: Array<{ data: string; mimeType?: string }>;
}
export interface StatusResponse { ok: boolean; model: string; hasKey: boolean; status: string; }
export type MemoryClassCategory = "personal" | "preference" | "project" | "instruction" | "routine" | "technical" | "other";
export interface MemoryClassification {
  shouldRemember: boolean;
  memories: Array<{ content: string; category: MemoryClassCategory; importance: number }>;
  reason?: string;
  failed?: boolean;
}
const MEMORY_CATEGORIES: MemoryClassCategory[] = ["personal","preference","project","instruction","routine","technical","other"];

function normalizeClassification(raw: string): MemoryClassification {
  const text = raw.trim().replace(/^\s*\`\`\`(?:json)?/i, "").replace(/\`\`\`\s*$/i, "").trim();
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Memory classifier returned non-JSON output");
    parsed = JSON.parse(match[0]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Memory classifier returned an invalid object.");
  if (typeof parsed.shouldRemember !== "boolean") throw new Error("Memory classifier returned an invalid shouldRemember value.");
  if (!Array.isArray(parsed.memories)) throw new Error("Memory classifier returned an invalid memories array.");
  if (parsed.reason !== undefined && typeof parsed.reason !== "string") throw new Error("Memory classifier returned an invalid reason.");

  const memories = parsed.memories.map((m: any, index: number) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`Memory classifier returned an invalid memory at index ${index}.`);
    if (typeof m.content !== "string" || !m.content.trim() || m.content.trim().length > 400) throw new Error(`Memory classifier returned invalid content at index ${index}.`);
    if (!MEMORY_CATEGORIES.includes(m.category)) throw new Error(`Memory classifier returned invalid category at index ${index}.`);
    if (!Number.isInteger(m.importance) || m.importance < 1 || m.importance > 5) throw new Error(`Memory classifier returned invalid importance at index ${index}.`);
    return { content: m.content.trim(), category: m.category as MemoryClassCategory, importance: m.importance as number };
  });
  if (!parsed.shouldRemember && memories.length > 0) throw new Error("Memory classifier returned memories while shouldRemember was false.");
  if (parsed.shouldRemember && memories.length === 0) throw new Error("Memory classifier requested remembering without any memories.");
  return { shouldRemember: parsed.shouldRemember, memories, reason: parsed.reason };
}

export class GeminiTextService {
  public async checkStatus(): Promise<StatusResponse> {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      return { ok: false, model: CHAT_MODEL, hasKey: false, status: err instanceof Error ? err.message : "Server unavailable" };
    }
  }

  public async sendTextMessageStream(options: ChatRequestOptions, onChunk: (chunk: string) => void, onToolCall?: (toolCall: { name: string; args: any }) => void): Promise<string> {
    const res = await fetch("/api/gemini/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: options.message, systemInstruction: options.systemInstruction, history: options.history || [], model: options.model || CHAT_MODEL, image: options.image, images: options.images }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }
    if (!res.body) throw new Error("No response body received from server");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error && !parsed.text) throw new Error(parsed.error);
            if (parsed.toolCall && onToolCall) onToolCall(parsed.toolCall);
            if (parsed.text) { fullText += parsed.text; onChunk(parsed.text); }
          } catch (err: any) {
            if (err?.message && !data.startsWith("{")) { fullText += data; onChunk(data); }
            else if (err?.message && data.includes('"error"')) throw err;
          }
        }
      }
    } finally { try { reader.releaseLock(); } catch {} }
    return fullText;
  }

  public async classifyMemoryCandidate(message: string, existingMemories: string[] = []): Promise<MemoryClassification> {
    const prompt = message.trim();
    if (!prompt) return { shouldRemember: false, memories: [], reason: "empty" };

    const system = `You are JARVIS's long-term memory intelligence layer.
Analyze the USER MESSAGE for information that should survive future conversations.

MEMORY SHOULD INCLUDE:
- stable identity/profile: name, age, location if explicitly stated, role, important background
- self-identification such as "I'm Void", "im Aayush", "I am a gamer", or "my name is X" is ALWAYS a durable personal memory
- preferences: likes/dislikes, communication style, UI/design preferences, favorite things
- technical profile: coding interests, languages, frameworks, tools, devices, skill areas
- projects: projects being built, repos, apps, games, goals, ongoing work
- instructions: durable rules for how the assistant should behave
- routines: recurring habits/workflows
- durable goals: long-term goals or plans

IMPORTANT: "I like coding" IS a memory and must be saved. Identity statements such as "I'm Void" or "my name is Void" MUST also be saved as personal memory. Understand natural, informal, misspelled or Hinglish phrasing; do not require exact wording. The caller provides a complete user utterance; never infer missing words.

DO NOT SAVE:
- greetings or filler
- questions with no stable user fact
- one-time commands/tasks
- temporary emotions or states
- facts about the assistant/provider
- transient details only relevant to this turn
- incomplete speech fragments with no complete durable fact

Extract EVERY distinct durable fact. If several facts are present, return several memory objects. Rewrite each as a concise third-person fact about the user. Never invent information.
If a fact is already in ALREADY STORED with the same meaning, do not return it again.
Importance: 5 = core identity/critical instruction, 4 = strong preference/project/technical profile, 3 = useful stable fact, 2 = weak preference, 1 = trivial.
Return ONLY valid JSON:
{"shouldRemember":true|false,"memories":[{"content":"...","category":"personal|preference|project|instruction|routine|technical|other","importance":1}],"reason":"..."}
If nothing durable exists, return {"shouldRemember":false,"memories":[],"reason":"..." }.`;

    const stored = existingMemories.slice(0, 40);
    const userPrompt = "USER MESSAGE:\n" + prompt + (stored.length ? "\n\nALREADY STORED:\n" + stored.map((m) => "- " + m).join("\n") : "");

    // The classifier must never depend on the (often overloaded) chat/manager model.
    // Chain: lite model -> stable 2.5 Flash. Each request has a hard timeout so a busy
    // model cannot hang memory saving.
    const CLASSIFIER_TIMEOUT_MS = 8000;
    const selectedBackgroundModel = MEMORY_MODEL;

    const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
      try { return await fetch(url, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    };

    const runAndroid = async (): Promise<MemoryClassification> => {
      const key = getAndroidApiKey().trim();
      if (!key) throw new Error("no Android Gemini key");
      let lastErr: any;
      const model = MEMORY_MODEL;
      for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetchWithTimeout("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": key },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0 },
              }),
            });
            if (!res.ok) {
              const err: any = new Error(`Direct memory classifier HTTP ${res.status} for ${model}`);
              err.status = res.status;
              throw err;
            }
            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
            return normalizeClassification(text);
          } catch (err: any) {
            lastErr = err;
            const status = Number(err?.status || 0);
            const transient = err?.name === "AbortError" || status === 429 || status === 503 || status === 500;
            if (!transient) break;
            if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
          }
      }
      throw lastErr || new Error("memory classifier unavailable");
    };

    const runServer = async (): Promise<MemoryClassification> => {
      const res = await fetchWithTimeout("/api/gemini/memory-classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userPrompt, systemInstruction: system, model: MEMORY_MODEL }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Memory classifier HTTP ${res.status}`);
      }
      return normalizeClassification(JSON.stringify(await res.json()));
    };

    try {
      return isAndroidApp() ? await runAndroid() : await runServer();
    } catch (err) {
      console.warn("[Memory] Gemini classifier failed:", err);
      return { shouldRemember: false, memories: [], reason: "classifier unavailable", failed: true };
    }
  }

  public async textToSpeech(text: string, voiceName: string = VOICE, signal?: AbortSignal): Promise<string | null> {
    try {
      const res = await fetch("/api/gemini/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: voiceName }), signal });
      if (!res.ok) return null;
      const data = await res.json();
      return data.audio || null;
    } catch (err: any) {
      if (err.name === "AbortError") console.log("TTS generation aborted");
      else console.warn("TTS generation warning:", err);
      return null;
    }
  }
}
export const geminiText = new GeminiTextService();