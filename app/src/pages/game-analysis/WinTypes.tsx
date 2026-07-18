// Port of win_types_page_2.py — win-type distribution per season/week.
// Session-4 UX rework (audit §3): comparative KPI trend chart on top with
// all-time average reference lines; the per-group block (KPIs + stacked bar +
// spread scatter) is now an on-demand drill-down for one selected group
// instead of ~22 always-rendered charts; win-type glossary added.
// Quirks preserved from the old page (do not "fix" before parity):
//  - played pick'em games (spread 0 / null spread => Favorite "none") classify as Underdog
//  - played ties (Winner null) fall into the "(No Score)" / "No Favorite" buckets
//  - Favorite Win % / Home Win % denominators include played ties
import { useEffect, useMemo, useRef, useState } from "react";
import { getSchedule, type Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { Card, Segmented } from "../../components/ui";
import { Select } from "../../components/filters/Select";

type Category =
  | "Favorite home"
  | "Favorite away"
  | "Underdog home"
  | "Underdog away"
  | "Favorite Home (No Score)"
  | "Favorite Away (No Score)"
  | "No Favorite";

const CATEGORY_COLORS: Record<Category, string> = {
  "Favorite home": "#3C9A5F",
  "Favorite away": "#2459A7",
  "Underdog home": "#E87722",
  "Underdog away": "#C8102E",
  "Favorite Home (No Score)": "#D4AF37",
  "Favorite Away (No Score)": "#8B4513",
  "No Favorite": "#e0e0e0",
};

const CATEGORY_ORDER: Category[] = [
  "Favorite home",
  "Underdog away",
  "Favorite away",
  "Underdog home",
  "Favorite Home (No Score)",
  "Favorite Away (No Score)",
  "No Favorite",
];

const GLOSSARY: { cat: Category; desc: string }[] = [
  { cat: "Favorite home", desc: "The favorite won and was the home team." },
  { cat: "Favorite away", desc: "The favorite won on the road." },
  { cat: "Underdog home", desc: "The underdog won at home. Also covers pick'em games (no favorite) won by the home team." },
  { cat: "Underdog away", desc: "The underdog won on the road. Also covers pick'em games won by the away team." },
  { cat: "Favorite Home (No Score)", desc: "No winner yet (unplayed game or tie) and the favorite is the home team." },
  { cat: "Favorite Away (No Score)", desc: "No winner yet (unplayed game or tie) and the favorite is the away team." },
  { cat: "No Favorite", desc: "No winner yet and no favorite (pick'em or missing spread)." },
];

const KPI_DEFS = [
  { key: "favHomePct", label: "Favorite is Home %", color: "#3C9A5F" },
  { key: "favWinPct", label: "Favorite Win %", color: "#2459A7" },
  { key: "homeWinPct", label: "Home Win %", color: "#C8102E" },
] as const;
type KpiKey = (typeof KPI_DEFS)[number]["key"];

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
  const winner = !played ? null : hs! > as_! ? "home" : as_! > hs! ? "away" : null;

  // old determine_win_type: only Winner null short-circuits (Favorite is never NaN),
  // so Favorite "none" with a winner falls to the Underdog branch.
  let category: Category;
  if (winner != null) {
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

/** The three block KPIs, same denominators as the old page (ties included). */
function kpis(games: Game[]): Record<KpiKey, number | null> {
  const played = games.filter((g) => g.played);
  return {
    favHomePct: games.length ? (games.filter((g) => g.favorite === "home").length / games.length) * 100 : null,
    favWinPct: played.length
      ? (played.filter((g) => g.winner != null && g.winner === g.favorite).length / played.length) * 100
      : null,
    homeWinPct: played.length ? (played.filter((g) => g.winner === "home").length / played.length) * 100 : null,
  };
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
  selected,
  onSelect,
}: {
  groups: { x: number; k: Record<KpiKey, number | null> }[];
  averages: Record<KpiKey, number | null>;
  xLabel: string;
  selected: number;
  onSelect: (x: number) => void;
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
      yAxis: { type: "value" as const, name: "%", min: 0, max: 100 },
      series: KPI_DEFS.map((d) => ({
        name: d.label,
        type: "line" as const,
        data: groups.map((g) => (g.k[d.key] == null ? null : Number(g.k[d.key]!.toFixed(1)))),
        lineStyle: { color: d.color, width: 2 },
        itemStyle: { color: d.color },
        symbol: "circle",
        symbolSize: (_: unknown, p: { dataIndex: number }) => (groups[p.dataIndex]?.x === selected ? 10 : 5),
        markLine: {
          silent: true,
          symbol: "none",
          data: averages[d.key] == null ? [] : [{ yAxis: Number(averages[d.key]!.toFixed(1)) }],
          lineStyle: { color: d.color, type: "dashed" as const, width: 1, opacity: 0.45 },
          label: { show: true, position: "insideEndTop" as const, fontSize: 9, color: d.color, formatter: "avg {c}%" },
        },
      })),
    };
  }, [groups, averages, xLabel, selected]);

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
              return `${v} | ${Math.round((v / total) * 100)}%`;
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
  const [selSeason, setSelSeason] = useState<number | null>(null);
  const [selWeek, setSelWeek] = useState<number | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  useEffect(() => {
    getSchedule().then(setSchedule);
  }, []);

  // both views use regular-season games only, like the old page
  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const weeks = useMemo(() => [...new Set(reg.map((r) => Number(r.week)))].sort((a, b) => a - b), [reg]);

  const groupValues = mode === "season" ? seasons : weeks;
  const selected = mode === "season" ? (selSeason ?? seasons[0] ?? null) : (selWeek ?? weeks[0] ?? null);
  const setSelected = (x: number) => (mode === "season" ? setSelSeason(x) : setSelWeek(x));

  // KPI per group (trend view) + pooled all-time averages for the reference lines
  const trendGroups = useMemo(() => {
    const key = mode === "season" ? "season" : "week";
    const asc = [...groupValues].sort((a, b) => a - b);
    return asc.map((x) => ({
      x,
      k: kpis(reg.filter((r) => Number(r[key]) === x).map((r) => classify(r, mode === "season" ? "week" : "season"))),
    }));
  }, [reg, groupValues, mode]);
  const averages = useMemo(() => kpis(reg.map((r) => classify(r, "week"))), [reg]);

  const seasonSpan = seasons.length ? `${Math.min(...seasons)}–${Math.max(...seasons)}` : "";
  const detailRows = useMemo(() => {
    if (selected == null) return [];
    const key = mode === "season" ? "season" : "week";
    return reg.filter((r) => Number(r[key]) === selected);
  }, [reg, mode, selected]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Win Types</h1>
        <button
          onClick={() => setGlossaryOpen((o) => !o)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:text-slate-900"
        >
          {glossaryOpen ? "Hide glossary" : "What are win types?"}
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
        <Card title="Win-type glossary" subtitle="How each game is categorized (regular-season games only).">
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {GLOSSARY.map(({ cat, desc }) => (
              <div key={cat} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-slate-200" style={{ background: CATEGORY_COLORS[cat] }} />
                <div>
                  <span className="font-semibold text-slate-800">{cat}</span>
                  <span className="text-slate-500"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Edge cases inherited from the original app: a played pick'em counts as an Underdog win, and played ties stay in the "(No Score)"
            buckets while still counting in the Favorite/Home Win % denominators.
          </p>
        </Card>
      )}

      {!reg.length && <Loading label="Loading schedule…" />}

      {reg.length > 0 && selected != null && (
        <>
          <Card
            title={`KPI trends by ${mode} — ${seasonSpan}`}
            subtitle={
              mode === "season"
                ? "Each point is one season. Dashed lines mark the all-time averages; click a point to open that season below."
                : `Each point pools every Week-N game across all seasons (${seasonSpan}). Dashed lines mark the all-time averages; click a point to open that week below.`
            }
          >
            <TrendChart groups={trendGroups} averages={averages} xLabel={mode === "season" ? "Season" : "Week"} selected={selected} onSelect={setSelected} />
          </Card>

          <div className="flex items-center gap-3">
            <Select
              label={mode === "season" ? "Season detail" : "Week detail"}
              value={String(selected)}
              onChange={(v) => setSelected(Number(v))}
              options={groupValues.map((x) => ({ value: String(x), label: mode === "season" ? String(x) : `Week ${x}` }))}
            />
            {mode === "week" && (
              <span className="text-xs text-slate-400">Week blocks pool all seasons {seasonSpan} for that week number.</span>
            )}
          </div>

          <Block
            key={`${mode}-${selected}`}
            title={mode === "season" ? `Season ${selected}` : `Week ${selected} (all seasons)`}
            rows={detailRows}
            xKey={mode === "season" ? "week" : "season"}
          />
        </>
      )}
    </div>
  );
}
