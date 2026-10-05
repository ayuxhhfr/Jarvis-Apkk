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
  /** When true, Live is used only as realtime voice I/O. */
  voiceOnly?: boolean;
}

export type LiveEventCallback<T> = (data: T) => void;

export class GeminiLiveService {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private isConnected = false;
  private lastConfig: LiveSessionConfig | null = null;
  private setupReady = false;
  private handshakeTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private reconnectPending = false;
  private intentionalDisconnect = false;
  private sessionResumptionHandle: string | null = null;
  private voiceOnly = true;
  private voiceOutputActive = false;

  private onConnectCallbacks: Array<() => void> = [];
  private onDisconnectCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private onAudioCallbacks: Array<(audioBase64: string) => void> = [];
  private onTextChunkCallbacks: Array<(text: string) => void> = [];
  private onTurnCompleteCallbacks: Array<() => void> = [];
  private onInterruptedCallbacks: Array<() => void> = [];
  private onToolCallCallbacks: Array<(toolCall: { id: string; name: string; args: Record<string, any> }) => void> = [];
  private onUserTranscriptCallbacks: Array<(data: { text: string; finished: boolean }) => void> = [];
  // Gemini Live input transcription arrives as small fragments. Keep those
  // fragments together and only expose a completed utterance to the assistant.
  private userTranscriptBuffer = "";
  private userTranscriptFlushTimer: number | null = null;

  private queueUserTranscript(text: string, finished = false): void {
    const chunk = String(text || "");
    if (!chunk.trim()) return;

    // Gemini can send either deltas (" like", " coding") or cumulative text
    // ("i", "i like", "i like coding"). Handle both without duplicating text.
    if (!this.userTranscriptBuffer) {
      this.userTranscriptBuffer = chunk;
    } else if (chunk.startsWith(this.userTranscriptBuffer)) {
      this.userTranscriptBuffer = chunk;
    } else {
      this.userTranscriptBuffer += chunk;
    }

    if (this.userTranscriptFlushTimer !== null) {
      window.clearTimeout(this.userTranscriptFlushTimer);
      this.userTranscriptFlushTimer = null;
    }

    if (finished) {
      this.flushUserTranscript();
    } else {
      // Safety finalization for sessions where the API does not expose a
      // per-transcript finished flag. Normal turnComplete/model output also
      // flushes this buffer immediately.
      this.userTranscriptFlushTimer = window.setTimeout(() => {
        this.userTranscriptFlushTimer = null;
        this.flushUserTranscript();
      }, 1800);
    }
  }

  private flushUserTranscript(): void {
    if (this.userTranscriptFlushTimer !== null) {
      window.clearTimeout(this.userTranscriptFlushTimer);
      this.userTranscriptFlushTimer = null;
    }

    const text = this.userTranscriptBuffer.trim();
    this.userTranscriptBuffer = "";
    if (!text) return;

    this.onUserTranscriptCallbacks.forEach((cb) => cb({ text, finished: true }));
  }

