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
const CHAT_MODEL = "gemini-3.8-flash";

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
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": value },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with exactly OK." }] }], generationConfig: { maxOutputTokens: 8 } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini rejected the API key (${res.status}).`);
  setAndroidApiKey(value);
}

export async function generateAndroidReply(
  message: string,
  systemInstruction: string,
  history: Array<{ role: "user" | "model"; text: string }> = []
): Promise<string> {
  const key = getAndroidApiKey();
  if (!key) throw new Error("Add your Gemini API key in Settings first.");

  const contents = [
    ...history.slice(-10).map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini request failed (${res.status}).`);

  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
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
