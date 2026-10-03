/**
 * Screen Sharing Service for JARVIS.
 * Handles native browser getDisplayMedia stream capture, frame extraction,
 * change detection, lifecycle state management, embedded iframe restriction detection,
 * and seamless integration with the Gemini Live pipeline.
 */

import {
  ScreenShareState,
  ScreenShareStatus,
  ScreenFrameData,
  ScreenShareErrorType,
} from "../types/screenShare";

export type ScreenStateListener = (status: ScreenShareStatus) => void;
export type ScreenFrameListener = (frame: ScreenFrameData) => void;

export function isRunningInIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ""
  );
}

export function getDisplayMediaFunction():
  | ((constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>)
  | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;

  if (
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
  ) {
    return navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  }

  if (typeof (navigator as any).getDisplayMedia === "function") {
    return (navigator as any).getDisplayMedia.bind(navigator);
  }

  return null;
}

class ScreenShareService {
  private state: ScreenShareState = "IDLE";
  private mediaStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private captureIntervalId: number | null = null;
  private latestFrame: ScreenFrameData | null = null;
  private lastSentHash: string | null = null;
  private lastCapturedAt: number = 0;
  private sourceLabel: string = "";
  private errorMessage: string = "";
  private errorType: ScreenShareErrorType | undefined = undefined;
  private isIframeRestricted: boolean = false;

  private stateListeners: Set<ScreenStateListener> = new Set();
  private frameListeners: Set<ScreenFrameListener> = new Set();

  // Configuration for optimal frame transmission (low bandwidth, sharp clarity)
  private readonly CAPTURE_INTERVAL_MS = 1500; // 1.5 seconds between frame checks
  private readonly MAX_DIMENSION = 1024; // Scale max dimension to 1024px for fast processing
  private readonly JPEG_QUALITY = 0.7; // 70% quality provides sharp text at ~40KB

  constructor() {}

  /**
   * Subscribe to state and status changes.
   */
  public onStateChange(listener: ScreenStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Subscribe to new captured screen frames.
   */
  public onFrame(listener: ScreenFrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  private notifyState(): void {
    const status = this.getStatus();
    this.stateListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (err) {
        console.error("ScreenShareService listener error:", err);
      }
    });
  }

  private notifyFrame(frame: ScreenFrameData): void {
    this.frameListeners.forEach((listener) => {
      try {
        listener(frame);
      } catch (err) {
        console.error("ScreenShareService frame listener error:", err);
      }
    });
  }

  public getState(): ScreenShareState {
    return this.state;
  }

  public getStatus(): ScreenShareStatus {
    return {
      state: this.state,
      hasActiveStream: !!this.mediaStream && this.mediaStream.active,
      sourceLabel: this.sourceLabel || undefined,
      lastCapturedAt: this.lastCapturedAt || undefined,
      error: this.errorMessage || undefined,
      errorType: this.errorType,
      isIframeRestricted: this.isIframeRestricted,
    };
  }

  public isSharing(): boolean {
    return this.state === "SHARING" && !!this.mediaStream && this.mediaStream.active;
  }

  public getLatestFrame(): ScreenFrameData | null {
    return this.latestFrame;
  }

  public getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  public openInNewTab(): void {
    if (typeof window !== "undefined") {
      window.open(window.location.href, "_blank");
    }
  }

