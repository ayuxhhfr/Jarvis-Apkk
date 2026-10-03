/**
 * Browser Tools & Function Definitions for JARVIS.
 * Provides exact URL normalization, website shortcut mappings,
 * JARVIS recursion prevention, and natural language command parsing.
 */

export const WEBSITE_SHORTCUTS: Record<string, string> = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  spotify: "https://open.spotify.com",
  github: "https://github.com",
  chatgpt: "https://chatgpt.com",
  gmail: "https://mail.google.com",
  instagram: "https://www.instagram.com",
  reddit: "https://www.reddit.com",
  amazon: "https://www.amazon.com",
  netflix: "https://www.netflix.com",
  "google maps": "https://maps.google.com",
  maps: "https://maps.google.com",
  twitter: "https://x.com",
  x: "https://x.com",
  wikipedia: "https://www.wikipedia.org",
  twitch: "https://www.twitch.tv",
  discord: "https://discord.com",
  linkedin: "https://www.linkedin.com",
};

/**
 * Normalizes input text into a valid, safe browser URL.
 * Rules:
 * 1. Checks exact shortcut mappings (e.g. "youtube" -> "https://www.youtube.com")
 * 2. If input starts with https:// or http://, return it (sanitizing dangerous schemes)
 * 3. If input is www.domain.com, return https://www.domain.com
 * 4. If input is domain.com (e.g. youtube.com), return https://youtube.com
 * 5. If input is normal search text (e.g. "minecraft tutorials"), convert to Google search
 */
export function normalizeBrowserUrl(input: string, fallbackToYouTube?: boolean): string {
  const trimmed = input.trim();
  if (!trimmed) return "https://www.google.com";

  // Check dangerous schemes
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    console.warn("Blocked potentially dangerous URL scheme:", trimmed);
    return "https://www.google.com";
  }

  // 1. Check known website shortcuts
  if (WEBSITE_SHORTCUTS[lower]) {
    return WEBSITE_SHORTCUTS[lower];
  }

  // Handle common shortcut variations like "youtube.com" or "www.youtube.com"
  const cleanHost = lower.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (cleanHost === "youtube.com" || cleanHost === "www.youtube.com") {
    return "https://www.youtube.com";
  }
  if (cleanHost === "google.com" || cleanHost === "www.google.com") {
    return "https://www.google.com";
  }
  if (cleanHost === "spotify.com" || cleanHost === "open.spotify.com") {
    return "https://open.spotify.com";
  }
  if (cleanHost === "github.com" || cleanHost === "www.github.com") {
    return "https://github.com";
  }
  if (cleanHost === "chatgpt.com" || cleanHost === "www.chatgpt.com") {
    return "https://chatgpt.com";
  }
  if (cleanHost === "gmail.com" || cleanHost === "mail.google.com") {
    return "https://mail.google.com";
  }
  if (cleanHost === "instagram.com" || cleanHost === "www.instagram.com") {
    return "https://www.instagram.com";
  }
  if (cleanHost === "reddit.com" || cleanHost === "www.reddit.com") {
    return "https://www.reddit.com";
  }

  // 2. If already starts with http:// or https://
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // 3. If starts with www. (e.g., www.youtube.com)
  if (/^www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // 4. If looks like a domain name with TLD (e.g., youtube.com, example.org/page)
  // Must NOT have spaces, must have valid TLD
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed) && !/\s/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // 5. Otherwise, treat as search query
  if (fallbackToYouTube) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmed)}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Detects if a URL resolves to the current JARVIS application itself.
 * Prevents recursive rendering of JARVIS inside JARVIS.
 */
export function isJarvisSelfUrl(url: string): boolean {
  try {
    const rawLower = url.trim().toLowerCase();
    if (
      rawLower === "jarvis" ||
      rawLower === "open jarvis" ||
      rawLower === "/" ||
      rawLower === "./"
    ) {
      return true;
    }

    if (typeof window === "undefined") return false;

    if (
      rawLower === window.location.href.toLowerCase() ||
      rawLower === window.location.origin.toLowerCase()
    ) {
      return true;
    }

    const target = new URL(url.startsWith("http") ? url : `https://${url}`, window.location.origin);
    const current = new URL(window.location.href);

    // Host comparison
    const isSameHost = target.hostname === current.hostname;
    const isSameOrigin = target.origin === window.location.origin;

    // Check localhost
    const isLocalhost =
      (current.hostname === "localhost" || current.hostname === "127.0.0.1") &&
      (target.hostname === "localhost" || target.hostname === "127.0.0.1") &&
      target.port === current.port;

    if ((isSameHost || isSameOrigin || isLocalhost) && (target.pathname === "/" || target.pathname === "")) {
      return true;
    }
  } catch {
    // If URL cannot be parsed, safe fallback
  }
  return false;
}