  private clearUserTranscriptBuffer(): void {
    if (this.userTranscriptFlushTimer !== null) {
      window.clearTimeout(this.userTranscriptFlushTimer);
      this.userTranscriptFlushTimer = null;
    }
    this.userTranscriptBuffer = "";
  }

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
    this.reconnectPending = false;
    this.intentionalDisconnect = false;

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
        // Fail fast on Android: a TCP/TLS WebSocket can open without the
        // Gemini Live session actually completing its setup handshake.
        this.handshakeTimer = window.setTimeout(() => {
          if (!this.setupReady && this.isConnecting) {
            const state = this.ws?.readyState;
            console.error("[GeminiLive Android] setupComplete not received within 5s", {
              readyState: state,
              model: "gemini-3.1-flash-live-preview",
            });
            this.emitError(
              "Gemini Live handshake timed out after 5s. WebSocket opened, but Google did not return setupComplete."
            );
            try { this.ws?.close(1000, "Live setup handshake timeout"); } catch {}
          }
        }, 5000);
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        this.ws = new WebSocket(`${protocol}//${host}/api/live-ws`);
      }

      this.ws.onopen = () => {
        console.log("[GeminiLive] WebSocket opened", { android: isAndroidApp() });
        const activeConfig = customConfig || this.lastConfig;
        const model = activeConfig?.model || LIVE_MODEL;
        const voice = activeConfig?.voice || VOICE;
        const thinkingLevel = activeConfig?.thinkingLevel || THINKING_LEVEL;
        const systemInstruction = activeConfig?.systemInstruction;
        this.voiceOnly = activeConfig?.voiceOnly !== false;
        this.voiceOutputActive = false;

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
            // Keep Live sessions resumable when Google rotates the WebSocket.
            sessionResumption: this.sessionResumptionHandle
              ? { handle: this.sessionResumptionHandle }
              : {},
          };

          if (systemInstruction) {
            setup.systemInstruction = {
              parts: [{ text: systemInstruction }],
            };
          }

          console.log("[GeminiLive Android] Sending Live setup", { model: setup.model, voice });
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

      this.ws.onmessage = async (event) => {
        try {
          // Android WebView normally delivers text frames as strings, but
          // tolerate Blob/ArrayBuffer frames so a valid setupComplete cannot
          // be silently lost on a device-specific WebView implementation.
          let raw = event.data;
          if (raw instanceof Blob) raw = await raw.text();
          if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
          const msg = JSON.parse(String(raw));

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
          // Voice-only sessions already render the authoritative brain response
          // from managerService; never mirror Live output text into chat.
          if (msg.text && !this.voiceOnly) this.onTextChunkCallbacks.forEach((cb) => cb(msg.text));
          if (msg.interrupted) this.onInterruptedCallbacks.forEach((cb) => cb());
          if (msg.turnComplete && !this.voiceOnly) this.onTurnCompleteCallbacks.forEach((cb) => cb());
          if (msg.toolCall && !this.voiceOnly) this.onToolCallCallbacks.forEach((cb) => cb(msg.toolCall));
          if (msg.userTranscript) {
            this.queueUserTranscript(String(msg.userTranscript), msg.finished === true);
          }
          if (msg.turnComplete) {
            this.flushUserTranscript();
            if (this.voiceOutputActive) {
              this.voiceOutputActive = false;
              this.onTurnCompleteCallbacks.forEach((cb) => cb());
            }
          }
        } catch (err) {
          console.error("Failed to parse Gemini Live message:", err);
        }
      };

      this.ws.onerror = () => {
        console.error("[GeminiLive] WebSocket error");
        // onclose contains the useful close code/reason and owns reconnect/error handling.
      };

      this.ws.onclose = (event) => {
        const wasConnecting = this.isConnecting && !this.setupReady;
        const wasConnected = this.isConnected && this.setupReady;

        this.isConnected = false;
        this.setupReady = false;
        this.ws = null;

        if (this.handshakeTimer !== null) {
          window.clearTimeout(this.handshakeTimer);
          this.handshakeTimer = null;
        }

        if (isAndroidApp() && !this.intentionalDisconnect) {
          const detail = [event.code ? `code ${event.code}` : "", event.reason || ""]
            .filter(Boolean)
            .join(": ");

          // Transient Live disconnects should recover silently instead of
          // freezing the UI or immediately showing a scary error banner.
          if (this.reconnectAttempts < 2) {
            this.reconnectAttempts += 1;
            this.reconnectPending = true;
            this.isConnecting = false;
            const delay = this.reconnectAttempts === 1 ? 250 : 750;
            console.warn("[GeminiLive Android] reconnecting after disconnect", {
              attempt: this.reconnectAttempts,
              delay,
              detail,
              wasConnecting,
              wasConnected,
            });
            this.reconnectTimer = window.setTimeout(() => {
              this.reconnectTimer = null;
              if (!this.reconnectPending || this.intentionalDisconnect) return;
              this.reconnectPending = false;
              void this.connect(this.lastConfig || undefined).catch(() => {});
            }, delay);
          } else {
            this.isConnecting = false;
            this.reconnectPending = false;
            this.emitError(
              detail
                ? `Gemini Live disconnected (${detail}). Retried automatically.`
                : "Gemini Live disconnected. Retried automatically."
            );
          }
        } else {
          this.isConnecting = false;
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

        if (!this.isConnecting && !this.ws && !this.reconnectPending) {
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
      // Let onclose perform the retry policy. Keep the diagnostic visible in logs,
      // but don't turn a transient server error into a stuck UI state.
      console.error("[GeminiLive Android] Server error:", message);
      try {
        this.ws?.close();
      } catch {
        // Ignore close errors.
      }
      return;
    }

    if (msg.sessionResumptionUpdate) {
      const update = msg.sessionResumptionUpdate;
      if (update?.resumable && update?.newHandle) {
        this.sessionResumptionHandle = String(update.newHandle);
        console.log("[GeminiLive Android] Session resumption handle updated");
      }
      return;
    }

    if (msg.goAway) {
      console.log("[GeminiLive Android] Google requested reconnect", msg.goAway);
      return;
    }

    if (msg.setupComplete) {
      if (this.handshakeTimer !== null) {
        window.clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
      }
      console.log("[GeminiLive Android] setupComplete received");
      this.setupReady = true;
      this.isConnected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.reconnectPending = false;
      this.onConnectCallbacks.forEach((cb) => cb());
      return;
    }

    if (!this.voiceOnly && msg.toolCall?.functionCalls) {
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
      this.voiceOutputActive = false;
      this.onInterruptedCallbacks.forEach((cb) => cb());
    }

    // A single server event may contain multiple parts. Process all of them.
    for (const part of content.modelTurn?.parts || []) {
      const inlineData = part?.inlineData;
      if (inlineData?.data && this.voiceOutputActive) {
        this.onAudioCallbacks.forEach((cb) => cb(String(inlineData.data)));
      }

      if (typeof part?.text === "string" && part.text && this.voiceOutputActive && !this.voiceOnly) {
        this.onTextChunkCallbacks.forEach((cb) => cb(part.text));
      }
    }

    const inputTranscript =
      content.inputTranscription?.text ||
      content.interimInputTranscription?.text;

    if (inputTranscript) {
      this.queueUserTranscript(
        String(inputTranscript),
        content.inputTranscription?.finished === true
      );
    }

    if (content.outputTranscription?.text && this.voiceOutputActive && !this.voiceOnly) {
      this.onTextChunkCallbacks.forEach((cb) =>
        cb(String(content.outputTranscription.text))
      );
    }

    if (content.modelTurn?.parts?.length) {
      // Model output means the user's turn has ended even if the transcript
      // event itself did not carry a finished flag.
      this.flushUserTranscript();
    }

    if (content.turnComplete) {
      this.flushUserTranscript();
      if (this.voiceOutputActive) {
        this.voiceOutputActive = false;
        this.onTurnCompleteCallbacks.forEach((cb) => cb());
      }
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
      this.ws.send(JSON.stringify({ realtimeInput: { text } }));
    } else {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }

  /** Speak only the manager's final answer through Gemini Live. */
  public speakText(text: string): void {
    if (!text.trim() || !this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.voiceOutputActive = true;
    if (isAndroidApp()) {
      this.ws.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: "user",
            parts: [{ text: `[VOICE OUTPUT ONLY] Speak the following final JARVIS manager response exactly as written. Do not add, remove, reinterpret, answer, or call any tool. Response: ${text}` }],
          }],
          turnComplete: true,
        },
      }));
    } else {
      this.ws.send(JSON.stringify({ type: "speak", text }));
    }
  }

  public sendInterrupt(): void {
    this.voiceOutputActive = false;
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
    this.intentionalDisconnect = true;
    this.voiceOutputActive = false;
    this.clearUserTranscriptBuffer();
    this.reconnectPending = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

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
    this.voiceOutputActive = false;
    this.setupReady = false;
    if (this.handshakeTimer !== null) {
      window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
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
