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

// The timeout is an *idle* timer, not a whole-download deadline: it resets on
// headers and on every body chunk. Pages that fetch a dozen+ season files at
// once share one phone connection — a whole-download deadline aborted large
// files that were still making progress, then retried them (3x the traffic),
// so on a weak 5G signal the page never finished. A genuinely dead
// connection still fails after FETCH_TIMEOUT_MS of silence and is retried.
async function fetchOnce<T>(path: string): Promise<T> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  };
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/${path}`, { signal: controller.signal });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    bump();
    if (!r.body || typeof TextDecoder === "undefined") return (await r.json()) as T;
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry<T>(path: string): Promise<T> {
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
}

function memo<T>(store: Map<string, Promise<unknown>>, key: string, make: () => Promise<T>): Promise<T> {
  if (!store.has(key)) {
    const attempt = make();
    // Don't cache a failed request forever — a dropped connection that
    // exhausts its retries should be retryable again on the next call (e.g.
    // a user-triggered "Retry"), not permanently stuck for the rest of the
    // SPA session the way an in-memory cache normally implies.
    attempt.catch(() => store.delete(key));
    store.set(key, attempt);
  }
  return store.get(key) as Promise<T>;
}

const fetchJson = <T>(path: string): Promise<T> => memo(cache, path, () => fetchWithRetry<T>(path));

// Whole-frame loaders cache the *expanded* rows instead of the raw frame, so
// a file is expanded once (not once per caller/page visit) and the raw
// arrays-of-arrays aren't kept alive next to the rows — ~25-40% less heap on
// the pages that hold every season. Each caller gets its own array (rows
// shared, read-only by convention — nothing mutates them), so an in-place
// sort/splice on one page can't leak into another.
//
// The cache is LRU-bounded by cell count (rows x cols) so a long browsing
// session on a phone doesn't accumulate every file it ever touched. A page
// that needs more than the budget (e.g. every team_week season) still holds
// its rows in its own state; an evicted file just gets re-read (normally
// from the browser's HTTP cache) if it's asked for again.
const RECORD_CACHE_MAX_CELLS = 1_500_000;
const recordCache = new Map<string, Promise<unknown>>();
const recordCells = new Map<string, number>();

function touchRecords(path: string) {
  const p = recordCache.get(path);
  if (!p) return;
  recordCache.delete(path);
  recordCache.set(path, p);
}

function trimRecordCache(keep: string) {
  let total = 0;
  for (const n of recordCells.values()) total += n;
  for (const key of [...recordCache.keys()]) {
    if (total <= RECORD_CACHE_MAX_CELLS) break;
    const n = recordCells.get(key);
    if (key === keep || n == null) continue; // just used, or still in flight
    recordCache.delete(key);
    recordCells.delete(key);
    total -= n;
  }
}

function fetchRecords(path: string): Promise<Row[]> {
  touchRecords(path);
  return memo(recordCache, path, async () => {
    const frame = await fetchWithRetry<CompactFrame>(path);
    const rows = toRecords(frame);
    recordCells.set(path, frame.rows.length * frame.cols.length);
    trimRecordCache(path);
    return rows;
  }).then((rows) => rows.slice());
}

// `cols` (optional) projects the expansion down to a subset of the frame's
// columns — every row still carries ~100+ keys otherwise, which is the
// actual memory/CPU cost on a low-RAM phone (the network payload is
// unaffected either way, since `fetchJson` caches the full parsed frame).
//
// Rows are built by a per-frame object-literal factory rather than assigning
// keys one by one onto `{}`: with ~300 columns the incremental version pushes
// every row into the engine's slow "dictionary mode" (~5x the heap — all 12
// team_week seasons measured 77 MB vs 16 MB), which was enough to crash a
// phone tab. The objects are identical either way (same plain own keys, same
// order, same values); the loop stays as a fallback for a `__proto__` column
// (which a literal would treat as the prototype) or a CSP that forbids
// `new Function`.
export function toRecords(frame: CompactFrame, cols?: string[]): Row[] {
  const useCols = cols ? cols.filter((c) => frame.cols.includes(c)) : frame.cols;
  const idx = useCols.map((c) => frame.cols.indexOf(c));
  const make = recordFactory(useCols, idx);
  if (make) return frame.rows.map(make);
  return frame.rows.map((row) => {
    const rec: Row = {};
    useCols.forEach((c, i) => (rec[c] = row[idx[i]]));
    return rec;
  });
}

type RecordFactory = (row: CompactFrame["rows"][number]) => Row;

function recordFactory(cols: string[], idx: number[]): RecordFactory | null {
  if (cols.includes("__proto__")) return null;
  try {
    const body = cols.map((c, i) => `${JSON.stringify(c)}:r[${idx[i]}]`).join(",");
    return new Function("r", `return {${body}};`) as RecordFactory;
  } catch {
    return null;
  }
}

export interface Meta {
  generated_at: string;
  seasons: number[];
  current_season: number;
  counts: Record<string, number>;
}

export const getMeta = () => fetchJson<Meta>("meta.json");
export const getTeams = () => fetchRecords("teams.json");
export const getSchedule = () => fetchRecords("schedule.json");
export const getGrades = () => fetchRecords("grades.json");
export const getFeatureImportance = () => fetchRecords("feature_importance.json");
export const getTeamWeek = (season: number) => fetchRecords(`team_week/${season}.json`);
export const getTeamWeekRanks = (season: number) => fetchRecords(`team_week_ranks/${season}.json`);
export const getPlayerWeek = async (season: number, cols?: string[]) =>
  toRecords(await fetchJson<CompactFrame>(`player_week/${season}.json`), cols);

// Predictive Model page (P2) — own subfolder, isolated pipeline package
// (pipeline/predictive_model/export_page.py). See docs/predictive-model.md.
export const getPredictiveModelGames = () => fetchRecords("predictive_model/games.json");
export const getPredictiveModelSeasonSummary = () => fetchRecords("predictive_model/season_summary.json");
export const getPredictiveModelImportance = () => fetchRecords("predictive_model/importance.json");
export const getPredictiveModelGameFeatures = () => fetchRecords("predictive_model/game_features.json");

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
export const getPredictiveModelUpcoming = () => fetchRecords("predictive_model/upcoming.json");
export const getPredictiveModelUpcomingFeatures = () => fetchRecords("predictive_model/upcoming_features.json");

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
