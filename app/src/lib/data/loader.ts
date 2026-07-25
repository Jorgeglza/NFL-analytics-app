// Typed loaders for the pipeline's JSON extracts.
// Format: compact column-oriented { cols: string[], rows: unknown[][] }.

export interface CompactFrame {
  cols: string[];
  rows: (string | number | null)[][];
}

export type Row = Record<string, string | number | null>;

const cache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`${import.meta.env.BASE_URL}data/${path}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

export function toRecords(frame: CompactFrame): Row[] {
  return frame.rows.map((row) => {
    const rec: Row = {};
    frame.cols.forEach((c, i) => (rec[c] = row[i]));
    return rec;
  });
}

export interface Meta {
  generated_at: string;
  seasons: number[];
  current_season: number;
  counts: Record<string, number>;
}

export const getMeta = () => fetchJson<Meta>("meta.json");
export const getTeams = async () => toRecords(await fetchJson<CompactFrame>("teams.json"));
export const getSchedule = async () => toRecords(await fetchJson<CompactFrame>("schedule.json"));
export const getGrades = async () => toRecords(await fetchJson<CompactFrame>("grades.json"));
export const getFeatureImportance = async () =>
  toRecords(await fetchJson<CompactFrame>("feature_importance.json"));
export const getTeamWeek = async (season: number) =>
  toRecords(await fetchJson<CompactFrame>(`team_week/${season}.json`));
export const getTeamWeekRanks = async (season: number) =>
  toRecords(await fetchJson<CompactFrame>(`team_week_ranks/${season}.json`));
export const getPlayerWeek = async (season: number) =>
  toRecords(await fetchJson<CompactFrame>(`player_week/${season}.json`));

// Predictive Model page (P2) — own subfolder, isolated pipeline package
// (pipeline/predictive_model/export_page.py). See docs/predictive-model.md.
export const getPredictiveModelGames = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/games.json"));
export const getPredictiveModelSeasonSummary = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/season_summary.json"));
export const getPredictiveModelImportance = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/importance.json"));

export interface PredictiveModelCalibration {
  table: CompactFrame;
  correlation: number | null;
  residual_pool: number[];
  residual_diagnostics: CompactFrame;
}
export const getPredictiveModelCalibration = () =>
  fetchJson<PredictiveModelCalibration>("predictive_model/calibration.json");

export interface PredictiveModelMeta {
  generated_at: string;
  test_seasons: number[];
  n_features: number;
  model: string;
}
export const getPredictiveModelMeta = () => fetchJson<PredictiveModelMeta>("predictive_model/meta.json");

export interface ContribParams {
  [gradeType: string]: {
    mode: "offense" | "defense" | "overall";
    features: string[];
    data_min: number[];
    data_max: number[];
    importance: number[];
  };
}
export const getContribParams = () => fetchJson<ContribParams>("contrib_params.json");
