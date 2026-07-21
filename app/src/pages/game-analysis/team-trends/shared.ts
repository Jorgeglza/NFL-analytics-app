// Shared metric list + reshaping for the Team Trends page — new analytics,
// not a port. Pulls a curated subset of grades.json + team_week/{season}.json
// columns (both already loaded elsewhere in the app, just never charted as a
// weekly time series) rather than exposing all ~190 team_week columns.
import type { Row } from "../../../lib/data/loader";

export type MetricSource = "grades" | "team_week";

export interface MetricDef {
  key: string;
  label: string;
  source: MetricSource;
  col: string;
}

export const METRICS: MetricDef[] = [
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

/** Weekly series for one team/metric, sorted by week. */
export function seriesFor(metric: MetricDef, team: string, season: number, gradesRows: Row[], teamWeekRows: Row[]): WeeklyPoint[] {
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
