/**
 * Address bar for JARVIS browser.
 * Normalizes input using normalizeBrowserUrl.
 */

import React, { useState, useEffect, useRef } from "react";
import { Lock, Search, Globe, ArrowRight } from "lucide-react";
import { normalizeBrowserUrl } from "../../services/browserTools";

interface BrowserAddressBarProps {
  currentUrl: string | null;
  onNavigate: (url: string) => void;
  loading: boolean;
}

export const BrowserAddressBar: React.FC<BrowserAddressBarProps> = ({
  currentUrl,
  onNavigate,
  loading,
}) => {
  const [inputValue, setInputValue] = useState(currentUrl || "");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(currentUrl || "");
    }
  }, [currentUrl, isFocused]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const resolved = normalizeBrowserUrl(inputValue);
    onNavigate(resolved);
    inputRef.current?.blur();
  };

  const isHttps = (currentUrl || "").startsWith("https://");

  return (
    <form
      onSubmit={handleSubmit}
      className={`relative flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0a0d10] border transition-all text-xs font-mono select-none ${
        isFocused
          ? "border-[#00ffaa]/50 shadow-[0_0_12px_rgba(0,255,170,0.15)] ring-1 ring-[#00ffaa]/20"
          : "border-white/[0.08] hover:border-white/[0.15]"
      }`}
    >
      {/* Protocol or search indicator */}
      <div className="shrink-0 text-neutral-400">
        {isFocused ? (
          <Search className="w-3.5 h-3.5 text-[#00ffaa]" />
        ) : isHttps ? (
          <Lock className="w-3.5 h-3.5 text-[#00ffaa]/80" />
        ) : (
          <Globe className="w-3.5 h-3.5 text-neutral-400" />
        )}
      </div>

      {/* Input Field */}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={() => {
          setIsFocused(true);
          inputRef.current?.select();
        }}
        onBlur={() => setIsFocused(false)}
        placeholder="Enter URL or search Google..."
        className="w-full bg-transparent text-[#e6e8eb] placeholder-neutral-500 focus:outline-none tracking-wide text-xs font-mono"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />

      {/* Enter / Submit Arrow when focused */}
      {isFocused && inputValue.trim().length > 0 && (
        <button
          type="submit"
          className="shrink-0 p-1 rounded-md bg-[#00ffaa]/15 text-[#00ffaa] hover:bg-[#00ffaa] hover:text-black transition-colors"
          title="Navigate"
        >
          <ArrowRight className="w-3 h-3 stroke-[2.5]" />
        </button>
      )}
    </form>
  );
};
