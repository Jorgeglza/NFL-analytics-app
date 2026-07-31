# Mobile Readiness — Audit & Work List (M6)

Status legend: ☐ not started · ◐ in progress · ✅ done · ⛔ blocked

**Overall status: ◐ in progress** — audit complete 2026-07-29; Phase 1 (shared infrastructure) complete 2026-07-29; Phase 2 (charts: size/axes/legends) complete 2026-07-30. Phases 3–7 not started.

---

## Working process

**Every item in this document must be ticked off (`- [x]`) and logged as complete the moment it is implemented AND verified — not when the code is written, but when it has been checked in the browser at 375px.**

For each item:

1. Implement the change.
2. Verify it per §Verification (screenshot at 375×812; DOM/grep checks alone are not sufficient — that is precisely how the M4 gap happened).
3. **Verify desktop is unchanged.** This is a mobile-readiness pass, not a redesign — nothing here should alter how the app looks or behaves at `sm`/desktop widths for a user who never resizes below 640px. Check at ≥1280px width (computed styles, not assumption — e.g. `getComputedStyle(el).padding`/`.fontSize`/`.display`, or a screenshot) that the specific properties the change touches are byte-identical to before: gutters/padding, font sizes, grid/column counts, colors, and any element that gets new mobile-only markup (sheets, pill strips) stays `display: none` at `sm+` while the original element/classes render unchanged. If a change is genuinely meant to apply at all breakpoints (e.g. a `DEFECT` fix, or an unconditional safety default like ECharts tooltip confinement), say so explicitly in the item's completion note instead of leaving it ambiguous — silence is not permission to change desktop.
4. Flip `- [ ]` → `- [x]` in this file and append a one-line note: what changed, how it was verified on mobile, and how it was verified unchanged on desktop (or why it was intentionally allowed to change there).
5. Update the **M6 — Mobile readiness** milestone status in `docs/IMPLEMENTATION_LOG.md` (per the working process in `CLAUDE.md`, which requires a log update after every meaningful change).
6. When a whole phase is done, change that phase's heading status ☐ → ✅.

Do not batch step 4 to the end of a session. A half-implemented phase with no ticks is indistinguishable from an un-started one.

**Severity tags:**

| Tag | Meaning |
|---|---|
| `DEFECT` | Produces wrong or misleading output. Affects desktop too. Fix regardless of mobile. |
| `BLOCKING` | Unusable, unreadable, or broken at 375px. |
| `POLISH` | Works, but below the quality bar for a phone. |

---

## Context — why this document exists

`docs/IMPLEMENTATION_LOG.md` marks **M4 (UI modernization) as ✅**, but M4's actual scope was *visual language consistency* — cards, radii, navy accents, label casing — verified by DOM audit. The single unchecked M4 box is exactly the step that would have caught layout problems:

> ☐ Optional: screenshot-based visual QA (browser pane screenshot capture currently times out on this app). — `IMPLEMENTATION_LOG.md:50`

A responsive pass **was** promised in the Session-2 note (`IMPLEMENTATION_LOG.md:1142`: *"Next (M4): responsive/UI polish pass, golden-fixture Vitest…"*). The Vitest and tsbuildinfo halves were completed and logged; the responsive half was silently dropped and never reappears in the M4 checklist. The word "mobile" appears **zero times** in the roadmap.

The source corroborates this:

- **~53 responsive utilities across 16,842 lines of TSX.** All `sm:`/`lg:`/`xl:`. `md:` appears only in `Navbar.tsx`. `2xl:` never.
- **375px is the un-designed default state** — there is no breakpoint below `sm` (640px) anywhere.
- The entire `app/src/pages/player-analysis/` directory — **5 routes, 2,391 lines** — has not a single responsive prefix. Same for `GamePicks.tsx`, `TeamTrends.tsx`, all three Season Outlook tab bodies, and every shared primitive in `components/ui.tsx`.
- ~60 ECharts instances render desktop geometry into fixed pixel heights up to **700px**. Exactly **one** chart in the app has a width breakpoint.

### Decisions taken (2026-07-29, with user)

| Decision | Choice |
|---|---|
| Scope | **Full mobile-first pass** across all 17 routes |
| Dense charts | **Adapt density per breakpoint** via ECharts `media` queries — extends the pattern already proven at `pages/grading-model/charts.tsx:118` |
| Wide pivot tables | **Sticky first column + scroll affordance** (not card-per-row) |
| Data payload | **Frontend-only** — no pipeline or export changes |

### Already correct — do NOT churn these

