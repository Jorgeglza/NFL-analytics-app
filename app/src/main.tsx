import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// On a phone, every fresh open/reload (incl. iOS restoring a tab that
// crashed on a heavy page) starts on Home rather than wherever the tab was.
// Runs once per real page load, so in-app navigation and Back/Forward are
// untouched; ≥640px (the app's `sm` line, see lib/useIsMobileViewport.ts)
// keeps deep links/bookmarks exactly as before.
if (window.matchMedia("(max-width: 639px)").matches && location.hash && location.hash !== "#/") {
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);
}

// HashRouter keeps deep links working on static hosts without SPA fallbacks.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
