import { Capacitor } from "@capacitor/core";
import { nativeBridge } from "./nativeBridge";

export interface MicrophonePermissionState {
  granted: boolean;
  /**
   * True only when we are confident the OS will not prompt again, i.e. the user
   * chose "Don't allow". This is the ONLY state that should tell the user to go
   * to Android Settings. Everything else is either granted or a transient /
   * unknown failure and must be reported as such.
   */
  permanentlyDenied: boolean;
}

const DENIED_SETTINGS_MESSAGE =
  "Microphone access was permanently denied. Open Android Settings › Apps › JARVIS › Permissions and enable Microphone.";

/**
 * Read the current permission state WITHOUT prompting.
 *
 * Used on mount and on every app resume so that a user who granted the
 * microphone in Android Settings sees the error cleared, instead of being told
 * they are still denied.
 */
export async function checkAndroidMicrophonePermission(): Promise<MicrophonePermissionState> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return { granted: true, permanentlyDenied: false };
  }

  try {
    const result = await nativeBridge.checkMicrophonePermission();
    if (result.granted) return { granted: true, permanentlyDenied: false };
    return { granted: false, permanentlyDenied: result.permanentlyDenied === true };
  } catch (error) {
    console.warn("[MicrophonePermission] Non-prompting check failed:", error);
    return { granted: false, permanentlyDenied: false };
  }
}

export async function requestAndroidMicrophonePermission(): Promise<MicrophonePermissionState> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return { granted: true, permanentlyDenied: false };
  }

  const current = await checkAndroidMicrophonePermission();
  if (current.granted) return current;

  try {
    const result = await nativeBridge.requestMicrophonePermission();
    if (result.granted) return { granted: true, permanentlyDenied: false };
    return { granted: false, permanentlyDenied: result.permanentlyDenied === true };
  } catch (error) {
    console.warn("[MicrophonePermission] Native permission request failed; trying WebView permission:", error);
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, permanentlyDenied: current.permanentlyDenied };
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true, permanentlyDenied: false };
  } catch (error) {
    console.warn("[MicrophonePermission] WebView microphone request failed:", error);
    const after = await checkAndroidMicrophonePermission();
    if (after.granted) return after;
    return {
      granted: false,
      permanentlyDenied: after.permanentlyDenied || current.permanentlyDenied,
    };
  }
}

export { DENIED_SETTINGS_MESSAGE };
