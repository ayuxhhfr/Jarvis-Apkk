/**
 * Centralized Model configuration for JARVIS.
 * Single source of truth for all text, multimodal vision, live audio, and TTS models.
 */

export const CHAT_MODEL = "gemini-3.8-flash";
export const CHAT_MODEL_NAME = "Gemini 3.8 Flash";

// Lightweight model used only by the background long-term-memory classifier.
// Keeps the primary chat/Live models untouched while reducing memory-classification cost/quota usage.
export const MEMORY_MODEL = "gemini-2.5-flash-lite";
export const MEMORY_MODEL_NAME = "Gemini 2.5 Flash-Lite";

export const LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const LIVE_MODEL_NAME = "Gemini 3.1 Flash Live Preview";

export const TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const THINKING_LEVEL = "minimal";

export const MODEL_CONFIG = {
  chatModel: CHAT_MODEL,
  chatModelName: CHAT_MODEL_NAME,
  memoryModel: MEMORY_MODEL,
  memoryModelName: MEMORY_MODEL_NAME,
  liveModel: LIVE_MODEL,
  liveModelName: LIVE_MODEL_NAME,
  ttsModel: TTS_MODEL,
  thinkingLevel: THINKING_LEVEL,
} as const;
