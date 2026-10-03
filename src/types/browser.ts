/**
 * Browser data types and tool specifications for the JARVIS built-in browser.
 */

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  history: string[];
  historyIndex: number;
  isBlocked?: boolean;
}

export interface BrowserState {
  browserOpen: boolean;
  browserUrl: string | null;
  pageTitle: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isBlocked: boolean;
}

export interface BrowserActionToolCall {
  name: string;
  args: Record<string, any>;
  callId?: string;
}

export interface BrowserActionResult {
  success: boolean;
  message: string;
  url?: string;
  title?: string;
  error?: string;
  isOpen?: boolean;
  browserOpen?: boolean;
}
