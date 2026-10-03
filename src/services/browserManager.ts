/**
 * Browser Manager Service for JARVIS.
 * Strictly maintains isolated browser state (browserOpen, browserUrl, pageTitle, loading, history).
 * Prevents navigation of parent application and prevents JARVIS self-recursion.
 */

import { BrowserState, BrowserActionResult } from "../types/browser";
import { normalizeBrowserUrl, isJarvisSelfUrl } from "./browserTools";

export type BrowserStateListener = (state: BrowserState) => void;

class BrowserManager {
  private browserOpen: boolean = false;
  private browserUrl: string | null = null;
  private pageTitle: string = "New Tab";
  private loading: boolean = false;
  private history: string[] = [];
  private historyIndex: number = -1;
  private isBlocked: boolean = false;

  private listeners: Set<BrowserStateListener> = new Set();

  constructor() {}

  public getState(): BrowserState {
    return {
      browserOpen: this.browserOpen,
      browserUrl: this.browserUrl,
      pageTitle: this.pageTitle,
      loading: this.loading,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
      isBlocked: this.isBlocked,
    };
  }

  // Alias for backward compatibility
  public get isOpen(): boolean {
    return this.browserOpen;
  }

  public subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  /**
   * Open website by URL or shortcut name.
   */
  public openWebsite(rawUrl: string): BrowserActionResult {
    const resolved = normalizeBrowserUrl(rawUrl);
    return this.navigate(resolved, true);
  }

  /**
   * Search Google.
   */
  public searchGoogle(query: string): BrowserActionResult {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
    return this.navigate(url, true);
  }

  /**
   * Search YouTube.
   */
  public searchYoutube(query: string): BrowserActionResult {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
    return this.navigate(url, true);
  }

  /**
   * Navigate to a sanitized URL, updating history and opening browser if closed.
   * Strictly prevents recursion to JARVIS itself.
   */
  public navigate(rawUrl: string, openIfClosed: boolean = true): BrowserActionResult {
    const normalized = normalizeBrowserUrl(rawUrl);

    // Prevent JARVIS self-recursion
    if (isJarvisSelfUrl(normalized)) {
      return {
        success: false,
        message: "This is already JARVIS.",
        error: "This is already JARVIS.",
        isOpen: this.browserOpen,
        browserOpen: this.browserOpen,
      };
    }

    this.browserOpen = openIfClosed ? true : this.browserOpen;
    this.browserUrl = normalized;
    this.pageTitle = this.extractTitle(normalized);
    this.loading = true;
    this.isBlocked = false;

    // Truncate forward history if navigating from an earlier point
    if (this.historyIndex < this.history.length - 1 && this.historyIndex >= 0) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    if (this.historyIndex === -1 || this.history[this.historyIndex] !== normalized) {
      this.history.push(normalized);
      this.historyIndex = this.history.length - 1;
    }

    this.notify();

    return {
      success: true,
      url: normalized,
      title: this.pageTitle,
      message: `Navigated to ${normalized}`,
      isOpen: this.browserOpen,
      browserOpen: this.browserOpen,
    };
  }

  /**
   * Go back in history (isolated browser history only).
   */
  public goBack(): BrowserActionResult {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const prevUrl = this.history[this.historyIndex];
      this.browserUrl = prevUrl;
      this.pageTitle = this.extractTitle(prevUrl);
      this.loading = true;
      this.isBlocked = false;
      this.notify();
      return {
        success: true,
        url: prevUrl,
        title: this.pageTitle,
        message: `Went back to ${prevUrl}`,
      };
    }
    return {
      success: false,
      message: "No previous page in history",
      error: "No previous page in history",
    };
  }

  /**
   * Go forward in history (isolated browser history only).
   */
  public goForward(): BrowserActionResult {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const nextUrl = this.history[this.historyIndex];
      this.browserUrl = nextUrl;
      this.pageTitle = this.extractTitle(nextUrl);
      this.loading = true;
      this.isBlocked = false;
      this.notify();
      return {
        success: true,
        url: nextUrl,
        title: this.pageTitle,
        message: `Went forward to ${nextUrl}`,
      };
    }
    return {
      success: false,
      message: "No forward page in history",
      error: "No forward page in history",
    };
  }

  /**
   * Reload current page (isolated, does not reload parent JARVIS).
   */
  public reload(): BrowserActionResult {
    if (!this.browserUrl) {
      return { success: false, message: "No active page to reload" };
    }
    this.loading = true;
    this.isBlocked = false;
    this.notify();
    return {
      success: true,
      url: this.browserUrl,
      title: this.pageTitle,
      message: "Reloaded current page",
    };
  }

  /**
   * Close the browser overlay and return to main JARVIS view.
   * Does NOT touch parent window.location or history.
   */
  public close(): BrowserActionResult {
    this.browserOpen = false;
    this.loading = false;
    this.notify();
    return { success: true, message: "Browser closed", isOpen: false, browserOpen: false };
  }

  /**
   * Open the browser overlay.
   */
  public open(): BrowserActionResult {
    if (!this.browserUrl) {
      this.browserUrl = "https://www.google.com";
      this.history = ["https://www.google.com"];
      this.historyIndex = 0;
      this.pageTitle = "Google";
    }
    this.browserOpen = true;
    this.notify();
    return {
      success: true,
      message: "Browser opened",
      isOpen: true,
      browserOpen: true,
      url: this.browserUrl,
    };
  }

  /**
   * Set loading status.
   */
  public setLoading(loading: boolean): void {
    this.loading = loading;
    this.notify();
  }

  /**
   * Set blocked by policy status.
   */
  public setBlocked(blocked: boolean): void {
    this.isBlocked = blocked;
    this.loading = false;
    this.notify();
  }

  /** Return authoritative browser state for assistant/tool context. */
  public getAssistantContext(): string {
    if (!this.browserOpen) return "[BROWSER STATE: CLOSED]";
    return `[BROWSER STATE: OPEN] URL=${this.browserUrl || "about:blank"} TITLE=${this.pageTitle} LOADING=${this.loading} BLOCKED=${this.isBlocked}`;
  }

  /**
   * Context awareness: check if currently browsing YouTube.
   */
  public isCurrentSiteYouTube(): boolean {
    return this.browserOpen && !!this.browserUrl && /youtube\.com/i.test(this.browserUrl);
  }

  /**
   * Execute a tool call requested by Gemini or UI.
   */
  public executeTool(name: string, args: Record<string, any> = {}): BrowserActionResult {
    switch (name) {
      case "open_website": {
        const url = args.url || args.target || "https://www.youtube.com";
        return this.openWebsite(url);
      }
      case "search_google": {
        const query = args.query || args.q || "";
        return this.searchGoogle(query);
      }
      case "search_youtube": {
        const query = args.query || args.q || "";
        return this.searchYoutube(query);
      }
      case "navigate_browser": {
        const url = args.url || "https://www.google.com";
        return this.navigate(url);
      }
      case "go_back":
        return this.goBack();
      case "go_forward":
        return this.goForward();
      case "reload_page":
        return this.reload();
      case "close_browser":
        return this.close();
      default:
        return { success: false, message: `Unknown browser tool: ${name}`, error: `Unknown browser tool: ${name}` };
    }
  }

  private extractTitle(url: string): string {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      return host || "Web Page";
    } catch {
      return "Web Page";
    }
  }
}

export const browserManager = new BrowserManager();