/**
 * Gemini Function Declarations for Browser Tools.
 */
export const BROWSER_FUNCTION_DECLARATIONS = [
  {
    name: "open_website",
    description:
      "Open a specified website (e.g., YouTube, Google, Spotify, GitHub, Netflix, Instagram, Reddit) inside the JARVIS built-in browser overlay.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The full URL or domain to open, e.g. 'https://www.youtube.com'",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_google",
    description:
      "Search Google for a query and show results inside the JARVIS built-in browser overlay.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search keywords or question to search on Google",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_youtube",
    description:
      "Search YouTube for videos on a query and open results inside the JARVIS built-in browser overlay.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Keywords or topic to search on YouTube",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "navigate_browser",
    description: "Navigate the active JARVIS browser tab to a specified destination URL.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The destination URL to navigate to",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "go_back",
    description: "Navigate backward in the JARVIS browser history.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "go_forward",
    description: "Navigate forward in the JARVIS browser history.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "reload_page",
    description: "Reload the current page in the JARVIS browser.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "close_browser",
    description:
      "Close the JARVIS built-in browser overlay and return to the main JARVIS assistant screen.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

/**
 * Natural language intent parser for browser commands.
 */
export function parseBrowserIntent(
  rawText: string,
  isYouTubeCurrent: boolean = false
): { name: string; args: Record<string, any> } | null {
  const t = rawText.trim().toLowerCase();

  // Close browser
  if (
    /^(close|exit|hide|dismiss)\s+(the\s+)?browser/i.test(t) ||
    t === "close browser" ||
    t === "exit browser"
  ) {
    return { name: "close_browser", args: {} };
  }

  // Go back
  if (/^go\s+back/i.test(t) || t === "back" || t === "previous page") {
    return { name: "go_back", args: {} };
  }

  // Go forward
  if (/^go\s+forward/i.test(t) || t === "forward" || t === "next page") {
    return { name: "go_forward", args: {} };
  }

  // Reload
  if (/^reload(\s+page|\s+the\s+page)?/i.test(t) || /^refresh(\s+page|\s+the\s+page)?/i.test(t)) {
    return { name: "reload_page", args: {} };
  }

  // Search YouTube
  const ytMatch = t.match(
    /(?:search\s+youtube\s+for|look\s+up\s+(.+?)\s+on\s+youtube|find\s+(.+?)\s+on\s+youtube|search\s+for\s+(.+?)\s+on\s+youtube|search\s+youtube\s+(.+))/i
  );
  if (ytMatch) {
    const q =
      ytMatch[1] ||
      ytMatch[2] ||
      ytMatch[3] ||
      ytMatch[4] ||
      rawText.replace(/search\s+youtube\s+for/i, "");
    return { name: "search_youtube", args: { query: q.trim() } };
  }

  // Context awareness: if already on YouTube and user says "search for ..."
  if (isYouTubeCurrent && /^(search|look up|find)\s+(for\s+)?(.+)/i.test(t)) {
    const q = t.replace(/^(search|look up|find)\s+(for\s+)?/i, "");
    return { name: "search_youtube", args: { query: q.trim() } };
  }

  // Search Google
  const googleMatch = t.match(
    /(?:search\s+google\s+for|search\s+the\s+web\s+for|google\s+search\s+for|search\s+google\s+(.+)|google\s+(.+))/i
  );
  if (googleMatch) {
    const q =
      googleMatch[1] ||
      googleMatch[2] ||
      rawText.replace(/search\s+(google|the web)\s+for/i, "");
    return { name: "search_google", args: { query: q.trim() } };
  }

  // Open Website
  const openMatch = t.match(
    /(?:(?:can\s+you\s+)?(?:open|launch|take\s+me\s+to|go\s+to)\s+(?:this\s+website\s+|website\s+)?([a-z0-9\.\-:\/ ]+?)(?:\s+for\s+me)?)$/i
  );
  if (openMatch) {
    const target = openMatch[1].trim();
    if (target && !["the door", "settings", "mic", "microphone"].includes(target)) {
      return { name: "open_website", args: { url: target } };
    }
  }

  return null;
}
