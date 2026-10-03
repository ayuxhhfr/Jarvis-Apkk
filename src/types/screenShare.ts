/**
 * Types for Screen Sharing subsystem in JARVIS.
 */

export type ScreenShareState =
  | "IDLE"
  | "REQUESTING"
  | "SHARING"
  | "PAUSED"
  | "STOPPED"
  | "ERROR";

export type ScreenShareErrorType =
  | "NOT_SUPPORTED"
  | "IFRAME_RESTRICTED"
  | "USER_GESTURE_REQUIRED"
  | "PERMISSION_DENIED"
  | "SECURITY_ERROR"
  | "OVERCONSTRAINED"
  | "UNKNOWN";

export interface ScreenShareStatus {
  state: ScreenShareState;
  hasActiveStream: boolean;
  sourceLabel?: string;
  lastCapturedAt?: number;
  error?: string;
  errorType?: ScreenShareErrorType;
  isIframeRestricted?: boolean;
}

export interface ScreenFrameData {
  base64: string; // JPEG base64 without data URI prefix
  mimeType: string;
  width: number;
  height: number;
  timestamp: number;
}
