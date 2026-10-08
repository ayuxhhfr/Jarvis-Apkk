import { Capacitor, registerPlugin } from "@capacitor/core";
import type { MicrophonePermissionResult, NativeVoicePlugin } from "../types/nativeBridge";

const NativeVoice = registerPlugin<NativeVoicePlugin>("MyJarvisSpeech");

export const nativeBridge = {
  isAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  },

  async requestMicrophonePermission(): Promise<MicrophonePermissionResult> {
    if (!this.isAvailable()) return { granted: false };
    const result = await NativeVoice.requestMicrophonePermission();
    return { granted: result?.granted === true, permanentlyDenied: result?.permanentlyDenied === true };
  },

  async checkMicrophonePermission(): Promise<MicrophonePermissionResult> {
    if (!this.isAvailable()) return { granted: false };
    const result = await NativeVoice.checkMicrophonePermission();
    return { granted: result?.granted === true, permanentlyDenied: result?.permanentlyDenied === true };
  },

  startPcmCapture(options?: { sampleRate?: number; chunkSamples?: number }) {
    return NativeVoice.startPcmCapture(options);
  },

  stopPcmCapture() {
    return NativeVoice.stopPcmCapture();
  },

  playPcm(data: string, sampleRate = 24000) {
    if (!this.isAvailable()) return Promise.resolve();
    return NativeVoice.playPcm({ data, sampleRate });
  },

  stopPlayback() {
    if (!this.isAvailable()) return Promise.resolve();
    return NativeVoice.stopPlayback();
  },

  flushPlayback() {
    if (!this.isAvailable()) return Promise.resolve();
    return NativeVoice.flushPlayback();
  },

  startListening(options?: { language?: string }) {
    return NativeVoice.startListening(options);
  },

  stopListening() {
    return NativeVoice.stopListening();
  },

  speak(text: string) {
    return NativeVoice.speak({ text });
  },

  stopSpeaking() {
    return NativeVoice.stopSpeaking();
  },

  openApp(options: { query?: string; packageName?: string }) {
    return NativeVoice.openApp(options);
  },

  listApps() {
    return NativeVoice.listApps();
  },

  startWakeWord(wakeWord = "jarvis") {
    return NativeVoice.startWakeWord({ wakeWord });
  },

  stopWakeWord() {
    return NativeVoice.stopWakeWord();
  },

  getClipboard() {
    return NativeVoice.getClipboard();
  },

  addListener(eventName: string, listener: (event: any) => void) {
    return NativeVoice.addListener(eventName, listener);
  },
} as const;