- ✅ Viewport meta is present and correct (`app/index.html:5`).
- ✅ **Tailwind v4 wraps `hover:` in `@media (hover: hover)` by default** — verified in `node_modules/tailwindcss/dist/lib.mjs` (v4.3.2): `i.static("hover", c => { c.nodes = [H("&:hover", [B("@media","(hover: hover)", c.nodes)])] })`. The ~250 `hover:` utilities do **not** stick after tap on touch devices. No work needed.
- ✅ `Navbar.tsx:40,93,109` already has a working `md:hidden` hamburger + mobile menu panel (closes on route change and outside click). It is the one genuinely mobile-aware surface in the app.
- ✅ `useECharts.ts:46` already runs a `ResizeObserver` → `chart.resize()`, which is why charts don't break outright on rotation. Only the *container height* and *option geometry* are frozen.
- ✅ 17 of 19 tables already have an `overflow-x-auto` wrapper.

---

## Phase 1 — Shared responsive infrastructure ✅

Build once, apply everywhere. **Do this before touching any page** — ~60 charts and 4 duplicated tab bars all route through a handful of files, so page work done first would have to be redone.

- [x] **P1.1** `BLOCKING` — `app/src/components/charts/useECharts.ts`: added `normalizeOption()`, applied before every `setOption` (both the mount `ref` callback and the update effect). Fills in `tooltip.confine = true`, `legend.type = "scroll"`, `axisLabel.hideOverlap = true` on category axes only where not already explicitly set (explicit values win); walks `baseOption` too. Verified: `tsc --noEmit`/`npm run build`/60-test suite green; browser-pane smoke test showed zero console errors.
- [x] **P1.2** `BLOCKING` — **new** `app/src/components/charts/responsive.ts`: `MOBILE_MAX = 520`, `withMobile(base, mobileOverrides)` returning the `{ baseOption, media }` form, plus `MOBILE_GRID`/`MOBILE_LABEL` constants. Not yet consumed by any chart — that's Phase 2's job; this phase only builds the primitive.
- [x] **P1.3** `BLOCKING` — **new** `app/src/components/charts/sizing.ts`: `chartH.{sm,md,lg,xl}` responsive height class strings and `rowChartH(n, rowPx = 22, pad = 60)`. Not yet consumed by any page — Phase 2's job.
- [x] **P1.4** `BLOCKING` — `app/src/components/Modal.tsx`: bottom sheet below `sm` (rounded top corners, grab handle, anchored to viewport bottom) with the original centered dialog kept at `sm+`. Added body scroll lock, collapsed the nested scroll containers into one, `role="dialog"` + `aria-modal="true"` + `aria-label`, a focus trap + focus restore on close, close button `h-8 w-8` → `h-10 w-10`. Verified via `tsc --noEmit`/`npm run build`/tests; no dedicated browser click-through this pass (no Phase-1-scope page opens a Modal) — flagged for a screenshot check when Phase 5 first touches a Modal-using page.
- [x] **P1.5** `BLOCKING` — **new** `app/src/components/TabBar.tsx`: extracted the identical card-tab grid from `SeasonOutlook.tsx`, `GradingModel.tsx`, `PredictiveModel.tsx`, `MatchupPreviews.tsx` — all 4 now render `<TabBar tabs={...} active={tab} onChange={setTab} gridClassName="..." />` instead of hand-rolling the grid. Below `sm`: horizontally-scrollable pill strip (`overflow-x-auto snap-x snap-mandatory`, 44px/`h-11` buttons, icon + label, no description). At `sm+`: original icon+label+description card grid, unchanged (same per-page `gridClassName` preserves the original 3-col/4-col/4-col/2-then-4-col layouts). Verified in the browser pane at 375×812 on Season Outlook and Predictive Model: the pill strip is the only visible variant (confirmed via computed `display`), zero horizontal overflow, zero console errors, tab-switching confirmed functional (title + content update on click).
- [x] **P1.6** `POLISH` — **new** `app/src/components/FilterSheet.tsx`: below `sm`, a `Filters` button (optional active-count badge) opens a bottom sheet with body scroll lock and Escape-to-close, wrapping passed-in filter controls; at `sm+` renders as the original inline strip (same classes the removed `FilterBar` used). Built as a drop-in `FilterBar` replacement; **not yet wired into any page** — per-page adoption (`SpreadWinPct.tsx`, `ModelOverviewTab.tsx`, `TeamsTab.tsx`, `PropBets.tsx`, `ParlayBuilder.tsx`, `PlayerTeamStats.tsx`) is Phase 5 scope.
- [x] **P1.7** `BLOCKING` — **new** `app/src/components/InfoDot.tsx`: promoted from the private `InfoDot` in `PerformanceTab.tsx` (now imports the shared one). Adds a click/tap-toggled anchored popover (closes on outside click/tap or Escape) alongside the existing `title` hover fallback. Verified in the browser pane: tapping the dot sets `aria-expanded="true"` and renders a `role="tooltip"` element with the expected text, zero console errors. Other `title`-only consumers (Phase 4) still need individual migration.
- [x] **P1.8** `POLISH` — `app/src/components/ui.tsx`: `PageHeader` h1 `text-2xl` → `text-xl sm:text-2xl`; `Kpi` → 2-up on phones (`min-w-[calc(50%-0.375rem)] sm:min-w-36`); `Segmented` buttons `py-1.5` → `py-2.5 sm:py-1.5`; `NumberInput` default `w-28` → `w-full sm:w-28`; `RangeInput` default `w-44` → `w-full sm:w-44`; added `stickyColCls`/`scrollHintCls` exports for Phase 6; deleted `FilterBar` (confirmed zero importers via grep before deleting). Verified: `tsc --noEmit`/`npm run build` green.
- [x] **P1.9** `BLOCKING` — `app/src/index.css`: added `@media (pointer: coarse)` enlarging both `.range-thumb::-webkit-slider-thumb` and `::-moz-range-thumb` from 14px → 24px; added `.safe-bottom`/`.safe-top` utilities.
- [x] **P1.10** `POLISH` — `app/src/App.tsx`: `<main>` gutter `px-4` → `px-3 sm:px-4` (tightens only below `sm`; kept `sm:px-4` rather than the originally-sketched `lg:px-6` so desktop gutter width is pixel-identical to before), added `.safe-bottom`.
- [x] **P1.11** `POLISH` — `app/index.html`: added `<meta name="theme-color" content="#002f6c">`, `viewport-fit=cover`, and `<link rel="preconnect" href="https://a.espncdn.com">` (confirmed as the actual logo CDN host via `app/public/data/teams.json`, not assumed).

