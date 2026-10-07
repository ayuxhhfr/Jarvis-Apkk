export type NativeVoiceState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "INTERRUPTED" | "ERROR";

export interface NativeAudioState {
  active: boolean;
  sampleRate?: number;
  outputSampleRate?: number;
}

export interface NativeVoiceError {
  message: string;
  code?: string | number;
}

export interface NativeSpeechActivity {
  speech: boolean;
  rms: number;
  threshold?: number;
}

export interface NativeBridgeEvents {
  "voice:state": { state: string };
  "voice:transcript": { text: string; finished?: boolean };
  "voice:error": NativeVoiceError;
  "audio:chunk": { data: string; rms?: number; speech?: boolean };
  "audio:activity": NativeSpeechActivity;
  "audio:ready": { sampleRate: number; chunkMs: number };
  "audio:error": NativeVoiceError;
  "native:permission": { granted: boolean };
  "native:wake": { text: string; wakeWord: string };
  "native:wakeError": NativeVoiceError;
}

export interface NativeVoicePlugin {
  requestMicrophonePermission(): Promise<{ granted: boolean }>;
  startPcmCapture(options?: { sampleRate?: number; chunkSamples?: number }): Promise<void>;
  stopPcmCapture(): Promise<void>;
  playPcm(options: { data: string; sampleRate?: number }): Promise<void>;
  stopPlayback(): Promise<void>;
  startListening(options?: { language?: string }): Promise<void>;
  stopListening(): Promise<void>;
  speak(options: { text: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  openApp(options: { query?: string; packageName?: string }): Promise<{ opened: boolean; packageName?: string }>;
  listApps(): Promise<{ apps: Array<{ name: string; packageName: string }> }>;
  startWakeWord(options?: { wakeWord?: string }): Promise<void>;
  stopWakeWord(): Promise<void>;
  getClipboard(): Promise<{ text: string }>;
  addListener(eventName: string, listener: (event: any) => void): Promise<{ remove: () => Promise<void> }>;
}
