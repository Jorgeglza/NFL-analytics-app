# Fantasy Draft — design doc (not yet implemented)

Status: **planned, no code written yet.** This documents the design for a Fantasy Football
Draft page + its data pipeline, so it can be picked up and built in a future session without
re-deriving the plan. Source material: `NFL BI\Fantasy\Fantasy 2025\player_ranking_scrape.ipynb`
(a working scrape-and-merge notebook already producing `fantasy_2025_full_ranks.csv` /
`fantasy_2025_summary_ranks.csv`) and `Fantasy 2025 analysis.xlsx` (a hand-built 12-team snake
draft board + a "Wants"/watchlist sheet), both in the user's personal Fantasy folder, outside
this repo.

## Why a separate track from the main pipeline

Three constraints shape every decision below:

1. **Independence.** Web scraping (site markup changes, rate limits, headless-Chrome
   flakiness) is fragile in a way nothing else in this repo is. A broken fantasy scrape must
   never affect `pipeline/nfl_pipeline/`, the weekly NFL data refresh, or the site build/deploy.
2. **Manual, on-demand — not automated.** Explicit decision: this scrape is **not** wired into
   GitHub Actions or any cron schedule. It's a standalone script run by hand (by the user, or by
   Claude on request) a handful of times between roughly May and the user's draft date, as
   sites update their boards with roster/depth-chart news. Once the season starts, the script
   is simply left alone — nothing to disable, nothing running in the background to go stale
   silently.
3. **Seasonal, not evergreen.** Rankings/ADP only matter pre-draft. The page must surface
   data freshness (last-scraped date, per-source status) rather than silently showing
   preseason ADP months into the season.

## Phase 1 — pipeline + rank table page (design)

### Pipeline: `pipeline/fantasy_pipeline/` (new, sibling to `pipeline/nfl_pipeline/`)

```
pipeline/fantasy_pipeline/
  config.py                 # own paths, own SEASON — no imports from nfl_pipeline/config.py
  scrapers/
    cbs.py                   # depth charts + ADP + rank/value tables (requests + BeautifulSoup, static HTML)
    espn.py                  # ADP/rank table (Selenium — JS-rendered)
    thescore.py              # Top-250 (Selenium — JS-rendered, inside an iframe)
  merge.py                  # player_id creation, cross-source merge, consensus calc
  db.py                     # local write_sqlite() — deliberately duplicated, not imported from nfl_pipeline/db.py
  export_json.py            # local df_to_compact()/write_json()/_clean() — deliberately duplicated
  run_fantasy_pipeline.py   # CLI: --stage scrape|merge|export|all [--refresh]
  requirements-fantasy.txt  # requests, beautifulsoup4, selenium, webdriver-manager, pandas — separate from pipeline/requirements.lock.txt
```

**Why duplicate `db.py`/`export_json.py` instead of importing from `nfl_pipeline`:** each is
~30 lines of pure-pandas utility. Duplicating means a future change (or broken import from a
refactor) in either pipeline can never break the other — true isolation, not just "separate
files that still import each other."

**Config:**
- `FANTASY_SQLITE_PATH = DATA_DIR / "fantasy.sqlite"` — own file, never touches `data/nfl.sqlite`.
- `FANTASY_RAW_CACHE_DIR = DATA_DIR / "raw_cache" / "fantasy"` — gitignored, mirrors the
  existing `raw_cache/` convention.
- `FANTASY_EXTRACTS_DIR = app/public/data/fantasy/` — own subdirectory, never collides with
  existing extract filenames.
- `SEASON` — current calendar year; no rollover logic needed since this isn't used past draft
  season.

**Scraper resilience (the real hard problem):**
- Each scraper (`scrape_cbs()`, `scrape_espn()`, `scrape_thescore()`) wrapped in its own
  try/except in the `scrape` stage — one source failing must not abort the run.
