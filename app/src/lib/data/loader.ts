// Typed loaders for the pipeline's JSON extracts.
// Format: compact column-oriented { cols: string[], rows: unknown[][] }.

export interface CompactFrame {
  cols: string[];
  rows: (string | number | null)[][];
}

export type Row = Record<string, string | number | null>;

const cache = new Map<string, Promise<unknown>>();

const FETCH_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A reachable server responding with a real HTTP error (404/500/…) won't
// resolve itself on retry — only a stalled/dropped connection (timeout,
// abort, or a fetch-level TypeError) is worth retrying.
function isRetryable(err: unknown): boolean {
  return !(err instanceof Error && err.message.startsWith("Failed to load"));
}

async function fetchOnce<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/${path}`, { signal: controller.signal });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const attempt = (async () => {
      let lastErr: unknown;
      for (let i = 0; i <= MAX_RETRIES; i++) {
        try {
          return await fetchOnce<T>(path);
        } catch (err) {
          lastErr = err;
          if (!isRetryable(err) || i === MAX_RETRIES) throw err;
          await sleep(500 * 2 ** i);
        }
      }
      throw lastErr;
    })();
    // Don't cache a failed request forever — a dropped connection that
    // exhausts its retries should be retryable again on the next call (e.g.
    // a user-triggered "Retry"), not permanently stuck for the rest of the
    // SPA session the way an in-memory cache normally implies.
    attempt.catch(() => cache.delete(path));
    cache.set(path, attempt);
  }
  return cache.get(path) as Promise<T>;
}

// `cols` (optional) projects the expansion down to a subset of the frame's
// columns — every row still carries ~100+ keys otherwise, which is the
// actual memory/CPU cost on a low-RAM phone (the network payload is
// unaffected either way, since `fetchJson` caches the full parsed frame).
export function toRecords(frame: CompactFrame, cols?: string[]): Row[] {
  const useCols = cols ? cols.filter((c) => frame.cols.includes(c)) : frame.cols;
  const idx = useCols.map((c) => frame.cols.indexOf(c));
  return frame.rows.map((row) => {
    const rec: Row = {};
    useCols.forEach((c, i) => (rec[c] = row[idx[i]]));
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
export const getPlayerWeek = async (season: number, cols?: string[]) =>
  toRecords(await fetchJson<CompactFrame>(`player_week/${season}.json`), cols);

// Predictive Model page (P2) — own subfolder, isolated pipeline package
// (pipeline/predictive_model/export_page.py). See docs/predictive-model.md.
export const getPredictiveModelGames = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/games.json"));
export const getPredictiveModelSeasonSummary = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/season_summary.json"));
export const getPredictiveModelImportance = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/importance.json"));
export const getPredictiveModelGameFeatures = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/game_features.json"));

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
  feature_cols: string[];
  model: string;
}
export const getPredictiveModelMeta = () => fetchJson<PredictiveModelMeta>("predictive_model/meta.json");

// Live upcoming-week predictions (P3) — pipeline/predictive_model/export_upcoming.py,
// refreshed independently by .github/workflows/predictive-refresh.yml. Empty
// ({cols:[],rows:[]}) whenever every configured season is fully played (offseason).
export const getPredictiveModelUpcoming = async () =>
  toRecords(await fetchJson<CompactFrame>("predictive_model/upcoming.json"));

export interface PredictiveModelUpcomingMeta {
  generated_at: string;
  season: number | null;
  week: number | null;
  n_games: number;
  n_train_games?: number;
  sigma?: number;
  model?: string;
}
export const getPredictiveModelUpcomingMeta = () =>
  fetchJson<PredictiveModelUpcomingMeta>("predictive_model/upcoming_meta.json");

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
