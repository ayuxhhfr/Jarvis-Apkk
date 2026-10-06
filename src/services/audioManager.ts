/** 
 * Audio Manager service for JARVIS.
 * Handles microphone capture (16kHz PCM), output playback (24kHz PCM),
 * audio visualization amplitude analysis, gapless streaming playback,
 * and click-free speech interruption/cleanup.
 */

export interface AudioVisualizerLevels {
  micLevel: number;
  outputLevel: number;
}

export type AudioChunkCallback = (base64Pcm: string) => void;
export type InterruptCallback = () => void;

export class AudioManager {
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private outputAnalyserData: Uint8Array | null = null;
  private masterGain: GainNode | null = null;

  private activeSources: AudioBufferSourceNode[] = [];
  private nextPlayTime: number = 0;
  private streamPrimed: boolean = false;
  private streamIdleTimer: number | null = null;

  // A modest startup jitter cushion absorbs normal mobile WebView/network
  // bursts. The stream stays primed across tiny source gaps so it does not
  // repeatedly add another startup delay in the middle of a sentence.
  private readonly STREAM_START_BUFFER_SECONDS = 0.035;
  private readonly STREAM_SAFETY_LEAD_SECONDS = 0.006;
  private readonly STREAM_IDLE_RESET_MS = 80;

  private isAssistantSpeaking: boolean = false;

  private onAudioChunk: AudioChunkCallback | null = null;
  private onInterrupt: InterruptCallback | null = null;

  private micLevel: number = 0;
  private outputLevel: number = 0;
  private animFrameId: number | null = null;


  // Pending audio queue if browser blocks automatic playback before user gesture
  private pendingStartupAudio: { base64Data: string; onEnd?: () => void } | null = null;
  private hasRegisteredAutoplayResume: boolean = false;

  constructor() {
    this.startLevelLoop();
  }

  public setOnAudioChunk(callback: AudioChunkCallback) {
    this.onAudioChunk = callback;
  }

  public setOnInterrupt(callback: InterruptCallback) {
    this.onInterrupt = callback;
  }

  public setAssistantSpeaking(speaking: boolean) {
    this.isAssistantSpeaking = speaking;
    // Playback interruption is intentionally not driven by local RMS.
    // Speaker echo can otherwise kill a valid Gemini Live response.
  }

