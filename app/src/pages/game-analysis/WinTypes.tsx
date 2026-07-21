// Port of win_types_page_2.py — win-type distribution per season/week.
// Session-4 UX rework (audit §3): comparative KPI trend chart on top with
// all-time average reference lines; the per-group block (KPIs + stacked bar +
// spread scatter) is now an on-demand drill-down for one selected group
// instead of ~22 always-rendered charts; win-type glossary added.
// Quirks preserved from the old page (do not "fix" before parity):
//  - played pick'em games (spread 0 / null spread => Favorite "none") classify as Underdog
// Deviation from the old page (explicit user request, 2026-07-20): ties now get
// their own "Tie" category (previously lumped into the "(No Score)" buckets
// alongside unplayed games) and are excluded entirely from the Favorite Win % /
// Home Win % denominators (previously counted as a favorite loss).
import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import { getSchedule, type Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { Card, Segmented } from "../../components/ui";
import { LazyMount } from "../../components/LazyMount";
import { Glossary } from "../../components/Glossary";
import { GLOSSARY_SECTIONS } from "../../lib/glossary";
import { CATEGORY_COLORS, CATEGORY_CODES, type Category } from "../../lib/logic/winType";

const CATEGORY_ORDER: Category[] = [
  "Favorite home",
  "Underdog away",
  "Favorite away",
  "Underdog home",
  "Tie",
  "Favorite Home (No Score)",
  "Favorite Away (No Score)",
  "No Favorite",
];

const KPI_DEFS = [
  { key: "favHomePct", label: "Favorite is Home %", color: "#3C9A5F" },
  { key: "favWinPct", label: "Favorite Win %", color: "#2459A7" },
  { key: "homeWinPct", label: "Home Win %", color: "#C8102E" },
] as const;
type KpiKey = (typeof KPI_DEFS)[number]["key"];

// Colors deliberately outside the win-type category palette (KPI trend lines,
// not win-type categories — the stacked bars below are where color=category,
// and their segments now carry a code label too, not just color).
const SPLIT_DEFS = [
  { key: "homeFavWinPct", label: "Home favorites Win %", color: "#002f6c" },
  { key: "awayFavWinPct", label: "Away favorites Win %", color: "#7c3aed" },
] as const;
type SplitKey = (typeof SPLIT_DEFS)[number]["key"];

interface Game {
  gameId: string;
  x: number; // week (season mode) or season (week mode)
  spread: number | null;
  favorite: "home" | "away" | "none";
  winner: "home" | "away" | null;
  winnerTeam: string | null;
  played: boolean;
  category: Category;
}

function classify(r: Row, xKey: "week" | "season"): Game {
  const spread = r.spread_line == null ? null : Number(r.spread_line);
  // matches pandas: NaN comparisons are false -> "none"
  const favorite = spread != null && spread < 0 ? "home" : spread != null && spread > 0 ? "away" : "none";
  const hs = r.home_score == null ? null : Number(r.home_score);
  const as_ = r.away_score == null ? null : Number(r.away_score);
  const played = hs != null && as_ != null;
  const tie = played && hs === as_;
  const winner = !played || tie ? null : hs! > as_! ? "home" : as_! > hs! ? "away" : null;

  // Tie gets its own category (not lumped into "(No Score)" with unplayed
  // games). Everything else: old determine_win_type — only Winner null
  // short-circuits (Favorite is never NaN), so Favorite "none" with a winner
  // falls to the Underdog branch.
  let category: Category;
  if (tie) {
    category = "Tie";
  } else if (winner != null) {
    if (winner === favorite) category = winner === "home" ? "Favorite home" : "Favorite away";
    else category = winner === "home" ? "Underdog home" : "Underdog away";
  } else {
    category =
      favorite === "home"
        ? "Favorite Home (No Score)"
        : favorite === "away"
          ? "Favorite Away (No Score)"
          : "No Favorite";
  }

  return {
    gameId: String(r.game_id),
    x: Number(r[xKey]),
    spread,
    favorite,
    winner,
    winnerTeam: winner === "home" ? String(r.home_team) : winner === "away" ? String(r.away_team) : null,
    played,
    category,
  };
}

/** The three block KPIs. Favorite Win % / Home Win % exclude ties entirely
 *  (2026-07-20: ties are their own category now, not a favorite loss). */
function kpis(games: Game[]): Record<KpiKey, number | null> {
  const played = games.filter((g) => g.played && g.category !== "Tie");
  return {
    favHomePct: games.length ? (games.filter((g) => g.favorite === "home").length / games.length) * 100 : null,
    favWinPct: played.length
      ? (played.filter((g) => g.winner != null && g.winner === g.favorite).length / played.length) * 100
      : null,
    homeWinPct: played.length ? (played.filter((g) => g.winner === "home").length / played.length) * 100 : null,
  };
}

/** Favorite Win % split by where the favorite played. Played, non-tie games
 *  only (same convention as kpis()); pick'ems excluded. */
function splitKpis(games: Game[]): Record<SplitKey, number | null> {
  const rate = (side: "home" | "away") => {
    const pool = games.filter((g) => g.played && g.category !== "Tie" && g.favorite === side);
    return pool.length ? (pool.filter((g) => g.winner === g.favorite).length / pool.length) * 100 : null;
  };
  return { homeFavWinPct: rate("home"), awayFavWinPct: rate("away") };
}

const pct = (v: number | null) => (v == null ? "N/A" : `${Math.round(v)}%`);

function Kpi({ label, value, border }: { label: string; value: string; border: string }) {
  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm" style={{ borderTop: `3px solid ${border}` }}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-[22px] font-bold text-slate-900">{value}</div>
    </div>
  );
}

