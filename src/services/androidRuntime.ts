import { registerPlugin, Capacitor } from "@capacitor/core";

interface JarvisSpeechPlugin {
  startListening(options?: { language?: string }): Promise<void>;
  stopListening(): Promise<void>;
  speak(options: { text: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  addListener(eventName: "result" | "partialResult" | "error" | "state", listener: (event: any) => void): Promise<{ remove: () => Promise<void> }>;
}

const JarvisSpeech = registerPlugin<JarvisSpeechPlugin>("MyJarvisSpeech");
const API_KEY_STORAGE = "jarvis.android.geminiApiKey";
const CHAT_MODEL = "gemini-3.5-flash";

export function isAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function getAndroidApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

export function setAndroidApiKey(key: string): void {
  const value = key.trim();
  if (value) localStorage.setItem(API_KEY_STORAGE, value);
  else localStorage.removeItem(API_KEY_STORAGE);
}

export async function validateAndroidApiKey(key: string): Promise<void> {
  const value = key.trim();
  if (!value) throw new Error("Gemini API key is required.");

  // Validate the exact runtime path the APK actually uses:
  // Gemini Live WebSocket + the configured 3.1 Live Preview model.
  // A normal REST generateContent check is not enough to prove Live access.
  await new Promise<void>((resolve, reject) => {
    const model = "gemini-3.1-flash-live-preview";
    const url =
      "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
      "?key=" + encodeURIComponent(value);

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { socket.close(); } catch {}
      error ? reject(error) : resolve();
    };

    const timer = window.setTimeout(() => {
      finish(new Error("Gemini Live model check timed out after 5s."));
    }, 5000);

    const socket = new WebSocket(url);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: { responseModalities: ["AUDIO"] },
          sessionResumption: {},
        },
      }));
    };

    socket.onmessage = async (event) => {
      try {
        let raw = event.data;
        if (raw instanceof Blob) raw = await raw.text();
        if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
        const msg = JSON.parse(String(raw));

        if (msg.setupComplete) {
          finish();
          return;
        }

        if (msg.error) {
          const error = msg.error;
          finish(new Error(
            typeof error === "string"
              ? error
              : error?.message || error?.status || JSON.stringify(error)
          ));
        }
      } catch {
        finish(new Error("Gemini Live returned an invalid setup response."));
      }
    };

    socket.onerror = () => {
      finish(new Error("Could not connect to Gemini Live for model verification."));
    };

    socket.onclose = (event) => {
      if (!settled) {
        const detail = [event.code ? `code ${event.code}` : "", event.reason || ""]
          .filter(Boolean)
          .join(": ");
        finish(new Error(
          detail
            ? `Gemini Live model check closed (${detail}).`
            : "Gemini Live model check closed before setup completed."
        ));
      }
    };
  });

  setAndroidApiKey(value);
}

export async function generateAndroidReply(
  message: string,
  systemInstruction: string,
  history: Array<{ role: "user" | "model"; text: string }> = [],
  model: string = CHAT_MODEL
): Promise<string> {
  const key = getAndroidApiKey();
  if (!key) throw new Error("Add your Gemini API key in Settings first.");

  const contents = [
    ...history.slice(-10).map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  const request = async (model: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
          }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error: any = new Error(data?.error?.message || `Gemini request failed (${res.status}).`);
        error.status = res.status;
        throw error;
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim();
      if (!text) throw new Error("Gemini returned an empty response.");
      return text;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const timeoutError: any = new Error("Gemini request timed out.");
        timeoutError.status = 503;
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const isBusy = (error: any) => {
    const status = Number(error?.status || 0);
    return status === 429 || status === 500 || status === 503;
  };

  // The selected brain model is primary. Capacity spikes fall through newer stable
  // 3.x models; do not depend on restricted 2.5 models for normal recovery.
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await request(model);
    } catch (error: any) {
      lastError = error;
      if (!isBusy(error)) throw error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  for (const fallbackModel of ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]) {
    try {
      return await request(fallbackModel);
    } catch (fallbackError: any) {
      lastError = fallbackError;
      if (!isBusy(fallbackError) && Number(fallbackError?.status || 0) !== 404) throw fallbackError;
    }
  }

  throw new Error(`Gemini is temporarily busy. All models failed: ${lastError?.message || "unavailable"}`);
}

export async function listenAndroid(
  onResult: (text: string) => void,
  onError: (message: string) => void,
  onState?: (state: string) => void
): Promise<() => void> {
  let stopped = false;
  let resultListener: { remove: () => Promise<void> } | null = null;
  let errorListener: { remove: () => Promise<void> } | null = null;
  let stateListener: { remove: () => Promise<void> } | null = null;

  resultListener = await JarvisSpeech.addListener("result", (event: any) => {
    if (!stopped) {
      const text = String(event?.text || "").trim();
      if (text) onResult(text);
    }
  });
  errorListener = await JarvisSpeech.addListener("error", (event: any) => {
    if (!stopped) {
      const message = String(event?.message || "Speech recognition failed");
      if (message !== "No speech detected" && message !== "No speech recognized") onError(message);
    }
  });
  stateListener = await JarvisSpeech.addListener("state", (event: any) => {
    if (!stopped) onState?.(String(event?.state || ""));
  });

  try {
    await JarvisSpeech.startListening({ language: navigator.language || "en-IN" });
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
  }

  return () => {
    stopped = true;
    void JarvisSpeech.stopListening().catch(() => {});
    void resultListener?.remove().catch(() => {});
    void errorListener?.remove().catch(() => {});
    void stateListener?.remove().catch(() => {});
  };
}

export async function speakAndroid(text: string): Promise<void> {
  await JarvisSpeech.speak({ text });
}

export async function stopAndroidSpeech(): Promise<void> {
  await JarvisSpeech.stopSpeaking().catch(() => {});
}