// Shared metric list + reshaping for the Team Trends page — new analytics,
// not a port. Pulls a curated subset of grades.json + team_week/{season}.json
// columns (both already loaded elsewhere in the app, just never charted as a
// weekly time series) rather than exposing all ~190 team_week columns, plus
// the Power Rankings composite/Elo/Pythagorean signals for direct comparison
// against the ranking that brought the user here via "Compare".
import type { Row } from "../../../lib/data/loader";
import type { PowerRankingRow } from "../../../lib/logic/powerRankings";

export type MetricSource = "grades" | "team_week" | "power";

export interface MetricDef {
  key: string;
  label: string;
  source: MetricSource;
  col: string;
  /** Multiplier applied to raw values (e.g. composite/pythPct are stored 0-1; scale to 0-100 for display). */
  scale?: number;
}

export const POWER_METRICS: MetricDef[] = [
  { key: "composite", label: "Composite Score", source: "power", col: "composite", scale: 100 },
  { key: "elo", label: "Elo Rating", source: "power", col: "elo" },
  { key: "pyth", label: "Pythagorean Win%", source: "power", col: "pythPct", scale: 100 },
];

export const METRICS: MetricDef[] = [
  ...POWER_METRICS,
  { key: "overall_grade", label: "Overall Grade", source: "grades", col: "Overall Grade" },
  { key: "offensive_grade", label: "Offensive Grade", source: "grades", col: "Offensive Grade" },
  { key: "defensive_grade", label: "Defensive Grade", source: "grades", col: "Defensive Grade" },
  { key: "points", label: "Points Scored", source: "team_week", col: "points" },
  { key: "points_allowed", label: "Points Allowed", source: "team_week", col: "points_allowed" },
  { key: "points_margin", label: "Point Margin", source: "team_week", col: "points_margin" },
  { key: "total_yards", label: "Total Yards", source: "team_week", col: "total_yards" },
  { key: "total_yards_allowed", label: "Total Yards Allowed", source: "team_week", col: "total_yards_allowed" },
  { key: "turnover_margin", label: "Turnover Margin", source: "team_week", col: "turnover_margin" },
  { key: "epa_diff", label: "EPA Differential", source: "team_week", col: "epa_diff" },
];

export interface WeeklyPoint {
  week: number;
  value: number;
}

/**
 * Weekly series for one team/metric, sorted by week. `powerRankingsByWeek`
 * (week -> that week's full computePowerRankings() result) is only needed
 * for `source: "power"` metrics — composite/elo/pythPct aren't columns in
 * any loaded frame, they're derived, so the caller precomputes them once for
 * the season and passes the map in rather than recomputing per team/metric.
 */
export function seriesFor(
  metric: MetricDef,
  team: string,
  season: number,
  gradesRows: Row[],
  teamWeekRows: Row[],
  powerRankingsByWeek?: Map<number, PowerRankingRow[]>,
): WeeklyPoint[] {
  if (metric.source === "power") {
    if (!powerRankingsByWeek) return [];
    const rows: WeeklyPoint[] = [];
    for (const [week, ranking] of powerRankingsByWeek) {
      const row = ranking.find((r) => r.team === team);
      const raw = row ? (row[metric.col as keyof PowerRankingRow] as number | null) : null;
      if (raw != null) rows.push({ week, value: raw * (metric.scale ?? 1) });
    }
    return rows.sort((a, b) => a.week - b.week);
  }
  const rows =
    metric.source === "grades"
      ? gradesRows
          .filter((r) => String(r.Team) === team && Number(r.Season) === season && r[metric.col] != null)
          .map((r) => ({ week: Number(r.Week), value: Number(r[metric.col]) }))
      : teamWeekRows
          .filter((r) => String(r.team) === team && r[metric.col] != null)
          .map((r) => ({ week: Number(r.week), value: Number(r[metric.col]) }));
  return rows.sort((a, b) => a.week - b.week);
}
