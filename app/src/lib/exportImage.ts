// Shared "copy/export a page section as PNG" helpers — originally built for
// Game Picks' "copy table as image" button, and reused by Parlay Builder.
// Nothing here is table-specific: it operates on any HTMLElement clone and
// its <img> children.
import { toPng } from "html-to-image";

// Team logos, headshots, etc. live on cross-origin CDNs, often served much
// larger than their on-screen render size. html-to-image's own approach —
// clone the DOM into an SVG <foreignObject>, then base64 the *whole SVG*
// into a second data: URI for final canvas rasterization — means every
// embedded image's full byte size gets compounded into that outer payload.
// With many full-resolution images embedded, that payload can reach
// multiple MB; real mobile Safari/WebKit has a documented history of
// silently failing to rasterize data: URIs in that size class (blank
// output, no thrown error) where desktop Chromium tolerates it fine.
// Downscaling each image to its actual rendered size before embedding
// keeps the whole export payload small enough to rasterize reliably
// everywhere, as a bonus this also makes the export noticeably
// lighter/faster. Cached by URL+size (module-level, survives across
// captures) since the same handful of images repeat across exports.
const imageDataUriCache = new Map<string, Promise<string | null>>();

/** Fetches `url` and re-encodes it as a small PNG data: URI at `renderPx`
 * (its actual on-screen size, not the source's native resolution) — see
 * the comment above for why this matters for the mobile export. Falls back
 * to `null` (leaving the original remote URL in place) on any fetch/decode
 * failure. */
export function toDataUri(url: string, renderPx: number): Promise<string | null> {
  const key = `${url}@${renderPx}`;
  let cached = imageDataUriCache.get(key);
  if (!cached) {
    cached = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
      .then(
        (blob) =>
          new Promise<string | null>((resolve) => {
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              URL.revokeObjectURL(objectUrl);
              const canvas = document.createElement("canvas");
              canvas.width = renderPx;
              canvas.height = renderPx;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                resolve(null);
                return;
              }
              ctx.drawImage(img, 0, 0, renderPx, renderPx);
              resolve(canvas.toDataURL("image/png"));
            };
            img.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              resolve(null);
            };
            img.src = objectUrl;
          }),
      )
      .catch(() => null);
    imageDataUriCache.set(key, cached);
  }
  return cached;
}

/** Prepares every `<img>` inside `container` for a copy-as-image capture:
 * swaps each remote src for a small same-origin data: URI (see `toDataUri`
 * above) and waits for it to finish loading, bounded by a timeout per image
 * so one stalled/broken image can't hang the whole export. */
export async function loadAllImages(container: HTMLElement, pixelRatio: number, timeoutMs = 4000): Promise<void> {
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("data:")) {
        const renderPx = Math.max(20, Math.round((img.clientWidth || 20) * pixelRatio));
        const dataUri = await toDataUri(src, renderPx);
        if (dataUri) img.src = dataUri;
      }
      if (img.complete) return;
      img.loading = "eager";
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, timeoutMs);
      });
    }),
  );
}

/** Mobile WebKit (iOS Safari) has a documented, still-open bug in
 * html-to-image (github.com/bubkoo/html-to-image issue #591 — reproduced
 * by the library's own maintainers on a real iPhone, on 1.11.13, the exact
 * version this app uses) where a capture containing images comes back with
 * some of them blank under memory pressure, non-deterministically; desktop
 * Chromium isn't affected. A single retry isn't reliable either — the fix
 * that issue converged on, and the one used here, is to recapture until
 * two consecutive attempts come back byte-identical (or a small attempt
 * cap is hit), which reliably lands on a fully-rendered result. This is a
 * no-op extra cost on desktop/anyone unaffected: the very first attempt is
 * already stable there, so the loop exits on the second iteration. */
export async function capturePngStable(node: HTMLElement, options: Parameters<typeof toPng>[1], maxAttempts = 4): Promise<string> {
  let previous: string | null = null;
  let last = "";
  for (let i = 0; i < maxAttempts; i++) {
    last = await toPng(node, options);
    if (previous === last) return last;
    previous = last;
  }
  return last;
}

/** Copies `dataUrl` (a PNG data: URI) to the clipboard, falling back to
 * triggering a download named `filename` when the async Clipboard image
 * API isn't available (e.g. some mobile browsers). Returns which path was
 * taken so callers can drive their own status UI. */
export async function copyOrDownloadPng(dataUrl: string, filename: string): Promise<"copied" | "downloaded"> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      // Clipboard API present but denied/unsupported (permissions policy,
      // browser quirk, etc.) — fall through to the download fallback below.
    }
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
  return "downloaded";
}