/** Cross-group KPI trend lines with dashed all-time average reference lines. */
function TrendChart({
  groups,
  averages,
  xLabel,
  onSelect,
  defs = KPI_DEFS,
}: {
  groups: { x: number; k: Record<string, number | null> }[];
  averages: Record<string, number | null>;
  xLabel: string;
  onSelect: (x: number) => void;
  defs?: readonly { key: string; label: string; color: string }[];
}) {
  const option = useMemo(() => {
    if (!groups.length) return null;
    return {
      grid: { left: 10, right: 15, top: 34, bottom: 10, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis" as const,
        valueFormatter: (v: unknown) => (v == null ? "N/A" : `${Number(v).toFixed(1)}%`),
      },
      xAxis: {
        type: "category" as const,
        data: groups.map((g) => String(g.x)),
        name: xLabel,
        nameLocation: "middle" as const,
        nameGap: 26,
        triggerEvent: true,
      },
      // auto-scale around the data (a fixed 0–100 axis flattens 50–70% swings into noise)
      yAxis: {
        type: "value" as const,
        name: "%",
        min: (v: { min: number }) => Math.max(0, Math.floor((v.min - 3) / 5) * 5),
        max: (v: { max: number }) => Math.min(100, Math.ceil((v.max + 3) / 5) * 5),
      },
      series: defs.map((d) => ({
        name: d.label,
        type: "line" as const,
        data: groups.map((g) => (g.k[d.key] == null ? null : Number(g.k[d.key]!.toFixed(1)))),
        lineStyle: { color: d.color, width: 2 },
        itemStyle: { color: d.color },
        symbol: "circle",
        symbolSize: 6,
        markLine: {
          silent: true,
          symbol: "none",
          data: averages[d.key] == null ? [] : [{ yAxis: Number(averages[d.key]!.toFixed(1)) }],
          lineStyle: { color: d.color, type: "dashed" as const, width: 1, opacity: 0.45 },
          label: { show: true, position: "insideEndTop" as const, fontSize: 9, color: d.color, formatter: "avg {c}%" },
        },
      })),
    };
  }, [groups, averages, xLabel, defs]);

  // the click handler is bound once at chart init — route through a ref so it
  // always sees the latest onSelect (mode changes swap the setter without remounting)
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const ref = useECharts(option, {
    onInit: (chart) => {
      chart.on("click", (p: { name?: string; value?: unknown }) => {
        // series point clicks carry the category in `name`; axis-label clicks in `value`
        const n = Number(p.name ?? p.value);
        if (Number.isFinite(n)) onSelectRef.current(n);
      });
    },
  });
  return <div ref={ref} className="h-[320px]" />;
}

/** 100%-stacked win-type mix per group — shows how the outcome composition
 *  shifts across seasons/weeks at a glance. */
