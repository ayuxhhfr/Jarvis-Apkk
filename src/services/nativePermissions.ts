import { Capacitor, registerPlugin } from "@capacitor/core";

interface MyJarvisSpeechPlugin {
  requestMicrophonePermission(): Promise<{ granted: boolean }>;
}

const NativeSpeech = registerPlugin<MyJarvisSpeechPlugin>("MyJarvisSpeech");

export async function requestAndroidMicrophonePermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return true;
  }

  try {
    const result = await NativeSpeech.requestMicrophonePermission();
    if (result?.granted === true) return true;
  } catch (error) {
    console.warn("[MicrophonePermission] Native permission request failed; trying WebView permission:", error);
  }

  // Some Capacitor/WebView combinations can have the Android runtime grant
  // available before the plugin bridge reports it. Fall back to the WebView
  // media permission path so getUserMedia() is not left in a stale-denied state.
  try {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    console.warn("[MicrophonePermission] WebView microphone request failed:", error);
    return false;
  }
}