- On success, cache the raw scraped DataFrame to `FANTASY_RAW_CACHE_DIR/{source}_{date}.parquet`
  (mirrors `nfl_pipeline/fetch.py`'s cache-by-year idiom).
- On failure, fall back to the most recent cached parquet for that source, flagged
  `stale: true`. Never hard-fail the whole run over one broken source.
- `merge` requires **at least one** successful/cached source; if all three are missing, fail
  loudly rather than export empty/garbage data.
- Known, undocumented-away fragility (carried over from the notebook): ESPN's URL points at a
  specific dated mock-draft article that needs manual re-pointing each season; TheScore's
  scraper drives Selenium into a specific news-article iframe. Both need an annual "does the
  URL still work" check — flagged via a `SOURCE_URLS` dict at the top of `config.py` with a
  comment to review yearly.

**Merge/consensus** (`merge.py`, porting the notebook's `create_player_id()` + final two cells):
- `player_id` from name (lowercase, first-space→underscore, strip punctuation) — exact port.
- Full per-source detail frame: prefix each source's columns (`cbs_`/`espn_`/`thescore_`),
  outer-merge on `player_id` → mirrors `fantasy_2025_full_ranks.csv`.
- Consensus summary frame: average rank/ADP/high/low across sources,
  `avg_value = avg_adp - avg_rank`, `avg_round = ceil(avg_adp / league_size)` → mirrors
  `fantasy_2025_summary_ranks.csv`. Default `league_size = 12`, exposed as a CLI flag.

**Export:**
- `fantasy_rankings.json` — full per-source detail, compact column format.
- `fantasy_summary.json` — consensus rank table (drives the page's default view).
- `fantasy_meta.json` — `{last_updated, sources: {cbs: {status: "ok"|"stale", scraped_at}, espn: {...}, thescore: {...}}, season, league_size}` — the freshness/health signal the page reads.
- Mirrored into `data/fantasy.sqlite` via the local `write_sqlite()` (committed, small file).

**Validation:** light — assert the summary frame has >0 rows and every row has a `player_id`.
Nothing as elaborate as the main pipeline's invariant checks; there's no model/parity to guard.

### Running it — manual only, no CI

```bash
python pipeline/fantasy_pipeline/run_fantasy_pipeline.py --stage all --refresh
git add data/fantasy.sqlite app/public/data/fantasy && git commit -m "data: fantasy refresh"
```
No GitHub Actions workflow. Run this a handful of times between May and the draft, as boards
update. After the draft/season starts, do nothing — the script sits dormant until next
preseason. If useful later, a `workflow_dispatch`-only (no cron) GitHub Action could be added
as a convenience so the user can trigger a refresh from the GitHub UI instead of locally — not
part of this design, purely optional.

### Frontend: rank table page

**Data layer** (new file, doesn't touch `app/src/lib/data/loader.ts`):
`app/src/lib/data/fantasyLoader.ts`
```ts
import { fetchJson, toRecords, type CompactFrame } from "./loader";
export const getFantasySummary = async () => toRecords(await fetchJson<CompactFrame>("fantasy/fantasy_summary.json"));
export const getFantasyRankings = async () => toRecords(await fetchJson<CompactFrame>("fantasy/fantasy_rankings.json"));
export const getFantasyMeta = async () => fetchJson<FantasyMeta>("fantasy/fantasy_meta.json");
```
Every call site wraps these in a try/catch that resolves to an empty/error state — a missing
or malformed fantasy JSON must show a "Fantasy data unavailable — last known update: {date}"
banner, never a crash or blank error boundary for the rest of the app.

**Page:** `app/src/pages/fantasy/FantasyDraft.tsx`. New dedicated nav group `"Fantasy"` in
`app/src/nav.ts` (one entry: "Draft Board" — leaves room for the Phase 2 live-tracker page to
join the same group later, rather than folding into Player Analysis). Registered in
`App.tsx`'s `IMPLEMENTED` map + `TITLE_OVERRIDES`.

**Layout, top to bottom:**
1. **Freshness banner** (from `fantasy_meta.json`): "Rankings as of {date} · CBS ✓ · ESPN ✓ ·
   TheScore ✓" (or "⚠ stale, using {date}'s data" per source). Optional: if today is clearly
   past the season start (cross-referenced from the *main* pipeline's already-exported
   `schedule.json`, read-only), show an "off-season data, may be outdated" note.
2. **Filter bar** (same visual pattern as `PropBets.tsx`): Position `Select`
   (QB/RB/WR/TE/K/DST/All), Team `MultiSelect` (via `getTeamMetaMap()`), name search text
   input, a "hide single-source-only" toggle (cuts D/ST and deep-bench noise visible in the
   raw CSV tail).
3. **Rank table** — hand-rolled `<table>` (TanStack Table isn't used anywhere in this repo
   despite being a `package.json` dependency, so no need to introduce it here either),
   sortable by column click:
   - Consensus Rank | Player (+ team logo) | Pos | Depth chart role | CBS Rank | ESPN
     Rank/ADP | TheScore Rank | Consensus ADP | **Value** (`avg_adp − avg_rank`, green =
     ranked ahead of ADP / value pick, red = reach) | High–Low range | **Last Season PPR
     Pts**
   - Default sort: consensus `avg_rank` ascending.
4. **Grading-methods framing**: this *is* the "various grading methods" ask — each source's
   rank is a distinct methodology (CBS staff consensus, ESPN ADP-derived, TheScore editorial
   top-250) shown side by side, plus the computed consensus and value-over-ADP columns as
   derived grades. No new statistical model needed; the multi-source comparison **is** the
   grading.
5. **Last-season production column (in scope for v1):** cross-references the **existing main
   pipeline's** already-exported `player_week/{season-1}.json` (`fantasy_points_ppr` summed
   per player) via the existing `getPlayerWeek()` loader — a pure read-only frontend join done
   entirely inside `FantasyDraft.tsx`, zero pipeline coupling. Match by normalized display
   name (the main pipeline has no matching `player_id` scheme); unmatched players (rookies,
   name variants) show "—" rather than a guess.

## Phase 2 — draft-guidance tool (scoped, not built)

Matches the Excel workbook's actual workflow (`Sheet1`'s round/pick/player board, plus the
`Wants` sheet):
- League settings (team count, draft slot/pick position), persisted to `localStorage` (same
  idiom as Game Picks' manual winners, Parlay's leg state).
- Computed snake-draft pick sequence from settings; "on the clock" / "your next pick in N
  picks" indicator.
- Per-row "Draft" action on the rank table — marks a player drafted (by me / by someone else),
  greys them out of the available pool. All state in `localStorage`, no pipeline involvement —
  this is why it's safe to build any time after Phase 1 ships data.
- "My team" side panel — drafted-by-me players grouped by position, simple roster-need
  coloring.
- A personal watchlist (mirrors the workbook's `Wants` sheet) — star a player, filter to
  starred-only.

## Open items for whoever implements this
- Confirm `league_size` default (12) still matches the user's actual league before hardcoding it.
- Decide whether to add a 4th source (the notebook has a stub link for Yahoo rankings, never
  implemented) — not required for v1.
- Selenium in a local/dev environment needs a matching Chrome + `webdriver-manager`-resolved
  driver; confirm this works cleanly outside the notebook's original conda env before relying
  on it.