  /**
   * Prompt user for screen sharing permission and initialize capture loop.
   */
  public async start(): Promise<{
    success: boolean;
    stream?: MediaStream;
    errorType?: ScreenShareErrorType;
    message?: string;
  }> {
    if (this.isSharing() && this.mediaStream) {
      return { success: true, stream: this.mediaStream, message: "Screen sharing is active." };
    }

    const getDisplayMedia = getDisplayMediaFunction();
    const inIframe = isRunningInIframe();
    const isMobile = isMobileDevice();

    if (!getDisplayMedia) {
      this.state = "ERROR";
      let explanation = "";
      if (isMobile) {
        explanation =
          "Screen sharing is not supported on mobile browsers. Please open JARVIS on a desktop browser (Chrome, Edge, Firefox, or Safari).";
        this.errorType = "NOT_SUPPORTED";
      } else if (inIframe) {
        explanation =
          "Screen capture is restricted inside this embedded preview frame. Please click 'Open in New Tab' to use screen sharing in a standalone tab.";
        this.errorType = "IFRAME_RESTRICTED";
        this.isIframeRestricted = true;
      } else {
        explanation =
          "Screen sharing is not supported by your current browser. Please use Chrome, Edge, Firefox, or Safari on desktop.";
        this.errorType = "NOT_SUPPORTED";
      }

      this.errorMessage = explanation;
      this.notifyState();
      return {
        success: false,
        errorType: this.errorType,
        message: explanation,
      };
    }

    this.state = "REQUESTING";
    this.errorMessage = "";
    this.errorType = undefined;
    this.notifyState();

    try {
      // Request native screen/window/tab media stream with the most universally compatible options
      let stream: MediaStream;
      try {
        stream = await getDisplayMedia({ video: true, audio: false });
      } catch (innerErr: any) {
        // Fallback to simple { video: true }
        if (innerErr?.name === "TypeError" || innerErr?.name === "OverconstrainedError") {
          stream = await getDisplayMedia({ video: true });
        } else {
          throw innerErr;
        }
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track received from screen share.");
      }

      this.mediaStream = stream;
      this.sourceLabel = videoTrack.label || "Screen";
      this.isIframeRestricted = false;
      this.errorMessage = "";
      this.errorType = undefined;

      // Detect native browser "Stop sharing" action
      videoTrack.addEventListener("ended", () => {
        this.handleTrackEnded();
      });

      // Prepare hidden video element for frame extraction
      if (!this.videoElement) {
        this.videoElement = document.createElement("video");
        this.videoElement.autoplay = true;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
      }
      this.videoElement.srcObject = stream;
      await this.videoElement.play().catch(() => {});

      // Prepare hidden canvas
      if (!this.canvasElement) {
        this.canvasElement = document.createElement("canvas");
      }

      this.state = "SHARING";
      this.notifyState();

      // Capture initial frame immediately
      this.captureFrame(true);

      // Start periodic frame capture loop
      this.startCaptureLoop();

      return {
        success: true,
        stream,
        message: "Screen sharing started successfully.",
      };
    } catch (err: any) {
      console.error("JARVIS ScreenShare Error:", err?.name, err?.message, err);

      const errName = err?.name || "";
      const errMsg = err?.message || "";
      const inIframe = isRunningInIframe();

      let detectedType: ScreenShareErrorType = "UNKNOWN";
      let friendlyMessage = "Failed to start screen sharing.";

      // Check if blocked by iframe permissions policy
      if (
        errMsg.toLowerCase().includes("permissions policy") ||
        errMsg.toLowerCase().includes("display-capture") ||
        (errName === "SecurityError" && inIframe)
      ) {
        detectedType = "IFRAME_RESTRICTED";
        this.isIframeRestricted = true;
        friendlyMessage =
          "Screen capture is restricted inside the embedded preview frame. Please open JARVIS in a new standalone tab to share your screen.";
        this.state = "ERROR";
      }
      // Check if transient user activation / gesture is required
      else if (
        errMsg.toLowerCase().includes("transient activation") ||
        errMsg.toLowerCase().includes("user gesture")
      ) {
        detectedType = "USER_GESTURE_REQUIRED";
        friendlyMessage =
          "Screen sharing requires a direct click. Please click the Screen Share button in the header.";
        this.state = "IDLE";
      }
      // User cancelled or denied permission in the system picker
      else if (
        errName === "NotAllowedError" ||
        errName === "AbortError" ||
        errMsg.toLowerCase().includes("permission denied")
      ) {
        detectedType = "PERMISSION_DENIED";
        friendlyMessage = "Screen sharing permission was cancelled or denied in the picker.";
        this.state = "IDLE";
      }
      // Source not found / not supported
      else if (errName === "NotFoundError") {
        detectedType = "NOT_SUPPORTED";
        friendlyMessage = "No screen video source found.";
        this.state = "ERROR";
      } else {
        detectedType = "UNKNOWN";
        friendlyMessage = errMsg || "Screen sharing failed.";
        this.state = "ERROR";
      }

      this.errorMessage = friendlyMessage;
      this.errorType = detectedType;

      this.cleanup();
      this.notifyState();

      return {
        success: false,
        errorType: detectedType,
        message: friendlyMessage,
      };
    }
  }

  /**
   * Stop screen sharing and release all media resources.
   */
  public stop(): void {
    if (this.state === "IDLE" && !this.mediaStream) {
      return;
    }

    this.state = "STOPPED";
    this.cleanup();
    this.notifyState();

    // Reset to IDLE
    setTimeout(() => {
      if (this.state === "STOPPED") {
        this.state = "IDLE";
        this.notifyState();
      }
    }, 300);
  }

