/**
 * Voice configuration for JARVIS & Ira.
 * Supports male and female Gemini Live voices.
 */

export const VOICE = "Enceladus";
export const DEFAULT_VOICE = VOICE;

export const AVAILABLE_VOICES = [
  { id: "Enceladus", name: "Enceladus (JARVIS)", description: "Calm, refined male tone" },
  { id: "Aoede", name: "Aoede (Ira)", description: "Warm, expressive female tone" },
  { id: "Kore", name: "Kore", description: "Bright female tone" },
  { id: "Puck", name: "Puck", description: "Energetic and crisp" },
  { id: "Charon", name: "Charon", description: "Deep and steady" },
  { id: "Fenrir", name: "Fenrir", description: "Authoritative and measured" },
  { id: "Zephyr", name: "Zephyr", description: "Smooth and melodic" },
] as const;

export const VOICE_CONFIG = {
  defaultVoice: VOICE,
  voices: AVAILABLE_VOICES,
} as const;
