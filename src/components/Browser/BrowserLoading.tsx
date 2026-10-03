/**
 * Subtle progress and loading bar for the JARVIS built-in browser.
 */

import React from "react";

interface BrowserLoadingProps {
  loading: boolean;
}

export const BrowserLoading: React.FC<BrowserLoadingProps> = ({ loading }) => {
  if (!loading) return null;

  return (
    <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/[0.05] overflow-hidden z-20">
      <div className="h-full bg-gradient-to-r from-[#00ffaa]/40 via-[#00ffaa] to-cyan-400 animate-[loading_1.4s_ease-in-out_infinite]" />
    </div>
  );
};