  public async startMicrophone(): Promise<void> {
    if (this.mediaStream) {
      return;
    }

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.inputAudioCtx = new AudioCtxClass({ sampleRate: 16000, latencyHint: "interactive" });
      if (this.inputAudioCtx.state === "suspended") {
        await this.inputAudioCtx.resume();
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const source = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);

      this.micAnalyser = this.inputAudioCtx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      this.micAnalyser.smoothingTimeConstant = 0.4;
      source.connect(this.micAnalyser);

      // 512 samples at 16kHz = 32ms, inside Gemini Live's recommended
      // 20–40ms realtime input chunk range.
      this.scriptProcessor = this.inputAudioCtx.createScriptProcessor(512, 1, 1);
      this.scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        this.micLevel = Math.min(1, rms * 5);

        // Never stop playback from local RMS. Android speaker leakage is
        // not reliable enough to distinguish echo from real barge-in.
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const base64 = this.pcm16ToBase64(pcm16);
        if (this.onAudioChunk) {
          this.onAudioChunk(base64);
        }
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioCtx.destination);
    } catch (err) {
      this.stopMicrophone();
      throw err;
    }
  }

  public stopMicrophone(): void {
    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {
        // ignore
      }
      this.scriptProcessor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch {
        // ignore
      }
      this.inputAudioCtx = null;
    }

    this.micAnalyser = null;
    this.micLevel = 0;
  }

  private ensureOutputContext(): AudioContext {
    if (!this.outputAudioCtx || this.outputAudioCtx.state === "closed") {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      // Explicitly request interactive latency for voice instead of the
      // higher-latency playback profile.
      this.outputAudioCtx = new AudioCtxClass({
        sampleRate: 24000,
        latencyHint: "interactive",
      });

      this.masterGain = this.outputAudioCtx.createGain();
      this.masterGain.gain.setValueAtTime(1.0, this.outputAudioCtx.currentTime);

      this.outputAnalyser = this.outputAudioCtx.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.5;
      this.outputAnalyserData = new Uint8Array(this.outputAnalyser.frequencyBinCount);

      this.masterGain.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.outputAudioCtx.destination);
    }

    if (this.outputAudioCtx.state === "suspended") {
      this.outputAudioCtx.resume().catch(() => {});
    }

    return this.outputAudioCtx;
  }

  public playAudioChunk(base64Data: string, onEnd?: () => void): void {
    if (!base64Data || typeof base64Data !== "string") {
      if (onEnd) onEnd();
      return;
    }

    try {
      const ctx = this.ensureOutputContext();

      if (this.streamIdleTimer !== null) {
        window.clearTimeout(this.streamIdleTimer);
        this.streamIdleTimer = null;
      }

      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
        if (ctx.state === "suspended") {
          this.pendingStartupAudio = { base64Data, onEnd };
          if (!this.hasRegisteredAutoplayResume && typeof window !== "undefined") {
            this.hasRegisteredAutoplayResume = true;
            const resumeAndPlay = () => {
              this.outputAudioCtx?.resume().then(() => {
                if (this.pendingStartupAudio) {
                  const pending = this.pendingStartupAudio;
                  this.pendingStartupAudio = null;
                  this.playAudioChunk(pending.base64Data, pending.onEnd);
                }
              });
            };
            window.addEventListener("pointerdown", resumeAndPlay, { once: true });
            window.addEventListener("keydown", resumeAndPlay, { once: true });
            window.addEventListener("click", resumeAndPlay, { once: true });
          }
          return;
        }
      }

      const float32 = this.base64ToFloat32Pcm(base64Data);
      if (!float32 || float32.length === 0) {
        if (onEnd) onEnd();
        return;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      if (this.masterGain) {
        source.connect(this.masterGain);
      } else if (this.outputAnalyser) {
        source.connect(this.outputAnalyser);
      } else {
        source.connect(ctx.destination);
      }

      const currentTime = ctx.currentTime;
      let startTime = Math.max(currentTime, this.nextPlayTime);

      if (!this.streamPrimed) {
        startTime = Math.max(startTime, currentTime + this.STREAM_START_BUFFER_SECONDS);
        this.streamPrimed = true;
      } else if (startTime < currentTime + this.STREAM_SAFETY_LEAD_SECONDS) {
        startTime = currentTime + this.STREAM_SAFETY_LEAD_SECONDS;
      }

      source.start(startTime);
      this.nextPlayTime = startTime + buffer.duration;
      this.activeSources.push(source);

      source.onended = () => {
        try {
          source.disconnect();
        } catch {
          // ignore
        }

        const index = this.activeSources.indexOf(source);
        if (index > -1) {
          this.activeSources.splice(index, 1);
        }

        if (this.activeSources.length === 0) {
          this.outputLevel = 0;
          if (this.streamIdleTimer !== null) window.clearTimeout(this.streamIdleTimer);
          this.streamIdleTimer = window.setTimeout(() => {
            this.streamIdleTimer = null;
            if (this.activeSources.length === 0 && this.outputAudioCtx) {
              this.nextPlayTime = this.outputAudioCtx.currentTime;
              this.streamPrimed = false;
            }
          }, this.STREAM_IDLE_RESET_MS);
          if (onEnd) onEnd();
        }
      };
    } catch (err) {
      console.error("Failed to play audio chunk:", err);
      if (onEnd) onEnd();
    }
  }

  public async playEncodedAudio(base64Data: string, onEnd?: () => void): Promise<void> {
    if (!base64Data || typeof base64Data !== "string") {
      if (onEnd) onEnd();
      return;
    }

    try {
      const ctx = this.ensureOutputContext();
      const binary = atob(base64Data);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      ctx.decodeAudioData(
        bytes.buffer,
        (buffer) => {
          try {
            const source = ctx.createBufferSource();
            source.buffer = buffer;

            if (this.masterGain) {
              source.connect(this.masterGain);
            } else if (this.outputAnalyser) {
              source.connect(this.outputAnalyser);
            } else {
              source.connect(ctx.destination);
            }

            const currentTime = ctx.currentTime;
            const startTime = Math.max(currentTime, this.nextPlayTime);
            source.start(startTime);
            this.nextPlayTime = startTime + buffer.duration;

            this.activeSources.push(source);

            source.onended = () => {
              try {
                source.disconnect();
              } catch {
                // ignore
              }
              const index = this.activeSources.indexOf(source);
              if (index > -1) {
                this.activeSources.splice(index, 1);
              }
              if (this.activeSources.length === 0) {
                this.nextPlayTime = ctx.currentTime;
                this.streamPrimed = false;
                this.outputLevel = 0;
                if (onEnd) {
                  onEnd();
                }
              }
            };
          } catch (playErr) {
            console.error("Error starting decoded audio playback:", playErr);
            if (onEnd) onEnd();
          }
        },
        (decodeErr) => {
          console.error("Failed to decode audio data, falling back to raw PCM:", decodeErr);
          this.playAudioChunk(base64Data, onEnd);
        }
      );
    } catch (err) {
      console.error("Failed to process encoded audio:", err);
      if (onEnd) onEnd();
    }
  }

  public stopPlayback(): void {
    if (this.masterGain && this.outputAudioCtx && this.outputAudioCtx.state === "running") {
      try {
        const now = this.outputAudioCtx.currentTime;
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.01);
      } catch {
        // ignore
      }
    }

    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // ignore already stopped sources
      }
    }

    this.activeSources = [];
    this.pendingStartupAudio = null;
    if (this.streamIdleTimer !== null) {
      window.clearTimeout(this.streamIdleTimer);
      this.streamIdleTimer = null;
    }
    this.streamPrimed = false;

    if (this.outputAudioCtx) {
      this.nextPlayTime = this.outputAudioCtx.currentTime;
      if (this.masterGain) {
        try {
          const now = this.outputAudioCtx.currentTime;
          this.masterGain.gain.setValueAtTime(1.0, now + 0.015);
        } catch {
          // ignore
        }
      }
    } else {
      this.nextPlayTime = 0;
    }

    this.outputLevel = 0;
    this.isAssistantSpeaking = false;
  }

  public isPlaying(): boolean {
    return this.activeSources.length > 0;
  }

  public getLevels(): AudioVisualizerLevels {
    return {
      micLevel: this.micLevel,
      outputLevel: this.outputLevel,
    };
  }

  private startLevelLoop(): void {
    // Audio playback is realtime independently of this meter. Do not spend
    // a 60fps JS callback on an effect that only drives the orb visualization.
    const update = () => {
      if (this.outputAnalyser && this.activeSources.length > 0) {
        const data = this.outputAnalyserData || new Uint8Array(this.outputAnalyser.frequencyBinCount);
        this.outputAnalyserData = data;
        this.outputAnalyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        this.outputLevel = Math.min(1, (avg / 255) * 1.8);
      } else if (this.activeSources.length === 0) {
        this.outputLevel = 0;
      }

      this.animFrameId = window.setTimeout(update, 50) as unknown as number;
    };

    if (typeof window !== "undefined") {
      this.animFrameId = window.setTimeout(update, 50) as unknown as number;
    }
  }

  public cleanup(): void {
    if (this.animFrameId !== null) {
      window.clearTimeout(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.streamIdleTimer !== null) {
      window.clearTimeout(this.streamIdleTimer);
      this.streamIdleTimer = null;
    }
    this.stopPlayback();
    this.stopMicrophone();

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch {
        // ignore
      }
      this.outputAudioCtx = null;
    }
  }

  private pcm16ToBase64(pcm16: Int16Array): string {
    const uint8 = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    let binary = "";
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }

  private base64ToFloat32Pcm(base64: string): Float32Array {
    const binary = atob(base64);
    const numSamples = Math.floor(binary.length / 2);
    const float32 = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const low = binary.charCodeAt(i * 2);
      const high = binary.charCodeAt(i * 2 + 1);
      let int16 = (high << 8) | low;
      if (int16 >= 0x8000) {
        int16 -= 0x10000;
      }
      float32[i] = int16 / 32768.0;
    }

    return float32;
  }
}

export const audioManager = new AudioManager();
