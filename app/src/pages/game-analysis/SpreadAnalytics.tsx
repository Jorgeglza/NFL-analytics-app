// Spread Analytics — tabbed shell (route pattern copied from SeasonOutlook.tsx:
// useParams<{tab}> + slug<->label maps + redirect-bare-path-to-default effect,
// so each tab gets its own linkable sub-URL and the old bare
// /game_analysis/spread_win_percentage path keeps working for bookmarks/nav).
// Tab 1 (Win Rate & Calibration) is the original page, unchanged — see
// spread-analytics/WinRateTab.tsx's header for its own porting notes. Tab 2
// (Weekly Breakdown) is new: per-week spread/upset analytics. Tab 3 (Win
// Types) was previously its own nav page (game_analysis/win_types); folded
// in here 2026-08-03 as another statistical lens on the same favorite/
// underdog question, and Spread Analytics moved up to #2 in Game Analysis
// (see nav.ts) as part of the same change.
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { TabBar } from "../../components/TabBar";
import { InfoDot } from "../../components/InfoDot";
import WinRateTab from "./spread-analytics/WinRateTab";
import WeeklyBreakdownTab from "./spread-analytics/WeeklyBreakdownTab";
import WinTypesTab from "./spread-analytics/WinTypesTab";

const TABS = [
  ["Win Rate & Calibration", "win_rate", "📈", "Favorite win rates by spread bucket — calibration curve, lift, outcome mix and Weekly Picks"],
  ["Weekly Breakdown", "weekly_breakdown", "🗓️", "Spread-by-game view for one week, upset-rate-by-rank and upset candidates"],
  ["Win Types", "win_types", "🥧", "Win-type distribution across seasons and weeks with favorite/home KPIs"],
] as const;
type Tab = (typeof TABS)[number][0];
const SLUG_TO_TAB = new Map<string, Tab>(TABS.map(([t, slug]) => [slug, t]));
const DEFAULT_TAB: Tab = TABS[0][0];

export default function SpreadAnalytics() {
  const { tab: tabSlug } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const tab: Tab = (tabSlug && SLUG_TO_TAB.get(tabSlug)) || DEFAULT_TAB;
  const setTab = (t: Tab) => {
    const slug = TABS.find(([label]) => label === t)![1];
    navigate(`/game_analysis/spread_win_percentage/${slug}`);
  };

  usePageTitle(`Spread Analytics — ${tab}`);

  // Redirect bare/unknown sub-paths (e.g. the old bare page link) to the default tab.
  useEffect(() => {
    if (!tabSlug || !SLUG_TO_TAB.has(tabSlug)) navigate(`/game_analysis/spread_win_percentage/${TABS[0][1]}`, { replace: true });
  }, [tabSlug, navigate]);

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]">
        <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
        Spread Analytics
        <InfoDot text="For the season's full outlook, see Season Outlook. For a specific upcoming game, see what the model recommends on Matchup Previews." />
      </h1>

      <TabBar tabs={TABS.map(([t, , icon, desc]) => [t, icon, desc] as const)} active={tab} onChange={setTab} gridClassName="sm:grid-cols-3" />

      {tab === "Win Rate & Calibration" ? <WinRateTab /> : tab === "Weekly Breakdown" ? <WeeklyBreakdownTab /> : <WinTypesTab />}
    </div>
  );
}
