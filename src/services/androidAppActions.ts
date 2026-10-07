import { Capacitor } from "@capacitor/core";

import { nativeBridge } from "./nativeBridge";

export interface InstalledAndroidApp {
  name: string;
  packageName: string;
}

let cachedApps: InstalledAndroidApp[] | null = null;
let cachePromise: Promise<InstalledAndroidApp[]> | null = null;

const aliases: Record<string, string[]> = {
  youtube: ["youtube", "yt"],
  whatsapp: ["whatsapp", "whatsapp messenger"],
  instagram: ["instagram", "insta"],
  facebook: ["facebook", "fb"],
  messenger: ["messenger", "facebook messenger"],
  telegram: ["telegram"],
  discord: ["discord"],
  spotify: ["spotify"],
  chrome: ["chrome", "google chrome"],
  gmail: ["gmail", "google mail"],
  google: ["google"],
  maps: ["maps", "google maps"],
  playstore: ["play store", "google play", "playstore", "play store app"],
  settings: ["settings", "android settings"],
  camera: ["camera"],
  gallery: ["gallery", "photos", "google photos"],
  calculator: ["calculator"],
  clock: ["clock"],
  files: ["files", "file manager"],
  phone: ["phone", "dialer"],
  messages: ["messages", "messaging"],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function getInstalledAndroidApps(force = false): Promise<InstalledAndroidApp[]> {
  if (!isAndroidNative()) return [];
  if (cachedApps && !force) return cachedApps;
  if (cachePromise && !force) return cachePromise;

  cachePromise = nativeBridge.listApps()
    .then(result => {
      cachedApps = Array.isArray(result?.apps) ? result.apps : [];
      return cachedApps;
    })
    .finally(() => {
      cachePromise = null;
    });

  return cachePromise;
}

function findBestApp(query: string, apps: InstalledAndroidApp[]): InstalledAndroidApp | null {
  const q = normalize(query);
  if (!q) return null;

  const expanded = new Set([q, ...(aliases[q] || []).map(normalize)]);
  const exact = apps.find(app => {
    const name = normalize(app.name);
    const pkg = normalize(app.packageName);
    return expanded.has(name) || expanded.has(pkg);
  });
  if (exact) return exact;

  const starts = apps.find(app => {
    const name = normalize(app.name);
    return [...expanded].some(alias => name.startsWith(alias) || alias.startsWith(name));
  });
  if (starts) return starts;

  const contains = apps.find(app => {
    const name = normalize(app.name);
    return [...expanded].some(alias => name.includes(alias) || alias.includes(name));
  });
  return contains || null;
}

export async function openAndroidApp(query: string): Promise<InstalledAndroidApp | null> {
  if (!isAndroidNative()) return null;

  const apps = await getInstalledAndroidApps();
  const app = findBestApp(query, apps);
  if (!app) throw new Error(`I couldn't find an installed app named "${query}".`);

  await AndroidApp.openApp({ packageName: app.packageName, query: app.name });
  return app;
}

export async function openAndroidAppPackage(packageName: string): Promise<void> {
  if (!isAndroidNative()) throw new Error("Native Android app launcher is unavailable.");
  await AndroidApp.openApp({ packageName });
}

export async function resumeAndroidWakeWord(wakeWord = "jarvis"): Promise<void> {
  if (!isAndroidNative()) return;
  await AndroidApp.startWakeWord({ wakeWord });
}

export async function startAndroidWakeWord(
  wakeWord = "jarvis",
  onWake: (command: string) => void,
  onError?: (message: string) => void
): Promise<() => void> {
  if (!isAndroidNative()) return () => {};

  const wakeListener = await AndroidApp.addListener("wake", event => {
    onWake(String(event?.text || "").trim());
  });
  const errorListener = await AndroidApp.addListener("wakeError", event => {
    onError?.(String(event?.message || "Wake word microphone error"));
  });

  await AndroidApp.startWakeWord({ wakeWord });

  return () => {
    void AndroidApp.stopWakeWord().catch(() => {});
    void wakeListener.remove().catch(() => {});
    void errorListener.remove().catch(() => {});
  };
}


export async function tryOpenAndroidAppCommand(text: string): Promise<InstalledAndroidApp | null> {
  if (!isAndroidNative()) return null;

  const cleaned = text
    .trim()
    .replace(/^(please\s+)?(jarvis[,.]?\s*)/i, "")
    .replace(/^(hey\s+)?jarvis[,.]?\s*/i, "")
    .trim();

  const match = cleaned.match(
    /^(?:(?:please|can\s+you)\s+)?(?:open|launch|start|run|go\s+to|take\s+me\s+to|show\s+me|khol(?:o|na)?|chala(?:o|do)|shuru\s+karo)\s+(?:the\s+)?(.+?)(?:\s+(?:app|please|plz|do|karo|please\s+do))?[.!?]*$/i
  );
  if (!match) return null;

  const target = match[1].trim();
  if (!target || /^(a|an|the)\s+(app|application)$/i.test(target)) return null;

  // URLs and explicit websites belong to the JARVIS browser, not the native app launcher.
  if (/\.(com|in|org|net|co|io)(\/|$)/i.test(target) || /^https?:\/\//i.test(target)) return null;

  const apps = await getInstalledAndroidApps();
  const app = findBestApp(target, apps);
  if (!app) return null;

  await AndroidApp.openApp({ packageName: app.packageName, query: app.name });
  return app;
}
