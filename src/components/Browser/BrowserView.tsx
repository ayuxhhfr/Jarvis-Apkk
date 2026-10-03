/**
 * BrowserView Component - JARVIS Built-in Browser Overlay.
 * Isolates the browser content view from the main JARVIS application shell.
 * Renders ONLY the BrowserToolbar and BrowserContent.
 */

import React, { useCallback } from "react";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserContent } from "./BrowserContent";
import { BrowserLoading } from "./BrowserLoading";
import { useBrowser } from "../../hooks/useBrowser";

export const BrowserView: React.FC = () => {
  const {
    browserOpen,
    browserUrl,
    loading,
    canGoBack,
    canGoForward,
    isBlocked,
    navigate,
    goBack,
    goForward,
    reload,
    close,
    setLoading,
    setBlocked,
  } = useBrowser();

  const handleOpenExternal = useCallback(() => {
    if (browserUrl) {
      window.open(browserUrl, "_blank", "noopener,noreferrer");
    }
  }, [browserUrl]);

  if (!browserOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#090b0e] text-[#e6e8eb] animate-fadeIn select-none">
      {/* Top Loading Bar */}
      <BrowserLoading loading={loading} />

      {/* Browser Toolbar (Back, Forward, Reload, AddressBar, OpenExternal, Close) */}
      <BrowserToolbar
        currentUrl={browserUrl}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        loading={loading}
        onNavigate={navigate}
        onGoBack={goBack}
        onGoForward={goForward}
        onReload={reload}
        onClose={close}
      />

      {/* Browser Content Viewport (Strictly isolated external web content) */}
      <div className="relative flex-1 w-full h-full bg-[#050608] overflow-hidden">
        <BrowserContent
          browserUrl={browserUrl}
          loading={loading}
          isBlocked={isBlocked}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setBlocked(true);
          }}
          onOpenExternal={handleOpenExternal}
          onGoBack={goBack}
          onReload={reload}
        />
      </div>
    </div>
  );
};
