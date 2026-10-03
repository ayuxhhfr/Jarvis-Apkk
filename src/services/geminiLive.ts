/**
 * Gemini Live API Client Service.
 * Isolates WebSocket session communication with the Gemini Live API backend.
 * Streams real-time audio and progressive text transcripts.
 */

import { LIVE_MODEL, VOICE, THINKING_LEVEL } from "../config/jarvisConfig";

export interface LiveSessionConfig {
  model?: string;
  voice?: string;
  thinkingLevel?: string;
  systemInstruction?: string;
  greeting?: string;
}

export type LiveEventCallback<T> = (data: T) => void;

export class GeminiLiveService {
  private ws: WebSocket | null = null;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private reconnectTimeout: number | null = null;
  private lastConfig: LiveSessionConfig | null = null;

  // Callbacks
  private onConnectCallbacks: Array<() => void> = [];
  private onDisconnectCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private onAudioCallbacks: Array<(audioBase64: string) => void> = [];
  private onTextChunkCallbacks: Array<(text: string) => void> = [];
  private onTurnCompleteCallbacks: Array<() => void> = [];
  private onInterruptedCallbacks: Array<() => void> = [];
  private onToolCallCallbacks: Array<(toolCall: { id: string; name: string; args: Record<string, any> }) => void> = [];
  private onUserTranscriptCallbacks: Array<(data: { text: string; finished: boolean }) => void> = [];

  constructor() {}

  public get connected(): boolean {
    return this.isConnected;
  }

  public get connecting(): boolean {
    return this.isConnecting;
  }