function MixChart({
  groups,
  xLabel,
  onSelect,
}: {
  groups: { x: number; counts: Map<Category, number>; total: number }[];
  xLabel: string;
  onSelect: (x: number) => void;
}) {
  const option = useMemo(() => {
    if (!groups.length) return null;
    const present = CATEGORY_ORDER.filter((c) => groups.some((g) => (g.counts.get(c) ?? 0) > 0));
    return {
      grid: { left: 10, right: 15, top: 34, bottom: 10, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (ps: { seriesName: string; name: string; value: unknown; dataIndex: number }[]) => {
          const g = groups[ps[0]?.dataIndex ?? 0];
          const lines = ps
            .filter((p) => Number(p.value) > 0)
            .map((p) => `${p.seriesName}: ${g.counts.get(p.seriesName as Category) ?? 0} (${Number(p.value).toFixed(1)}%)`);
          return `${xLabel} ${ps[0]?.name} — ${g.total} games<br/>${lines.join("<br/>")}`;
        },
      },
      xAxis: {
        type: "category" as const,
        data: groups.map((g) => String(g.x)),
        name: xLabel,
        nameLocation: "middle" as const,
        nameGap: 26,
        triggerEvent: true,
      },
      yAxis: { type: "value" as const, name: "% of games", max: 100 },
      series: present.map((cat) => ({
        name: cat,
        type: "bar" as const,
        stack: "mix",
        barMaxWidth: 34,
        data: groups.map((g) => (g.total ? Number((((g.counts.get(cat) ?? 0) / g.total) * 100).toFixed(1)) : 0)),
        itemStyle: { color: CATEGORY_COLORS[cat] },
        label: {
          show: true,
          fontSize: 8,
          color: "#000",
          formatter: (p: { value?: unknown }) => (Number(p.value) >= 5 ? `${CATEGORY_CODES[cat]} ${Math.round(Number(p.value))}%` : ""),
        },
      })),
    } as unknown as EChartsOption;
  }, [groups, xLabel]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const ref = useECharts(option, {
    onInit: (chart) => {
      chart.on("click", (p: { name?: string; value?: unknown }) => {
        const n = Number(p.name ?? p.value);
        if (Number.isFinite(n)) onSelectRef.current(n);
      });
    },
  });
  return <div ref={ref} className="h-[300px]" />;
}

/** One bordered block (a season or a week): KPIs + stacked bar + spread scatter. */
function Block({ title, rows, xKey }: { title: string; rows: Row[]; xKey: "week" | "season" }) {
  const games = useMemo(() => rows.map((r) => classify(r, xKey)), [rows, xKey]);
  const xLabel = xKey === "week" ? "Week" : "Season";

  const { favHomePct, favWinPct, homeWinPct } = useMemo(() => kpis(games), [games]);

  const xs = useMemo(() => [...new Set(games.map((g) => g.x))].sort((a, b) => a - b), [games]);

  const barOption = useMemo(() => {
    if (!games.length) return null;
    const present = CATEGORY_ORDER.filter((c) => games.some((g) => g.category === c));
    const counts = new Map<string, number>(); // `${x}|${cat}`
    const totals = new Map<number, number>();
    for (const g of games) {
      counts.set(`${g.x}|${g.category}`, (counts.get(`${g.x}|${g.category}`) ?? 0) + 1);
      totals.set(g.x, (totals.get(g.x) ?? 0) + 1);
    }
    const homeFav = xs.map((x) => games.filter((g) => g.x === x && g.favorite === "home").length);

    return {
      grid: { left: 10, right: 10, top: 60, bottom: 10, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
      xAxis: { type: "category" as const, data: xs.map(String), name: xLabel, nameLocation: "middle" as const, nameGap: 26 },
      yAxis: { type: "value" as const, name: "Games" },
      series: [
        ...present.map((cat) => ({
          name: cat,
          type: "bar" as const,
          stack: "total",
          data: xs.map((x) => counts.get(`${x}|${cat}`) ?? 0),
          itemStyle: { color: CATEGORY_COLORS[cat] },
          label: {
            show: true,
            fontSize: 8,
            color: "#000",
            formatter: (p: { value?: unknown; name: string }) => {
              const v = Number(p.value);
              const total = totals.get(Number(p.name)) ?? 0;
              if (!v || !total) return "";
              return `${CATEGORY_CODES[cat]} ${v} | ${Math.round((v / total) * 100)}%`;
            },
          },
        })),
        {
          name: "Home Favorite Games",
          type: "line" as const,
          data: homeFav,
          lineStyle: { color: "#000", width: 2, type: "dashed" as const },
          itemStyle: { color: "#000" },
          symbolSize: 6,
        },
      ],
    };
  }, [games, xs, xLabel]);

  const scatterOption = useMemo(() => {
    const pts = games.filter((g) => g.spread != null);
    if (!pts.length) return null;

    // collide points at same (x, spread rounded to 2), like the old page
    const groups = new Map<string, Game[]>();
    for (const g of pts) {
      const key = `${g.x}|${g.spread!.toFixed(2)}`;
      groups.set(key, [...(groups.get(key) ?? []), g]);
    }
    const singles: Game[] = [];
    const overlaps: Game[][] = [];
    for (const grp of groups.values()) (grp.length > 1 ? overlaps.push(grp) : singles.push(grp[0]));

    const majorityColors = (grp: Game[]) => {
      const c = new Map<Category, number>();
      for (const g of grp) c.set(g.category, (c.get(g.category) ?? 0) + 1);
      const sorted = [...c.entries()].sort((a, b) => b[1] - a[1]);
      const fill = CATEGORY_COLORS[sorted[0][0]];
      const border = sorted.length > 1 ? CATEGORY_COLORS[sorted[1][0]] : fill;
      return { fill, border };
    };

    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: { trigger: "item" as const },
      xAxis: { type: "category" as const, data: xs.map(String), name: xLabel, nameLocation: "middle" as const, nameGap: 26 },
      yAxis: { type: "value" as const, name: "Spread" },
      series: [
        {
          type: "scatter" as const,
          symbolSize: 8,
          data: singles.map((g) => ({
            value: [String(g.x), g.spread],
            itemStyle: { color: CATEGORY_COLORS[g.category], opacity: 0.7 },
            tooltip: {
              formatter: () =>
                `Game ID: ${g.gameId}<br/>Category: ${g.category}<br/>${xLabel}: ${g.x} | Spread: ${g.spread}`,
            },
          })),
        },
        {
          type: "scatter" as const,
          symbolSize: 9,
          data: overlaps.map((grp) => {
            const { fill, border } = majorityColors(grp);
            return {
              value: [String(grp[0].x), grp[0].spread],
              itemStyle: { color: fill, borderColor: border, borderWidth: 2, opacity: 0.95 },
              label: { show: true, position: "top" as const, fontSize: 7, formatter: `×${grp.length}` },
              tooltip: {
                formatter: () =>
                  grp
                    .map((g) => `${g.gameId} | Winner: ${g.winnerTeam ?? "None"} | Win Type: ${g.category} | Spread: ${g.spread}`)
                    .join("<br/>"),
              },
            };
          }),
        },
      ],
    };
  }, [games, xs, xLabel]);

  const barRef = useECharts(barOption);
  const scatterRef = useECharts(scatterOption);

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4 pt-5 shadow-sm">
      <div className="absolute -top-3 left-4 bg-white px-2 text-lg font-semibold text-slate-900">{title}</div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex shrink-0 flex-row gap-3 lg:w-40 lg:flex-col">
          <Kpi label="Favorite is Home %" value={pct(favHomePct)} border="#3C9A5F" />
          <Kpi label="Favorite Win %" value={pct(favWinPct)} border="#2459A7" />
          <Kpi label="Home Win %" value={pct(homeWinPct)} border="#C8102E" />
        </div>
        <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-3">
          <div ref={barRef} className="h-[460px] lg:col-span-2" />
          <div ref={scatterRef} className="h-[460px]" />
        </div>
      </div>
    </div>
  );
}

