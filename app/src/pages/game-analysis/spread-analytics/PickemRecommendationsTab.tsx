// "Pick'em Recommendations" tab of Spread Analytics — a weekly favorite /
// coin-flip decision tool (Recommendations) plus a recolored retelling of
// the "Model vs. the Pool" pick'em analysis (The Story). See
// pickem/RecommendationsView.tsx and pickem/StoryView.tsx for the two views.
// Each sub-view gets its own linkable URL via a `view` query param — same
// pattern as Model Backtest's tab sync (ModelBacktest.tsx).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "../../../components/ui";
import RecommendationsView from "./pickem/RecommendationsView";
import ThisWeekView from "./pickem/ThisWeekView";
import StoryView from "./pickem/StoryView";

type View = "Recommendations" | "This Week" | "The Story";

const VIEW_SLUGS: Record<string, View> = {
  recommendations: "Recommendations",
  this_week: "This Week",
  story: "The Story",
};
const VIEW_TO_SLUG: Record<View, string> = {
  Recommendations: "recommendations",
  "This Week": "this_week",
  "The Story": "story",
};

export default function PickemRecommendationsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<View>(VIEW_SLUGS[searchParams.get("view") ?? ""] ?? "Recommendations");

  // `setSearchParams` is deliberately not a dependency: react-router gives it
  // a new identity on every URL change, so including it would re-run this
  // effect (and re-stamp `view` back onto the URL) after any navigation at
  // all — including a browser Back/Forward that had just intentionally
  // changed it. See Model Backtest's identical fix for the full writeup.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", VIEW_TO_SLUG[view]);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSearchParams intentionally excluded, see comment above
  }, [view]);

  // The effect above only writes view -> URL. Without a matching reader,
  // browser back/forward changes the URL/history entry but leaves this
  // component's own `view` state — and therefore what's on screen — stuck on
  // whatever was last set via setView. Re-derive it from the URL whenever the
  // URL's own view slug changes to something this state doesn't already reflect.
  const urlViewSlug = searchParams.get("view");
  useEffect(() => {
    const urlView = VIEW_SLUGS[urlViewSlug ?? ""];
    if (urlView && urlView !== view) setView(urlView);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when the URL's own view slug changes
  }, [urlViewSlug]);

  return (
    <div className="space-y-4">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "Recommendations", label: "Recommendations" },
          { value: "This Week", label: "This Week" },
          { value: "The Story", label: "The Story" },
        ]}
      />
      {view === "Recommendations" ? <RecommendationsView /> : view === "This Week" ? <ThisWeekView /> : <StoryView />}
    </div>
  );
}
