/**
 * Gemini Live API Client Service.
 * Desktop/web uses the existing JARVIS server bridge.
 * Android connects directly to Google's Live WebSocket using the API key
 * entered in JARVIS Settings, so the APK does not need a local Node server.
 */

import { LIVE_MODEL, VOICE, THINKING_LEVEL } from "../config/jarvisConfig";
import { getAndroidApiKey, isAndroidApp } from "./androidRuntime";

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
  private isConnecting = false;
  private isConnected = false;
  private lastConfig: LiveSessionConfig | null = null;
  private setupReady = false;

  private onConnectCallbacks: Array<() => void> = [];
  private onDisconnectCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private onAudioCallbacks: Array<(audioBase64: string) => void> = [];
  private onTextChunkCallbacks: Array<(text: string) => void> = [];
  private onTurnCompleteCallbacks: Array<() => void> = [];
  private onInterruptedCallbacks: Array<() => void> = [];
  private onToolCallCallbacks: Array<(toolCall: { id: string; name: string; args: Record<string, any> }) => void> = [];
  private onUserTranscriptCallbacks: Array<(data: { text: string; finished: boolean }) => void> = [];

  public get connected(): boolean {
    return this.isConnected && this.setupReady;
  }

  public get connecting(): boolean {
    return this.isConnecting;
  }

  public reconfigure(customConfig: LiveSessionConfig): void {
    this.lastConfig = customConfig;

    // Live setup is immutable for an active session. Reconnect cleanly.
    if (this.isConnected || this.isConnecting) {
      this.disconnect();
      void this.connect(customConfig);
    }
  }

  public async connect(customConfig?: LiveSessionConfig): Promise<void> {
    if (customConfig) this.lastConfig = customConfig;

    if (this.connected) {
      if (customConfig) this.reconfigure(customConfig);
      return;
    }

    if (this.isConnecting) {
      await this.waitUntilConnected();
      return;
    }

    this.isConnecting = true;
    this.setupReady = false;

    try {
      if (isAndroidApp()) {
        const apiKey = getAndroidApiKey().trim();
        if (!apiKey) {
          throw new Error("Add your Gemini API key in Settings first.");
        }

        const wsUrl =
          "wss://generativelanguage.googleapis.com/ws/" +
          "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
          "?key=" + encodeURIComponent(apiKey);

        this.ws = new WebSocket(wsUrl);
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        this.ws = new WebSocket(`${protocol}//${host}/api/live-ws`);
      }

      this.ws.onopen = () => {
        const activeConfig = customConfig || this.lastConfig;
        const model = activeConfig?.model || LIVE_MODEL;
        const voice = activeConfig?.voice || VOICE;
        const thinkingLevel = activeConfig?.thinkingLevel || THINKING_LEVEL;
        const systemInstruction = activeConfig?.systemInstruction;

        if (isAndroidApp()) {
          // Android uses the explicitly requested Gemini 3.1 Flash Live Preview.
          // Keep minimal thinking for the lowest-latency voice interaction.
          const androidModel = "gemini-3.1-flash-live-preview";
          const setup: any = {
            model: `models/${androidModel}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice,
                  },
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          };

          if (systemInstruction) {
            setup.systemInstruction = {
              parts: [{ text: systemInstruction }],
            };
          }

          this.ws?.send(JSON.stringify({ setup }));
        } else {
          this.ws?.send(
            JSON.stringify({
              type: "setup",
              model,
              voice,
              thinkingLevel,
              systemInstruction,
              greeting: activeConfig?.greeting,
            })
          );
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Android: Google's raw Live API protocol.
          if (isAndroidApp()) {
            this.handleAndroidMessage(msg);
            return;
          }

          // Desktop/web: existing JARVIS server bridge protocol.
          if (msg.type === "sessionReady") {
            console.log(
              `[GeminiLive Client] Live session confirmed ready. Active Voice: "${msg.voice}" (requested: "${msg.requestedVoice}"), Model: "${msg.model}"`
            );
            return;
          }

          if (msg.error) {
            this.emitError(String(msg.error));
            return;
          }

          if (msg.audio) this.onAudioCallbacks.forEach((cb) => cb(msg.audio));
          if (msg.text) this.onTextChunkCallbacks.forEach((cb) => cb(msg.text));
          if (msg.interrupted) this.onInterruptedCallbacks.forEach((cb) => cb());
          if (msg.turnComplete) this.onTurnCompleteCallbacks.forEach((cb) => cb());
          if (msg.toolCall) this.onToolCallCallbacks.forEach((cb) => cb(msg.toolCall));
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
        this.setupReady = false;
        this.emitError("Live session WebSocket connection failed.");
      };

      this.ws.onclose = (event) => {
        const wasConnecting = this.isConnecting && !this.setupReady;
        this.isConnected = false;
        this.isConnecting = false;
        this.setupReady = false;
        this.ws = null;

        if (wasConnecting && isAndroidApp()) {
          const detail = [event.code ? `code ${event.code}` : "", event.reason || ""]
            .filter(Boolean)
            .join(": ");
          this.emitError(
            detail
              ? `Gemini Live connection closed (${detail}).`
              : "Gemini Live connection closed before setup completed."
          );
        }

        this.onDisconnectCallbacks.forEach((cb) => cb());
      };

      await this.waitUntilConnected();
    } catch (err) {
      this.isConnecting = false;
      this.isConnected = false;
      this.setupReady = false;
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to Live session";
      this.emitError(errorMsg);
      throw err;
    }
  }

  private waitUntilConnected(timeoutMs = 15000): Promise<void> {
    if (this.connected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const started = Date.now();

      const check = () => {
        if (this.connected) {
          resolve();
          return;
        }

        if (!this.isConnecting && !this.ws) {
          reject(new Error("Live session disconnected before setup completed."));
          return;
        }

        if (Date.now() - started >= timeoutMs) {
          reject(new Error("Timed out while connecting to Gemini Live."));
          return;
        }

        window.setTimeout(check, 50);
      };

      check();
    });
  }

  private handleAndroidMessage(msg: any): void {
    if (msg.error) {
      const error = msg.error;
      const message =
        typeof error === "string"
          ? error
          : error?.message || error?.status || JSON.stringify(error);
      this.isConnecting = false;
      this.isConnected = false;
      this.setupReady = false;
      this.emitError(`Gemini Live: ${message}`);
      try {
        this.ws?.close();
      } catch {
        // Ignore close errors.
      }
      return;
    }

    if (msg.setupComplete) {
      this.setupReady = true;
      this.isConnected = true;
      this.isConnecting = false;
      this.onConnectCallbacks.forEach((cb) => cb());
      return;
    }

    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        this.onToolCallCallbacks.forEach((cb) =>
          cb({
            id: String(call.id || ""),
            name: String(call.name || ""),
            args: call.args || {},
          })
        );
      }
    }

    if (msg.toolCallCancellation) {
      return;
    }

    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) {
      this.onInterruptedCallbacks.forEach((cb) => cb());
    }

    // A single server event may contain multiple parts. Process all of them.
    for (const part of content.modelTurn?.parts || []) {
      const inlineData = part?.inlineData;
      if (inlineData?.data) {
        this.onAudioCallbacks.forEach((cb) => cb(String(inlineData.data)));
      }

      if (typeof part?.text === "string" && part.text) {
        this.onTextChunkCallbacks.forEach((cb) => cb(part.text));
      }
    }

    const inputTranscript =
      content.inputTranscription?.text ||
      content.interimInputTranscription?.text;

    if (inputTranscript) {
      this.onUserTranscriptCallbacks.forEach((cb) =>
        cb({
          text: String(inputTranscript),
          finished: !!content.inputTranscription?.text,
        })
      );
    }

    if (content.outputTranscription?.text) {
      this.onTextChunkCallbacks.forEach((cb) =>
        cb(String(content.outputTranscription.text))
      );
    }

    if (content.turnComplete) {
      this.onTurnCompleteCallbacks.forEach((cb) => cb());
    }
  }

  public sendAudio(base64Pcm: string): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (isAndroidApp()) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64Pcm,
              mimeType: "audio/pcm;rate=16000",
            },
          },
        })
      );
    } else {
      this.ws.send(JSON.stringify({ audio: base64Pcm }));
    }
  }

  public sendScreenFrame(base64Image: string, mimeType = "image/jpeg"): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (isAndroidApp()) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            video: {
              data: base64Image,
              mimeType,
            },
          },
        })
      );
    } else {
      this.ws.send(JSON.stringify({ type: "screenFrame", image: base64Image, mimeType }));
    }
  }

  public sendText(text: string): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (isAndroidApp()) {
      // Gemini 3.1 uses realtimeInput for text during an active session.
      this.ws.send(JSON.stringify({ realtimeInput: { text } }));
    } else {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }

  public sendInterrupt(): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (isAndroidApp()) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    } else {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  public sendToolResponse(id: string, name: string, response: Record<string, any>): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (isAndroidApp()) {
      this.ws.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              {
                id,
                name,
                response,
              },
            ],
          },
        })
      );
    } else {
      this.ws.send(JSON.stringify({ type: "toolResponse", id, name, response }));
    }
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors.
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.setupReady = false;
  }

  private emitError(message: string): void {
    this.onErrorCallbacks.forEach((cb) => cb(message));
  }

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