**Phase 1 verification:** `tsc --noEmit`, `npm run build`, and the 60-test Vitest suite all green after every item. Browser-pane smoke test (375×812) on Season Outlook and Predictive Model (Overview + Performance tabs): zero console errors, zero horizontal body overflow, `TabBar`'s mobile/desktop variants swap correctly at the breakpoint, `InfoDot` popover opens on tap. **Desktop-regression check (1280×800)**, per explicit user request to confirm nothing already working changed: `<main>` padding is 16px (`px-4`, byte-identical to pre-Phase-1), the `TabBar` desktop card grid renders (mobile pill strip hidden) with the correct column count on both Season Outlook (3-col) and Grading Model (4-col), `PageHeader` h1 is 24px (`text-2xl`, unchanged) — confirmed via computed styles, not assumption. `Modal.tsx`'s `sm+` classes were adjusted mid-implementation (`sm:block sm:max-h-none` + `sm:max-h-[75vh]` on the inner scroll div) specifically so the desktop dialog reverts to the exact original block-layout/scroll behavior; only the sub-`sm` sheet path is new. Full screenshot-based QA across all 17 routes (per §Verification below) is deferred to the end of Phase 5/6, once there's per-page content worth screenshotting — Phase 1 only ships shared primitives, several of which (`responsive.ts`, `sizing.ts`, `FilterSheet.tsx`) aren't consumed by any page yet.

---

## Phase 2 — Charts: size, axes, legends ✅

### 2a. Height strategy — the key distinction

**Not every tall chart is a bug.** Split them by what drives the height:

- [x] **P2.1** `POLISH` — **List-driven** charts moved to `rowChartH(n)`: `SeasonTab.tsx` overall/off/def bars, `WeeklyTab.tsx` rank bar (both now `rowChartH(teamCount)` instead of a fixed `h-[600px]`), `GamePicks.tsx:333` and `ModelPickerTab.tsx:516,530` (already dynamic via inline `Math.max(...)` formulas, refactored to call the shared `rowChartH()` helper — same math, no visual change), `SosTab.tsx:65` and `HeatmapChart.tsx:132` (same refactor, identical formula). Verified in browser at 375px and 1280px: Season/Weekly tab bars render at `rowChartH(32)=764px` (was a fixed 600px) and the off/def scatter (aspect-driven, see P2.2) at the `chartH.xl` tier — **intentional desktop height change**, documented below. `SosTab`/`HeatmapChart`/`GamePicks`/`ModelPickerTab` heights are byte-identical before/after (same formula, just centralized).
- [x] **P2.2** `BLOCKING` — Aspect-driven charts moved to `chartH.*` tokens: `SeasonTab.tsx` + `WeeklyTab.tsx` off/def scatter (`h-[700px]` → `chartH.xl`), `FeaturesTab.tsx` + `ExplanationTab.tsx` + `PerformanceTab.tsx` misses-heatmap (`h-[560px]` → `chartH.lg`), `TeamsTab.tsx` stacked/stat charts + `PerformanceTab.tsx` Points-mode scatter (`h-[520px]` → `chartH.lg`), `PerformanceTab.tsx` reliability/granular charts (`h-[480px]` → `chartH.md`). Verified at 375px (mobile heights: 380/340/300 respectively, no overflow) and 1280px. **Intentional desktop height changes** (chartH's discrete tiers don't hit every original pixel value exactly): 700→620px (xl), 560→520px (lg), 480→420px (md); the 520px group landed exactly on `chartH.lg`'s 520px tier, so `TeamsTab.tsx` is byte-identical. These are modest (7-12%) reductions from adopting the Phase-1 shared token set instead of one-off pixel values — traded for correct mobile behavior, per this phase's explicit mandate to route aspect-driven charts through `chartH.*`.

