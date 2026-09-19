// "Pick'em Recommendations" tab of Spread Analytics — a weekly favorite /
// coin-flip decision tool (Recommendations) plus a recolored retelling of
// the "Model vs. the Pool" pick'em analysis (The Story). See
// pickem/RecommendationsView.tsx and pickem/StoryView.tsx for the two views.
import { useState } from "react";
import { Segmented } from "../../../components/ui";
import RecommendationsView from "./pickem/RecommendationsView";
import ThisWeekView from "./pickem/ThisWeekView";
import StoryView from "./pickem/StoryView";

type View = "Recommendations" | "This Week" | "The Story";

export default function PickemRecommendationsTab() {
  const [view, setView] = useState<View>("Recommendations");

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
