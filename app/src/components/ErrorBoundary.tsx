// App-level error boundary (audit B6): without one, a render exception in any
// page unmounts the whole tree and leaves a blank white screen. App.tsx passes
// the pathname as resetKey, so navigating to another page clears the error.
//
// Also covers a lazy page chunk failing to load (e.g. a stale tab after a new
// deploy replaced the hashed chunk files) — a reload fixes that case.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // Clear the error when resetKey (the pathname) changes. Not done with a
  // React `key`, which would remount every page on its own tab sub-routes.
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-2xl">⚠️</div>
        <h1 className="mt-4 text-xl font-bold text-slate-800">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-slate-500">
          Reloading usually fixes it — especially right after the site has been updated.
        </p>
        <p className="mt-2 break-words text-xs text-slate-500">{this.state.error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-full bg-[#002f6c] px-5 py-2 text-sm font-semibold text-white shadow-sm sm:min-h-0"
          >
            Reload page
          </button>
          <Link
            to="/"
            onClick={() => this.setState({ error: null })}
            className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-[#002f6c] shadow-sm sm:min-h-0"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#002f6c]/8 text-2xl">🧭</div>
      <h1 className="mt-4 text-xl font-bold text-slate-800">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">That link doesn't match any page — it may be mistyped or from an old bookmark.</p>
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[#002f6c] px-5 py-2 text-sm font-semibold text-white shadow-sm sm:min-h-0"
      >
        Go to Home
      </Link>
    </div>
  );
}