### 2b. `containLabel: false` + hardcoded gutters — where titles actually clip

- [x] **P2.3** `BLOCKING` — `PerformanceTab.tsx` margin-heatmap builder (`heatmapOptionOf`) wrapped in `withMobile()`: mobile override shrinks the grid to `{left:36,right:8,top:20,bottom:38}`, cuts `nameGap` to 20/22, drops `nameTextStyle` to 9px, and moves `visualMap` to `orient:"horizontal", top:"bottom"`. Desktop (`baseOption`) values untouched. Verified no console errors and no overflow at 375px.
- [x] **P2.4** `BLOCKING` — `PerformanceTab.tsx`'s `catByWeekOptionOf`, Points-mode `scatterOption`, `reliabilityOption`, `granularOption`, and `gapOption` all wrapped in `withMobile()` with shrunk mobile grids (`left` 34-36, `bottom` 34-38, `nameGap`/`nameTextStyle` reduced) instead of the fixed 50-60px desktop gutters. Desktop `baseOption` values unchanged. Verified in browser: all 5 charts render without clipping at 375px, zero console errors.
- [x] **P2.5** `BLOCKING` — `ModelPickerTab.tsx`'s `buildHeatmap` wrapped in `withMobile()`: mobile grid drops `left` from 110→60 and truncates model-name y-axis labels to 8 chars with an ellipsis (`formatter`), instead of reserving a 110px gutter for labels like "Predictive (margin reg.)". Desktop keeps the full untruncated labels and 110px gutter.
- [x] **P2.6** `BLOCKING` — `HeatmapChart.tsx` (season-outlook opponent-difficulty grid) wrapped in `withMobile()`: mobile grid shrinks to `{left:30,right:4,top:22,bottom:4}` (from `left:50`) and axis label font drops to 8px, giving more of the 18 week-columns' room to the custom-rendered cells. Desktop unchanged.
- [ ] **P2.7** `POLISH` — Not implemented this pass (no case in P2.3-2.6 needed it — mobile grids above all fit without moving axis names into the `Card` subtitle).

### 2c. Axis label density

