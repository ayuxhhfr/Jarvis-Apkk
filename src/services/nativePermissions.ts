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
    return result?.granted === true;
  } catch (error) {
    console.warn("[MicrophonePermission] Native permission request failed:", error);
    return false;
  }
}