  /**
   * Send re-configuration payload to existing WebSocket session.
   */
  public reconfigure(customConfig: LiveSessionConfig): void {
    this.lastConfig = customConfig;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const setupPayload = {
        type: "setup",
        model: customConfig.model || LIVE_MODEL,
        voice: customConfig.voice || VOICE,
        thinkingLevel: customConfig.thinkingLevel || THINKING_LEVEL,
        systemInstruction: customConfig.systemInstruction,
        greeting: customConfig.greeting,
      };
      this.ws.send(JSON.stringify(setupPayload));
    }
  }

  /**
   * Connect to the Gemini Live session.
   */
  public async connect(customConfig?: LiveSessionConfig): Promise<void> {
    if (customConfig) {
      this.lastConfig = customConfig;
    }

    if (this.isConnected || this.isConnecting) {
      if (customConfig) {
        this.reconfigure(customConfig);
      }
      return;
    }

    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/live-ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;

        const activeConfig = customConfig || this.lastConfig;

        // Send initial session setup message
        const setupPayload = {
          type: "setup",
          model: activeConfig?.model || LIVE_MODEL,
          voice: activeConfig?.voice || VOICE,
          thinkingLevel: activeConfig?.thinkingLevel || THINKING_LEVEL,
          systemInstruction: activeConfig?.systemInstruction,
          greeting: activeConfig?.greeting,
        };
        this.ws?.send(JSON.stringify(setupPayload));

        this.onConnectCallbacks.forEach((cb) => cb());
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "sessionReady") {
            console.log(
              `[GeminiLive Client] Live session confirmed ready. Active Voice: "${msg.voice}" (requested: "${msg.requestedVoice}"), Model: "${msg.model}"`
            );
            return;
          }

          if (msg.error) {
            this.onErrorCallbacks.forEach((cb) => cb(msg.error));
            return;
          }

          if (msg.audio) {
            this.onAudioCallbacks.forEach((cb) => cb(msg.audio));
          }

          if (msg.text) {
            this.onTextChunkCallbacks.forEach((cb) => cb(msg.text));
          }

          if (msg.interrupted) {
            this.onInterruptedCallbacks.forEach((cb) => cb());
          }

          if (msg.turnComplete) {
            this.onTurnCompleteCallbacks.forEach((cb) => cb());
          }

          if (msg.toolCall) {
            this.onToolCallCallbacks.forEach((cb) => cb(msg.toolCall));
          }

          if (msg.userTranscript) {
            this.onUserTranscriptCallbacks.forEach((cb) =>
              cb({ text: msg.userTranscript, finished: !!msg.finished })
            );
          }
        } catch (err) {
          console.error("Failed to parse Gemini Live message:", err);
        }
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this.onErrorCallbacks.forEach((cb) => cb("Live session WebSocket connection interrupted. Retrying..."));
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.onDisconnectCallbacks.forEach((cb) => cb());
      };
    } catch (err) {
      this.isConnecting = false;
      this.isConnected = false;
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to Live session";
      this.onErrorCallbacks.forEach((cb) => cb(errorMsg));
    }
  }

  /**
   * Send microphone PCM audio chunk (16kHz base64).
   */
  public sendAudio(base64Pcm: string): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ audio: base64Pcm }));
  }

  /**
   * Send screen frame image chunk (JPEG base64) to the Live session.
   */
  public sendScreenFrame(base64Image: string, mimeType: string = "image/jpeg"): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: "screenFrame", image: base64Image, mimeType }));
  }

  /**
   * Send a text message turn to the live session.
   */
  public sendText(text: string): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: "text", text }));
  }

  /**
   * Send interruption signal to cancel current model generation on server.
   */
  public sendInterrupt(): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: "interrupt" }));
  }

  /**
   * Send tool execution result back to Gemini Live session.
   */
  public sendToolResponse(id: string, name: string, response: Record<string, any>): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: "toolResponse", id, name, response }));
  }

  /**
   * Disconnect the Live session.
   */
  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
  }

  // --- Subscriptions ---

  public onConnect(callback: () => void): () => void {
    this.onConnectCallbacks.push(callback);
    return () => {
      this.onConnectCallbacks = this.onConnectCallbacks.filter((c) => c !== callback);
    };
  }

  public onDisconnect(callback: () => void): () => void {
    this.onDisconnectCallbacks.push(callback);
    return () => {
      this.onDisconnectCallbacks = this.onDisconnectCallbacks.filter((c) => c !== callback);
    };
  }

  public onError(callback: (error: string) => void): () => void {
    this.onErrorCallbacks.push(callback);
    return () => {
      this.onErrorCallbacks = this.onErrorCallbacks.filter((c) => c !== callback);
    };
  }

  public onAudio(callback: (audioBase64: string) => void): () => void {
    this.onAudioCallbacks.push(callback);
    return () => {
      this.onAudioCallbacks = this.onAudioCallbacks.filter((c) => c !== callback);
    };
  }

  public onTextChunk(callback: (text: string) => void): () => void {
    this.onTextChunkCallbacks.push(callback);
    return () => {
      this.onTextChunkCallbacks = this.onTextChunkCallbacks.filter((c) => c !== callback);
    };
  }

  public onTurnComplete(callback: () => void): () => void {
    this.onTurnCompleteCallbacks.push(callback);
    return () => {
      this.onTurnCompleteCallbacks = this.onTurnCompleteCallbacks.filter((c) => c !== callback);
    };
  }

  public onInterrupted(callback: () => void): () => void {
    this.onInterruptedCallbacks.push(callback);
    return () => {
      this.onInterruptedCallbacks = this.onInterruptedCallbacks.filter((c) => c !== callback);
    };
  }

  public onToolCall(
    callback: (toolCall: { id: string; name: string; args: Record<string, any> }) => void
  ): () => void {
    this.onToolCallCallbacks.push(callback);
    return () => {
      this.onToolCallCallbacks = this.onToolCallCallbacks.filter((c) => c !== callback);
    };
  }

  public onUserTranscript(
    callback: (data: { text: string; finished: boolean }) => void
  ): () => void {
    this.onUserTranscriptCallbacks.push(callback);
    return () => {
      this.onUserTranscriptCallbacks = this.onUserTranscriptCallbacks.filter((c) => c !== callback);
    };
  }
}

export const geminiLive = new GeminiLiveService();
