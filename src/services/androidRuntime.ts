import { registerPlugin, Capacitor } from "@capacitor/core";

interface JarvisSpeechPlugin {
  startListening(options?: { language?: string }): Promise<void>;
  stopListening(): Promise<void>;
  startPcmCapture(options?: { sampleRate?: number; chunkSamples?: number }): Promise<void>;
  stopPcmCapture(): Promise<void>;
  speak(options: { text: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  getClipboard(): Promise<{ text: string }>;
  addListener(
    eventName:
      | "result"
      | "partialResult"
      | "error"
      | "state"
      | "audioChunk"
      | "speechActivity"
      | "audioReady"
      | "audioCaptureError",
    listener: (event: any) => void
  ): Promise<{ remove: () => Promise<void> }>;
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

  // Validate both runtime paths used by the APK:
  // 1) the REST brain, and 2) Gemini Live voice setup.
  const brainModel = CHAT_MODEL;
  const brainUrl =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(brainModel) +
    ":generateContent";

  try {
    const brainRes = await fetch(brainUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": value,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: "minimal" },
          maxOutputTokens: 4,
        },
      }),
    });

    const brainRaw = await brainRes.text();
    let brainData: any = {};
    try { brainData = brainRaw ? JSON.parse(brainRaw) : {}; } catch {}

    if (!brainRes.ok) {
      throw new Error(
        brainData?.error?.message ||
        `Gemini brain check failed (HTTP ${brainRes.status}).`
      );
    }

    const brainText = brainData?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";

    if (!brainText) {
      throw new Error(
        `Gemini brain check returned no text (finishReason: ${brainData?.candidates?.[0]?.finishReason || "unknown"}).`
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Could not reach Gemini. Check your internet connection and try again.");
    }
    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    const model = "gemini-3.1-flash-live-preview";
    const url =
      "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
      "?key=" + encodeURIComponent(value);

    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { socket?.close(); } catch {}
      error ? reject(error) : resolve();
    };

    const timer = window.setTimeout(() => {
      finish(new Error("Gemini Live model check timed out after 5s."));
    }, 5000);

    socket = new WebSocket(url);

    socket.onopen = () => {
      socket?.send(JSON.stringify({
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
      finish(new Error("Gemini Live connection failed during verification."));
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

  // Android executes local application actions before the brain request.
  // The REST brain has NO function declarations. The default persona historically
  // mentioned tool calls, which can make Gemini attempt an undeclared call and
  // return MALFORMED_FUNCTION_CALL. Keep the persona but add a hard final policy.
  const androidManagerInstruction = [
    systemInstruction,
    "",
    "==================================================",
    "ANDROID MANAGER TOOL POLICY:",
    "==================================================",
    "This is the Android JARVIS text brain. It has NO function declarations and MUST return plain natural-language text only.",
    "NEVER emit, request, simulate, or attempt a function/tool call, including save_memory, delete_memory, clear_memories, start_screen_share, stop_screen_share, open_website, search_google, search_youtube, navigate_browser, go_back, go_forward, reload_page, or close_browser.",
    "Application actions are handled by the client orchestration layer before this request. If the user asked for an action, simply respond naturally; do not output a tool call.",
    "Do not output JSON, XML, YAML, function-call syntax, or structured tool arguments unless the user explicitly asks for that format.",
    "Return only the conversational answer shown to the user.",
  ].join("\n");

  const startedAt = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;

  const request = async (instruction: string): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instruction }] },
        contents,
        generationConfig: {
          thinkingConfig: { thinkingLevel: "minimal" },
          maxOutputTokens: 800,
        },
        // Deliberately no tools/functionDeclarations on Android.
      }),
    });
  };

  try {
    console.log("[Gemini Android] Brain request started", {
      model: selectedModel,
      url,
      method: "POST",
      historyMessages: contents.length - 1,
      promptChars: message.length,
      systemChars: androidManagerInstruction.length,
    });

    // No short client-side timeout: let a valid but slow response finish.
    let res = await request(androidManagerInstruction);
    let elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    let raw = await res.text();
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

    let text = data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";

    const finishReason =
      data?.candidates?.[0]?.finishReason ||
      data?.promptFeedback?.blockReason ||
      "unknown";

    // Recovery path for older/custom prompts that still cause an undeclared
    // function-call attempt. Retry once with a minimal plain-text system prompt.
    if (!text && finishReason === "MALFORMED_FUNCTION_CALL") {
      console.warn("[Gemini Android] MALFORMED_FUNCTION_CALL; retrying plain-text brain request.");
      const retryStartedAt = performance.now();
      const retryInstruction =
        "You are JARVIS, the user's personal AI assistant. " +
        "Return plain natural-language text only. This Android request has NO tools " +
        "or function declarations. Never emit a function call, tool call, JSON tool " +
        "arguments, XML, or structured tool syntax. The application already handled " +
        "any local action requested by the user. Answer the user's message normally.";

      res = await request(retryInstruction);
      const retryElapsedMs = Math.max(0, Math.round(performance.now() - retryStartedAt));
      const retryRaw = await res.text();
      let retryData: any = {};
      try {
        retryData = retryRaw ? JSON.parse(retryRaw) : {};
      } catch {
        retryData = {};
      }

      if (res.ok) {
        text = retryData?.candidates?.[0]?.content?.parts
          ?.map((part: any) => part?.text || "")
          .join("")
          .trim() || "";

        if (text) {
          console.log("[Gemini Android] Malformed-call recovery succeeded", {
            model: selectedModel,
            responseMs: retryElapsedMs,
            outputChars: text.length,
          });
          onChunk?.(text);
          return text;
        }
      }
    }

    if (!text) {
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

    onChunk?.(text);
    return text;
  } catch (err: any) {
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

export async function startAndroidPcmCapture(
  onAudioChunk: (base64Pcm: string) => void,
  onSpeechActivity?: (speaking: boolean, rms: number) => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  let stopped = false;
  let audioListener: { remove: () => Promise<void> } | null = null;
  let speechListener: { remove: () => Promise<void> } | null = null;
  let errorListener: { remove: () => Promise<void> } | null = null;

  audioListener = await JarvisSpeech.addListener("audioChunk", (event: any) => {
    if (stopped) return;
    const data = String(event?.data || "");
    if (data) onAudioChunk(data);
  });

  speechListener = await JarvisSpeech.addListener("speechActivity", (event: any) => {
    if (stopped) return;
    onSpeechActivity?.(event?.speech === true, Number(event?.rms || 0));
  });

  errorListener = await JarvisSpeech.addListener("audioCaptureError", (event: any) => {
    if (stopped) return;
    onError?.(String(event?.message || "Native microphone capture failed"));
  });

  try {
    await JarvisSpeech.startPcmCapture({ sampleRate: 16000, chunkSamples: 640 });
  } catch (e) {
    stopped = true;
    void audioListener.remove().catch(() => {});
    void speechListener.remove().catch(() => {});
    void errorListener.remove().catch(() => {});
    throw e;
  }

  return () => {
    if (stopped) return;
    stopped = true;
    void JarvisSpeech.stopPcmCapture().catch(() => {});
    void audioListener?.remove().catch(() => {});
    void speechListener?.remove().catch(() => {});
    void errorListener?.remove().catch(() => {});
  };
}

export async function readAndroidClipboard(): Promise<string> {
  if (!isAndroidApp()) return "";
  try {
    const result = await JarvisSpeech.getClipboard();
    return String(result?.text || "");
  } catch {
    return "";
  }
}

export async function speakAndroid(text: string): Promise<void> {
  await JarvisSpeech.speak({ text });
}

export async function stopAndroidSpeech(): Promise<void> {
  await JarvisSpeech.stopSpeaking().catch(() => {});
}

export async function listenAndroidOnce(
  onResult: (text: string) => void,
  onError: (message: string) => void
): Promise<void> {
  let cleanup: (() => void) | null = null;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup?.();
    cleanup = null;
  };

  cleanup = await listenAndroid(
    (text) => {
      if (settled) return;
      finish();
      onResult(text);
    },
    (message) => {
      if (settled) return;
      finish();
      onError(message);
    },
  );

  if (settled) cleanup();
}