export default function WinTypes() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [mode, setMode] = useState<"season" | "week">("season");
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  useEffect(() => {
    getSchedule().then(setSchedule);
  }, []);

  // both views use regular-season games only, like the old page
  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const weeks = useMemo(() => [...new Set(reg.map((r) => Number(r.week)))].sort((a, b) => a - b), [reg]);

  const groupValues = mode === "season" ? seasons : weeks;

  // KPIs + category counts per group (summary charts) + pooled all-time averages
  const trendGroups = useMemo(() => {
    const key = mode === "season" ? "season" : "week";
    const asc = [...groupValues].sort((a, b) => a - b);
    return asc.map((x) => {
      const games = reg.filter((r) => Number(r[key]) === x).map((r) => classify(r, mode === "season" ? "week" : "season"));
      const counts = new Map<Category, number>();
      for (const g of games) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
      return { x, k: kpis(games), split: splitKpis(games), counts, total: games.length };
    });
  }, [reg, groupValues, mode]);
  const allGames = useMemo(() => reg.map((r) => classify(r, "week")), [reg]);
  const averages = useMemo(() => kpis(allGames), [allGames]);
  const splitAverages = useMemo(() => splitKpis(allGames), [allGames]);
  const splitGroups = useMemo(() => trendGroups.map((g) => ({ x: g.x, k: g.split })), [trendGroups]);

  const seasonSpan = seasons.length ? `${Math.min(...seasons)}–${Math.max(...seasons)}` : "";

  // display order of the blocks (seasons newest-first, weeks ascending, as before)
  const blockValues = groupValues;
  // Instant jump + a delayed correction: blocks lazy-mount during the jump and
  // their real height differs slightly from the placeholder, shifting the target.
  const scrollToBlock = (x: number) => {
    const el = () => document.getElementById(`wt-block-${mode}-${x}`);
    // dispatching scroll nudges the LazyMount fallback in environments where
    // programmatic scrolling emits no scroll event
    const jump = () => {
      el()?.scrollIntoView({ block: "start" });
      window.dispatchEvent(new Event("scroll"));
    };
    jump();
    setTimeout(jump, 350);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Win Types</h1>
        <button
          onClick={() => setGlossaryOpen((o) => !o)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:text-slate-900"
        >
          {glossaryOpen ? "Hide glossary" : "What do these terms mean?"}
        </button>
        <Segmented
          label="Group by"
          value={mode}
          onChange={setMode}
          options={[
            { value: "season", label: "Season" },
            { value: "week", label: "Week" },
          ]}
        />
      </div>

      {glossaryOpen && (
        <Card title="App glossary" subtitle="Win types, stat definitions, and betting/model terms used throughout the app — same content as the Grading Model's Features tab.">
          <Glossary sections={GLOSSARY_SECTIONS} />
          <p className="mt-4 text-xs text-slate-400">
            Edge case inherited from the original app: a played pick'em counts as an Underdog win. Ties get their own "Tie" category and are
            excluded entirely from the Favorite Win % / Home Win % percentages — the "(No Score)" buckets now mean unplayed only.
          </p>
        </Card>
      )}

      {!reg.length && <Loading label="Loading schedule…" />}

      {reg.length > 0 && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title={`KPI trends by ${mode} — ${seasonSpan}`}
              subtitle={
                mode === "season"
                  ? "Each point is one season. Dashed lines mark the all-time averages; click a point to jump to that season below."
                  : `Each point pools every Week-N game across all seasons (${seasonSpan}). Dashed lines mark the all-time averages; click a point to jump to that week below.`
              }
            >
              <TrendChart groups={trendGroups} averages={averages} xLabel={mode === "season" ? "Season" : "Week"} onSelect={scrollToBlock} />
            </Card>
            <Card
              title={`Win-type mix by ${mode}`}
              subtitle="Share of games per win type — watch categories widen or shrink over time. Click a bar to jump to its detail block."
            >
              <MixChart groups={trendGroups} xLabel={mode === "season" ? "Season" : "Week"} onSelect={scrollToBlock} />
            </Card>
          </div>

          <Card
            title="Favorite Win % — home vs away favorites"
            subtitle="Splits the Favorite Win % KPI by where the favorite played. Played, non-tie games only; pick'em games (no favorite) excluded. A shrinking gap between the lines means home-field advantage is eroding. Click a point to jump to its block."
          >
            <TrendChart
              groups={splitGroups}
              averages={splitAverages}
              xLabel={mode === "season" ? "Season" : "Week"}
              onSelect={scrollToBlock}
              defs={SPLIT_DEFS}
            />
          </Card>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">Jump to</span>
            {blockValues.map((x) => (
              <button
                key={x}
                onClick={() => scrollToBlock(x)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-[#002f6c] hover:text-[#002f6c]"
              >
                {mode === "season" ? x : `Wk ${x}`}
              </button>
            ))}
            {mode === "week" && (
              <span className="ml-2 text-xs text-slate-400">Week blocks pool all seasons {seasonSpan} for that week number.</span>
            )}
          </div>

          <div className="space-y-8">
            {blockValues.map((x) => (
              <div key={`${mode}-${x}`} id={`wt-block-${mode}-${x}`} className="scroll-mt-20">
                <LazyMount minHeight={500}>
                  <Block
                    title={mode === "season" ? `Season ${x}` : `Week ${x} (all seasons)`}
                    rows={reg.filter((r) => Number(r[mode === "season" ? "season" : "week"]) === x)}
                    xKey={mode === "season" ? "week" : "season"}
                  />
                </LazyMount>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
