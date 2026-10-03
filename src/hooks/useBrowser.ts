/**
 * Hook for subscribing to and controlling the JARVIS built-in browser.
 */

import { useState, useEffect, useCallback } from "react";
import { browserManager } from "../services/browserManager";
import { BrowserState, BrowserActionResult } from "../types/browser";

export function useBrowser() {
  const [browserState, setBrowserState] = useState<BrowserState>(() => browserManager.getState());

  useEffect(() => {
    const unsubscribe = browserManager.subscribe((nextState) => {
      setBrowserState(nextState);
    });
    return unsubscribe;
  }, []);

  const openWebsite = useCallback((url: string) => browserManager.openWebsite(url), []);
  const searchGoogle = useCallback((query: string) => browserManager.searchGoogle(query), []);
  const searchYoutube = useCallback((query: string) => browserManager.searchYoutube(query), []);
  const navigate = useCallback((url: string) => browserManager.navigate(url), []);
  const goBack = useCallback(() => browserManager.goBack(), []);
  const goForward = useCallback(() => browserManager.goForward(), []);
  const reload = useCallback(() => browserManager.reload(), []);
  const close = useCallback(() => browserManager.close(), []);
  const open = useCallback(() => browserManager.open(), []);
  const setLoading = useCallback((loading: boolean) => browserManager.setLoading(loading), []);
  const setBlocked = useCallback((blocked: boolean) => browserManager.setBlocked(blocked), []);
  const executeTool = useCallback(
    (name: string, args: Record<string, any>): BrowserActionResult => {
      return browserManager.executeTool(name, args);
    },
    []
  );

  return {
    ...browserState,
    openWebsite,
    searchGoogle,
    searchYoutube,
    navigate,
    goBack,
    goForward,
    reload,
    close,
    open,
    setLoading,
    setBlocked,
    executeTool,
  };
}
