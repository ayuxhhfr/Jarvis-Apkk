/**
 * Real viewport + keyboard/IME inset tracking.
 *
 * The Android WebView reports safe-area insets through `env(safe-area-inset-*)`,
 * but the keyboard does NOT shrink the layout viewport on every ROM/WebView
 * combination. `visualViewport` is the only reliable source for the true
 * visible area, so we measure it instead of hard-coding a keyboard height.
 *
 * Exposed values:
 *  - `keyboardInset`  px the IME currently covers (0 when closed)
 *  - `viewportHeight`  actually visible height, excluding the IME
 *  - `compact`         true when vertical space is scarce (IME open or short
 *                      viewport) so the shell can switch to a tighter layout
 */

import { useEffect, useState } from "react";

const COMPACT_VIEWPORT_PX = 620;
const COMPACT_RATIO = 0.62;

export interface ViewportInsets {
  keyboardInset: number;
  viewportHeight: number;
  compact: boolean;
}

function readViewport(): ViewportInsets {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 0;

  if (!vv) {
    return { keyboardInset: 0, viewportHeight: windowHeight, compact: windowHeight > 0 && windowHeight < COMPACT_VIEWPORT_PX };
  }

  const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  const keyboardInset = Math.round(covered);
  const viewportHeight = Math.round(vv.height);

  return {
    keyboardInset,
    viewportHeight,
    compact: keyboardInset > 80 || viewportHeight < COMPACT_VIEWPORT_PX,
  };
}

export function useViewportInsets(): ViewportInsets {
  const [insets, setInsets] = useState<ViewportInsets>(readViewport);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) {
      const onResize = () => setInsets(readViewport());
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      };
    }

    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setInsets(readViewport());
      });
    };

    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  return insets;
}
