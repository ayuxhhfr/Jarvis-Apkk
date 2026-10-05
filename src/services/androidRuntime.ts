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
  model: string = CHAT_MODEL,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const key = getAndroidApiKey();
  if (!key) throw new Error("Add your Gemini API key in Settings first.");

  const selectedModel = (model || CHAT_MODEL).trim() || CHAT_MODEL;
  const contents = [
    ...history.slice(-8).map((item) => ({
      role: item.role,
      parts: [{ text: item.text.slice(-1800) }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const startedAt = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;

  try {
    console.log("[Gemini Android] Brain request started", {
      model: selectedModel,
      url,
      method: "POST",
      historyMessages: contents.length - 1,
      promptChars: message.length,
      systemChars: systemInstruction.length,
    });

    // Deliberately use the proven Android REST generateContent path.
    // There is no short client-side AbortController here: previous latency work
    // introduced an 8–15s abort which hid a slow-but-valid Gemini response as
    // "Gemini request timed out." The platform/network is now allowed to finish.
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          thinkingConfig: { thinkingLevel: "minimal" },
          maxOutputTokens: 800,
        },
      }),
    });

    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    const raw = await res.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const providerMessage =
        data?.error?.message ||
        raw?.slice(0, 500) ||
        `HTTP ${res.status}`;

      let kind = "unknown";
      if (res.status === 400) kind = "invalid_request";
      else if (res.status === 401 || res.status === 403) kind = "authentication_or_permission";
      else if (res.status === 404) kind = "model_or_endpoint_not_found";
      else if (res.status === 429) kind = "quota_or_rate_limit";
      else if (res.status >= 500 && res.status <= 599) kind = "gemini_server_error";

      const error: any = new Error(
        `Gemini ${selectedModel} failed (HTTP ${res.status}, ${kind}) after ${elapsedMs}ms: ${providerMessage}`
      );
      error.status = res.status;
      error.kind = kind;
      error.model = selectedModel;
      error.elapsedMs = elapsedMs;
      console.error("[Gemini Android] Brain request failed", {
        model: selectedModel,
        httpStatus: res.status,
        kind,
        elapsedMs,
        message: providerMessage,
      });
      throw error;
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";

    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "unknown";
      const error: any = new Error(
        `Gemini ${selectedModel} returned no text after ${elapsedMs}ms (finishReason: ${finishReason}).`
      );
      error.status = 200;
      error.kind = "empty_model_response";
      error.model = selectedModel;
      error.elapsedMs = elapsedMs;
      console.error("[Gemini Android] Empty brain response", {
        model: selectedModel,
        httpStatus: 200,
        elapsedMs,
        finishReason,
      });
      throw error;
    }

    console.log("[Gemini Android] Brain request succeeded", {
      model: selectedModel,
      httpStatus: res.status,
      responseMs: elapsedMs,
      outputChars: text.length,
    });

    // Preserve the existing streaming UI contract. Android uses one reliable REST
    // result rather than WebView SSE chunking, so the UI receives one authoritative chunk.
    onChunk?.(text);
    return text;
  } catch (err: any) {
    // Fetch/network failures must remain visible as network/TLS/WebView errors.
    // Do not rewrite arbitrary failures as a Gemini timeout.
    if (err instanceof TypeError) {
      const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
      const networkError: any = new Error(
        `Gemini ${selectedModel} network request failed after ${elapsedMs}ms: ${err.message || "Fetch failed"}`
      );
      networkError.kind = "network";
      networkError.model = selectedModel;
      networkError.elapsedMs = elapsedMs;
      networkError.cause = err;
      console.error("[Gemini Android] Network/WebView fetch failure", {
        model: selectedModel,
        elapsedMs,
        message: err.message,
      });
      throw networkError;
    }

    throw err;
  }
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