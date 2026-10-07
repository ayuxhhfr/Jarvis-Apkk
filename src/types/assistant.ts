/**
 * Core assistant state and connection types for JARVIS & Ira.
 */

export type AssistantState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export type ConnectionStatus =
  | "online"
  | "connecting"
  | "disconnected"
  | "error";

export interface AssistantSettings {
  assistantName: string;
  liveModel: string;
  voice: string;
  thinkingLevel: "minimal" | "low" | "high";
  voiceEnabled: boolean;
  systemInstruction: string;
  selectedProfileId?: string;
  /** Authoritative text/reasoning model. Defaults to Gemini 3.5 Flash. */
  brainModel?: string;
  /** Background model routing preference. Auto keeps memory/background tasks on their dedicated model. */
  backgroundModel?: string;
  /** Whether Android background voice mode is enabled. */
  backgroundVoiceMode?: boolean;
}

export interface AudioVisualizerData {
  micLevel: number;
  outputLevel: number;
  isSpeaking: boolean;
  isListening: boolean;
}
