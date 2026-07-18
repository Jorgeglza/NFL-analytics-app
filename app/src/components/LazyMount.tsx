import { useCallback, useState, type ReactNode } from "react";

/** Mounts children only once scrolled near the viewport — keeps long chart-heavy
 *  lists cheap (charts init on demand) without losing the scan-the-whole-page flow. */
export function LazyMount({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const holderRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) fire();
      },
      { rootMargin: "400px 0px" },
    );
    // Fallback for environments where IntersectionObserver never ticks:
    // measure directly on mount and on scroll/resize.
    const check = () => {
      if (done || !node.isConnected) return;
      const r = node.getBoundingClientRect();
      if (r.top < window.innerHeight + 400 && r.bottom > -400) fire();
    };
    const fire = () => {
      if (done) return;
      done = true;
      io.disconnect();
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
      setVisible(true);
    };
    io.observe(node);
    window.addEventListener("scroll", check, { capture: true, passive: true });
    window.addEventListener("resize", check);
    requestAnimationFrame(check);
  }, []);
  return visible ? <>{children}</> : <div ref={holderRef} style={{ minHeight }} />;
}