  private handleTrackEnded(): void {
    this.state = "STOPPED";
    this.cleanup();
    this.notifyState();

    setTimeout(() => {
      if (this.state === "STOPPED") {
        this.state = "IDLE";
        this.notifyState();
      }
    }, 300);
  }

  private cleanup(): void {
    if (this.captureIntervalId !== null) {
      window.clearInterval(this.captureIntervalId);
      this.captureIntervalId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.mediaStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    this.latestFrame = null;
    this.lastSentHash = null;
    this.sourceLabel = "";
  }

  private startCaptureLoop(): void {
    if (this.captureIntervalId !== null) {
      window.clearInterval(this.captureIntervalId);
    }

    this.captureIntervalId = window.setInterval(() => {
      if (this.isSharing()) {
        this.captureFrame(false);
      }
    }, this.CAPTURE_INTERVAL_MS);
  }

  /**
   * Capture single frame from the video stream onto canvas and encode to JPEG base64.
   */
  public captureFrame(force: boolean = false): ScreenFrameData | null {
    if (!this.videoElement || !this.canvasElement || !this.mediaStream || !this.mediaStream.active) {
      return null;
    }

    const video = this.videoElement;
    const canvas = this.canvasElement;

    const naturalWidth = video.videoWidth;
    const naturalHeight = video.videoHeight;

    if (naturalWidth === 0 || naturalHeight === 0) {
      return null;
    }

    // Scale dimensions keeping aspect ratio
    let width = naturalWidth;
    let height = naturalHeight;

    if (width > this.MAX_DIMENSION || height > this.MAX_DIMENSION) {
      if (width > height) {
        height = Math.round((height * this.MAX_DIMENSION) / width);
        width = this.MAX_DIMENSION;
      } else {
        width = Math.round((width * this.MAX_DIMENSION) / height);
        height = this.MAX_DIMENSION;
      }
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    try {
      ctx.drawImage(video, 0, 0, width, height);

      // Extract JPEG data URL
      const dataUrl = canvas.toDataURL("image/jpeg", this.JPEG_QUALITY);
      const base64Data = dataUrl.split(",")[1];

      if (!base64Data) return null;

      // Lightweight frame difference check: sample middle slice length
      const frameHash = base64Data.slice(100, 300) + base64Data.length;

      if (!force && this.lastSentHash === frameHash) {
        // Frame is visually identical to previous one, skip redundant network push
        return this.latestFrame;
      }

      this.lastSentHash = frameHash;
      this.lastCapturedAt = Date.now();

      const frameData: ScreenFrameData = {
        base64: base64Data,
        mimeType: "image/jpeg",
        width,
        height,
        timestamp: this.lastCapturedAt,
      };

      this.latestFrame = frameData;
      this.notifyFrame(frameData);
      return frameData;
    } catch (err) {
      console.warn("Frame capture error:", err);
      return null;
    }
  }

  /**
   * Parse natural speech / text queries for screen sharing intent.
   */
  public parseScreenShareIntent(rawText: string): {
    type: "start" | "stop" | "query" | "inspect";
    target?: string;
  } | null {
    const text = rawText.trim().toLowerCase();

    // 1. Stop screen share
    if (
      /^(?:please\s+)?(?:stop\s+sharing(?:\s+my)?\s+screen|stop\s+screen\s+sharing|stop\s+screen\s+share|stop\s+looking\s+at(?:\s+my)?\s+screen|close\s+screen\s+share|end\s+screen\s+share)/i.test(
        text
      ) ||
      text === "stop sharing" ||
      text === "stop looking"
    ) {
      return { type: "stop" };
    }

    // 2. Start screen share
    if (
      /^(?:please\s+)?(?:share\s+(?:my\s+)?screen|start\s+screen\s+sharing|start\s+sharing(?:\s+my)?\s+screen|start\s+screen\s+share|look\s+at\s+my\s+screen|can\s+you\s+see\s+my\s+screen|let's\s+share\s+screen)/i.test(
        text
      )
    ) {
      return { type: "start" };
    }

    // 3. Screen inspection / query commands
    if (
      /(?:what(?:'s|\s+is)\s+(?:on|in)\s+my\s+screen|what\s+do\s+you\s+see|read\s+(?:the\s+)?(?:code|text|screen|error)|where\s+is\s+the\s+error|look\s+at\s+this|what\s+is\s+this\s+error|explain\s+what\s+you\s+see|check\s+(?:my\s+)?screen)/i.test(
        text
      )
    ) {
      return { type: "query" };
    }

    return null;
  }
}

export const screenShareService = new ScreenShareService();