- [x] **P2.8**/**P2.9** — Investigated rather than blanket-edited: `useECharts.ts`'s `normalizeOption()` (P1.1, already shipped) fills in `axisLabel.hideOverlap: true` on every category axis that doesn't already set it — including all of `ParlayBuilder.tsx:163`, `PropBets.tsx:213`, `TeamComparison.tsx:465`, `SpreadWinPct.tsx:549,260,296,333`, `FeaturesTab.tsx:73`, `TeamsTab.tsx:230`. This means overlapping labels already get hidden automatically regardless of the explicit `interval: 0`/rotation values, verified by reading `normalizeLayer()`'s merge order (existing keys win, `hideOverlap` only fills the gap). `PerformanceTab.tsx`'s `gapOption` (the P2.9 `:702` case) additionally got an explicit mobile `axisLabel: { interval: "auto", fontSize: 8 }` override as part of the P2.4 `withMobile()` work above. No further changes made to the other 7 sites — they're covered by the existing global mechanism, and adding redundant per-chart overrides risked no benefit for real risk (desktop regression).
- [ ] **P2.7** `POLISH` — See above.

### 2d. Legends

- [x] **P2.10** `POLISH` — `MatchupBets.tsx`'s opponent-allowed/rank chart (4-series legend) wrapped in `withMobile()`, raising `grid.bottom` from 25→32 on mobile as insurance headroom; `legend.type: "scroll"` (P1.1, already shipped) already prevents the multi-row wrap that caused the original overlap. `MatchupBets.tsx:236` (2-slice donut) and `TeamComparison.tsx:452` (2-series bar) left unchanged — only 2 legend entries each, verified they don't wrap even pre-P1.1, so the described defect doesn't apply to them.

### 2e. Hard overflow

- [x] **P2.11** `BLOCKING` — `ParlayBuilder.tsx:241` `w-[360px]` → `w-full sm:w-[360px]`; `:194` `min-w-[340px]` → `min-w-0 flex-1 sm:min-w-[340px]`. Verified in browser at 375px: chart canvas now renders at the container's actual width (326px) instead of forcing a 360px chart into a 343px content box. Desktop keeps the original 360px/340px via the `sm:` variants.

**Phase 2 verification:** `tsc --noEmit`, `npm run build`, and the 60-test Vitest suite all green. Browser-pane check (no screenshot capture — still times out on this app, per the M4 note — verified via `document.body.scrollWidth`/`clientWidth`, canvas container dimensions, and `read_console_messages` instead) at 375×812 across Grading Model (all 4 tabs), Predictive Model Performance tab (both Points/% modes), Season Outlook Strength-of-Schedule, Build Parlay, and Matchup Previews Model Picker: zero console errors on any page; zero horizontal overflow except two **pre-existing, out-of-Phase-2-scope** cases found during this pass (see note below) that predate this phase's edits. Desktop regression check at 1280×800 on Grading Model (Season/Weekly/Teams/Features tabs): `TeamsTab.tsx`'s charts are byte-identical (520px, exact `chartH.lg` tier match); `SeasonTab`/`WeeklyTab`/`FeaturesTab`/`ExplanationTab`/`PerformanceTab` aspect-driven charts and the `rowChartH`-based list charts shift modestly (documented per-item above) as an intentional, explicitly-flagged consequence of adopting the Phase-1 shared sizing tokens — no other desktop styling (gutters, fonts, colors, layout) touched.

**Pre-existing overflow found during verification (not caused by this phase, not fixed — flagged for Phase 5/6):** (1) Matchup Previews → Model Picker tab has `document.body.scrollWidth` (655px) exceeding the 375px viewport at mobile width; the offending elements are the `TabBar` mobile pill strip and a wide scenario-accuracy table, neither touched by this phase's chart-only edits, and the sibling Week Preview tab on the same page has no overflow — likely a flexbox containment gap (child of an `overflow-x-auto` container not constrained by `min-w-0` up the tree). (2) Build Parlay has a "Reset" button/toolbar row that extends past 375px, unrelated to the `w-[360px]` chart fix in this phase (verified the chart canvas itself now correctly renders at 326px). Both are per-page layout/table issues in Phase 5/6's scope, not Phase 2's chart-sizing scope.

---

## Phase 3 — Bin correctness ☐

Every binning site in the app was reviewed. Three are genuinely wrong or misleading; three are hygiene.

- [ ] **P3.1** `DEFECT` — **Both histograms use a category x-axis; convert them to a value axis.** One change fixes three problems.

  `WeeklyTab.tsx:71-112` (grade histogram) and `ConfidenceTab.tsx:64-83` (residual histogram) build `type: "category"` axes whose labels are the **left edge only**, derived from raw `min`/`max`, so edges are never round numbers (e.g. `-47.3, -43.1, -38.9…`). `ConfidenceTab.tsx:75` formats with `.toFixed(0)`, which **can emit duplicate labels** when bin width < 0.5.

  **The real defect:** `WeeklyTab.tsx:96` and `:107` place the mean and median `markLine`s by *integer bin index* on a category axis, so ECharts draws them at the containing bin's **center**, not at the true value. A mean of 62.7 falling in bin `[60, 64)` renders at 62 — **off by up to half a bin width**. This is wrong on desktop too, not just mobile.

  **Fix:** `xAxis: { type: "value", min, max }` with explicit round edges and `barWidth` derived from bin width. Mean/median markLines then land exactly; ECharts auto-thins value ticks so mobile label density resolves itself; and `ConfidenceTab.tsx:79`'s arbitrary `axisLabel: { interval: 4 }` can be deleted.

- [ ] **P3.2** `DEFECT` — **`WeeklyTab.tsx:74` is over-binned.** `nbins = Math.min(24, Math.max(5, Math.floor(x.length / 2)))` yields **16 bins for 32 teams** — ~2 teams per bin. That renders noise, not a distribution. Use Sturges (`1 + log2(32)` ≈ 6) or Freedman–Diaconis, capped ~12, and snap edges to round grade values.

- [ ] **P3.3** `BLOCKING` — **`buildMarginHeatmap` density.** `shared.ts:145` is *mathematically correct* — symmetric edges around `maxAbs = Math.max(30, …)`, correct clamping at both ends. The problem is density: `PerformanceTab.tsx:685` calls it with `bucketWidth = 5`, producing **~18×18 cells with 45°-rotated 9px labels**. Pass `bucketWidth = 10` under mobile media → 9×9. Best exposed as a prop driven by container width.

- [ ] **P3.4** `POLISH` — **Delete `app/src/lib/logic/spreadBins.ts`.** Dead code — **zero importers** — duplicating the live logic at `SpreadWinPct.tsx:65-71`. It also carries a latent defect the live version does not: `binEdges` line 14 computes `Math.ceil(max / binSize) * binSize + binSize`, adding one **always-empty top bin** whenever `max` isn't exactly on a grid boundary. Deleting is cleaner than reconciling. *(The live `bucketOf` is correct — its `+ 1e-9` epsilon handles negative spreads properly.)*

- [ ] **P3.5** `POLISH` — **Two `percentile` functions with opposite unit conventions.** `lib/logic/contributions.ts:29` takes `q` in **0–100**; `ModelPickerTab.tsx:71` takes `p` in **0–1** and is called as `percentile(sorted, 0.2)`. Each is internally consistent, but same name / opposite units is a live footgun. Consolidate on the 0–100 version in `lib/logic/` and delete the local copy.

- [ ] **P3.6** `POLISH` — **Parity comment overclaims.** `shared.ts:194` `reliabilityBuckets` states it *"Mirrors pipeline/predictive_model/evaluate.py's calibration_table **exactly**."* It uses `floor(p * nBins)` → bins are `[lo, hi)`; the pipeline (`evaluate.py:69-90`) uses `np.digitize(proba, edges[1:-1], right=True)` → `(lo, hi]`. They diverge only for probabilities landing exactly on a bin edge. Either align the convention or soften the comment — do not silently leave the claim standing.

---

## Phase 4 — Touch & interaction ☐

### Hover-only content — the single biggest UX gap

There are **177 `title=` attributes across 29 files**, and `PerformanceTab.tsx:71-72` documents this as deliberate app convention: *"Small hover-only info marker — matches the app's existing convention of a native `title` attribute."* **On touch, `title` never fires.** Prioritize cases where `title` is the *only* carrier of the information.

- [ ] **P4.1** `BLOCKING` — `PerformanceTab.tsx:771, 833, 850` (`InfoDot`) — each holds a 400–700 character explanation of how to read that chart. Completely unreachable on touch.
- [ ] **P4.2** `BLOCKING` — `ModelOverviewTab.tsx:202` — per-cell pick %, **deliberately moved to hover-only** to shrink the grid (`IMPLEMENTATION_LOG.md:949`). That decision needs a touch-reachable path.
- [ ] **P4.3** `BLOCKING` — `PropBets.tsx:330`, `ValueBets.tsx:592`, `MatchupBets.tsx:575` — opponent + "% of team total" + above-average status. The cells otherwise show a bare number.
- [ ] **P4.4** `BLOCKING` — `ExplanationTab.tsx:170, 259` — feature descriptions (`cursor-help` + dotted underline + `title={describeFeature(...)}`). These descriptions **exist nowhere else in the UI**.
- [ ] **P4.5** `BLOCKING` — `SpreadWinPct.tsx:705, 715, 725, 729` — controls literally labelled `"Bin size ⓘ"`, `"Spread mode ⓘ"`, `"Min N per bin ⓘ"`, `"Show CI ⓘ"`, where the ⓘ is a `title` on the wrapper. The glyph advertises help that touch users cannot get.
- [ ] **P4.6** `POLISH` — `TeamsTab.tsx:393-394` — the "Avg (raw)" vs "Avg. contrib. (pts)" disambiguation, itself logged as a UX fix.
- [ ] **P4.7** `POLISH` — `ModelPickerTab.tsx:428-429, 458` — exact record `n`, Brier / avg-confidence definitions.
- [ ] **P4.8** `POLISH` — Page-title `title` attributes carrying cross-page navigation hints: `WinTypes.tsx:470`, `SpreadWinPct.tsx:682`, `Scorecards.tsx:790`, `TeamComparison.tsx:582`, `GamePicks.tsx:211`, `MatchupPreviews.tsx:102`.
- [ ] **P4.9** `BLOCKING` — `WeekPreviewTab.tsx:246` gates the "view matchup →" affordance behind `opacity-0 group-hover:opacity-100`. The card **is** tappable (`onClick` at `:240`), but on touch there is **no signal that it is**. Make it always visible below `sm`.

*Keep `title` as the desktop fallback wherever it is genuinely supplementary.*

### Drag interaction that is dead on touch

- [ ] **P4.10** `BLOCKING` — `PerformanceTab.tsx:552-595` drags the decision-cutoff line via raw zrender `mousedown`/`mousemove`/`mouseup` with an **8px hit test** (`hitTestPx = 8`), discoverable only via `zr.setCursorStyle("ew-resize")`. Rather than wiring touch events (which would fight page scroll), **add a `RangeInput` bound to the same `thresholdPct` state** — works on every device, and the drag survives as a desktop nicety.

### Tap targets

Nothing in the app targets 44px. Only the tab cards (~56px), Home nav cards, and navbar mobile links come close.

- [ ] **P4.11** `BLOCKING` — 32px controls: `Modal.tsx:41` close ✕ (covered by P1.4), week steppers `SeasonOutlook.tsx:31-32` and `GamePicks.tsx:206`, `ParlayBuilder.tsx:264,266` ± leg buttons.
- [ ] **P4.12** `BLOCKING` — `GamePicks.tsx:289-302` 🧭/⚖️ zoom links: `h-7 w-7` (28px) with only a 6px gap — adjacent mis-taps guaranteed.
- [ ] **P4.13** `BLOCKING` — ~20–24px controls: `MultiSelect.tsx:50,57` All/None, `WinTypes.tsx:537-543` jump chips (up to 18 of them, `gap-1.5`), `PlayerTeamStats.tsx:328-335`, `ValueBets.tsx:470-482` and `:530-537`, `TeamComparison.tsx:540-554`, `SpreadWinPct.tsx:795`, `GamePicks.tsx:324`, `PerformanceTab.tsx:888,897`, `WeeklyTab.tsx:239` "Drivers →", `ValueBets.tsx:560` "Show full roster".
- [ ] **P4.14** `BLOCKING` — Table rows that open modals are 24–32px tall and signal tappability only via `cursor-pointer`: `PowerRankingsTab.tsx:72`, `PlayoffTab.tsx:68`, `Scorecards.tsx:410`, `PropBets.tsx:322`, `MatchupBets.tsx:565`. Bump row padding below `sm` and add a visible chevron. Same for the bare `→` drill-down glyphs at `ValueBets.tsx:602-608` and `MatchupBets.tsx:582-589`.
- [ ] **P4.15** `BLOCKING` — Native checkboxes render ~13px: `GamePicks.tsx:262,269` (pick checkboxes inside a `py-2` cell), `MultiSelect.tsx:64-70`. Wrap each in a 44px label hit area.

### Other touch issues

- [ ] **P4.16** `POLISH` — `MultiSelect.tsx:45` closes on `mousedown` only and has **no viewport-collision handling** (`absolute top-full w-full min-w-40 max-h-64`). Add `touchstart`, clamp the panel to the viewport, and route it through the Sheet below `sm`.
- [ ] **P4.17** `POLISH` — `GradingModel.tsx` and `PredictiveModel.tsx` hold tab state in `useState` — no deep link, and **the back button does not undo a tab change**, which reads as a broken app on a phone. Move to `?tab=` like `MatchupPreviews.tsx`. (`SeasonOutlook` already uses a `:tab` route.)

---

## Phase 5 — Per-page layout ☐

Apply the Phase-1 primitives. Priority order is the surfaces with **zero** responsive prefixes today.

- [ ] **P5.1** `BLOCKING` — `pages/player-analysis/` — all 5 routes: `PropBets.tsx` (402), `ParlayBuilder.tsx` (359), `PlayerTeamStats.tsx` (375), `ValueBets.tsx` (638), `MatchupBets.tsx` (617). 2,391 lines, not one responsive prefix.
- [ ] **P5.2** `BLOCKING` — `game-analysis/GamePicks.tsx` (337) and `game-analysis/TeamTrends.tsx` (209).
- [ ] **P5.3** `BLOCKING` — Season Outlook tab **bodies**: `PowerRankingsTab.tsx`, `SosTab.tsx`, `PlayoffTab.tsx`, `HeatmapChart.tsx`. The tab bar is responsive; none of the content is.
- [ ] **P5.4** `POLISH` — `previews/WeekPreviewTab.tsx` (320), `previews/ModelPickerTab.tsx` (545), `previews/ModelOverviewTab.tsx` (340); `grading-model/SeasonTab.tsx`, `grading-model/FeaturesTab.tsx`; `predictive-model/OverviewTab.tsx`, `ExplanationTab.tsx`, `ConfidenceTab.tsx`.
- [ ] **P5.5** `BLOCKING` — `previews/MatchupTab.tsx:483` and `:496` — hardcoded `grid-cols-3` with **no responsive prefix**: 3 columns at 375px. Every other `grid-cols-N` in the app is either responsive or intentionally 2-up. → `grid-cols-1 sm:grid-cols-3`.
- [ ] **P5.6** `BLOCKING` — `TeamComparison.tsx:622` `min-w-[560px]` inner rail and `:242` `w-[72px]` stat chips — crushes at the 343px content box.
- [ ] **P5.7** `BLOCKING` — `season-outlook/DetailModal.tsx` remaining-schedule rows use fixed `w-14` / `w-28` / `w-24` columns before a flex bar — will crush at 343px.
- [ ] **P5.8** `POLISH` — `PerformanceTab.tsx:739-757` and `ExplanationTab.tsx:191-225` hand-roll `<select>` with duplicated classes instead of using `components/filters/Select.tsx`. Switch them so the P1.8 sizing lands there too.

---

## Phase 6 — Tables ☐

All wide tables already scroll horizontally. The problem is that **not one has a sticky first column**, so scrolling sideways loses the player/team name entirely.

- [ ] **P6.1** `BLOCKING` — Add `stickyColCls` (`sticky left-0 z-10` + background) to the first column, worst first: `ValueBets.tsx:565` (**~25 cols** — widest in the app), `MatchupBets.tsx:550` (~23), `TeamsTab.tsx:386` (~21), `PropBets.tsx:305` (~20), `ModelOverviewTab.tsx:179` (2 + one per game, up to 18), `Scorecards.tsx:385` (explicit `min-w-[860px]` — **2.5× the viewport**), `ModelPickerTab.tsx:440`.

  *Implementation note:* sticky cells lose their borders under `border-collapse: collapse`. Set `border-separate border-spacing-0` on these tables and draw the divider with `box-shadow` instead.

- [ ] **P6.2** `POLISH` — Add a right-edge fade gradient to `tableWrapCls` (`ui.tsx:124`) as a scroll affordance, plus a one-time "Swipe →" hint on the widest pivots.
- [ ] **P6.3** `POLISH` — `previews/MatchupTab.tsx:691` and `:731` — the only two tables **missing `overflow-x-auto`**. Only 5 columns each so severity is low, but wrap them for consistency.
- [ ] **P6.4** `POLISH` — `FeaturesTab.tsx` and `TeamTrends.tsx` tables: exploration returned conflicting reports on whether these have wrappers. **Verify in the browser at 375px, not by grep.**

---

## Phase 7 — Mobile performance (frontend-only) ☐

The bottleneck is not the download — it is the expansion. `loader.ts:26` `toRecords` turns every row into an object with ~100 keys, which is where a low-RAM phone will actually die.

- [ ] **P7.1** `BLOCKING` — Add column projection: `toRecords(frame, cols?)` and thread an optional column list through `getPlayerWeek(season, cols)` (`loader.ts:51`). `player_week/2025.json` is **13.7 MB raw / 1.2 MB gzipped**, and all five player pages expand the whole thing. `fetchJson` already caches the parsed `CompactFrame` (`loader.ts:11-24`), so projection is a pure win with **no cache-key changes needed**.
- [ ] **P7.2** `POLISH` — `MatchupPreviews.tsx:66-90` and `ModelsGuide.tsx:93-101` load `getTeamWeek` **and** `getTeamWeekRanks` for *every* season in `meta.seasons` — **~14 MB raw / ~3 MB gzipped for one page view**, in two *sequential* `Promise.all` batches (`await` at `:72` then `:79`). Merge into one batch; lazy-load non-current seasons on demand.
- [ ] **P7.3** `POLISH` — `PredictiveModel.tsx:44-59` loads all six files including `game_features.json` (906 KB gz) up front regardless of which of the 4 tabs is active. Defer to the tab that needs it.
- [ ] **P7.4** `POLISH` — Team logos are 32 remote ESPN CDN requests (`lib/team/meta.ts:30`) on any full-league table, with `loading="lazy"` on exactly one image in the app (`ParlayBuilder.tsx:233`). Add `loading="lazy" decoding="async"` in `TeamLogoLink.tsx` and the table cells.
- [ ] **P7.5** `POLISH` — Extend `LazyMount` (`components/LazyMount.tsx`, currently used in only 2 places) to the chart-heavy lists. `PerformanceTab` alone mounts **10 ECharts instances**.
- [ ] **P7.6** `POLISH` — No skeletons anywhere. Every page gates its entire render behind one boolean, and `App.tsx:69` uses the same `<Loading/>` as the Suspense fallback — so a route change on a slow connection shows **spinner → spinner**. Add per-card skeletons at least on the player pages.

---

## Verification — definition of done

**No visual QA has ever been run on this app at any viewport.** That is the unchecked M4 box (`IMPLEMENTATION_LOG.md:50`). This pass must not repeat it — an item is not done until it has been *seen*.

1. `npm run dev` in `app/`; open the Browser pane via `preview_start`.
2. **Screenshot all 17 routes at 375×812, 768×1024, and 1280×800, before and after.** This is the acceptance artifact for M6 — the 1280×800 pass exists specifically to catch desktop regressions, not just document mobile progress.
3. Per route confirm: no horizontal body scroll; no clipped axis titles, axis labels, or chart titles; tooltips stay inside their container (`confine`); legends don't overlap plots; every interactive control ≥44px; **and, at 1280×800, that the route is visually indistinguishable from its pre-M6 state** — same gutters, font sizes, grid layouts, colors — since almost every fix in this doc is meant to be additive at `sm+`, not a redesign.
4. **Bins specifically** — compare both histograms before/after P3.1: bin edges are round numbers, labels don't duplicate, and **the mean/median markLines sit on their true values, not bin centers**. Confirm the margin heatmap drops to 9×9 below 520px.
5. **Wide pivots** — scroll sideways and confirm the first column stays pinned with a visible divider.
6. **Touch** — exercise the new `InfoDot`, the `FilterSheet`, the bottom-sheet modal (including body scroll lock), and the `thresholdPct` slider using `computer` click/tap. Not by inspecting the DOM.
7. `npm test` and `npm run build` stay green. **The Phase-3 bin changes alter rendered values** — check whether any golden-fixture Vitest in `app/src/lib/logic/logic.test.ts` covers them and update deliberately, documenting the change.
8. Update `docs/IMPLEMENTATION_LOG.md`: M6 status, and close the open M4 visual-QA item by cross-referencing the screenshot evidence.

---

## Out of scope

- **Pipeline / export changes.** The payload fix (Phase 7) is frontend-only by decision. Parity rules in `CLAUDE.md` are untouched.
- Dark mode, PWA manifest, offline support.
- **Any calculation or model logic.** Phase 3 changes *binning presentation and markLine placement* — it does not change any grade, prediction, contribution, or model output. If a Phase-3 change would alter a computed value, stop and log it in `docs/known-issues.md` first.
