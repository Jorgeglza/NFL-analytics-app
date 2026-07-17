# NFL Analytics App — Page-by-Page UX & Analytical Audit

**Date:** 2026-07-17
**Scope:** All 13 routes (Home + 12 analysis pages, including all tabs of Matchup Previews and Grading Model), reviewed live in the dev build plus source review of every page component.
**Ground rule respected:** No application code was modified. This document describes desired *outcomes*, not implementations. All current business logic and calculation results are treated as correct (they are parity-verified against the old Dash app per `IMPLEMENTATION_LOG.md`); deviations flagged here are presentation/clarity issues unless explicitly marked as a data inconsistency.

Priority legend: 🔴 High impact · 🟡 Medium impact · 🟢 Low impact

---

## 1. Home (`/`)

### Objective
Orient a returning user: what does this app do, how fresh is the data, and where do I go for the task I have in mind (pick games, find props, check team strength)?

### Current content
- Hero with tagline + 4 meta stats (seasons span, games, team-weeks, model grades) and a "data updated" date.
- Three grouped card sections (Game Analysis 6, Player Analysis 5, Data 1) with per-page descriptions.

### Assessment
- The meta stats (6,003 team-weeks, 5,662 grades) are impressive but not decision-relevant; the *data-updated date* is the one piece a bettor actually needs, and it's the smallest text on the page.
- Page cards describe *features* ("spread scatter and pick tracking") rather than *questions answered* ("Who should I pick this week?"). A new user can't tell Game Picks, Spread Win %, and Matchup Previews apart from the descriptions — all three sound like "picks".
- Nothing on the page reflects the *current NFL week* — no "Week 18 is live, 16 games, here are the model's top picks" entry point. The Home page is a static directory when it could be the weekly launchpad.

### Layout & hierarchy
Clean and well-ordered. Hierarchy issue is only that everything has equal weight — there is no "start here this week" affordance.

### Data & analytical value
- 🔴 Missing: a "this week" strip (current season/week, games count, kickoff dates, links pre-filtered to that week). Every analysis page independently makes the user re-select the week; Home could seed that context.
- 🟢 The 4 meta stats could double as data-freshness diagnostics (e.g., last week ingested) rather than lifetime totals.

### Visual effectiveness
Fine. Cards, emoji group icons, and counts are readable.

### User experience
Good. One dead-end: card descriptions duplicate the navbar dropdown descriptions exactly — no added value from visiting Home vs. opening the dropdown.

### Improvement opportunities
- 🔴 Make Home answer "what should I look at *this week*" — surface current week, freshness, and direct links that carry the week context into the pages.
- 🟡 Rewrite card descriptions as user questions ("Which favorites are safe this week?") to differentiate the three picks-oriented pages.
- 🟢 Consider a compact "model health" stat (last week's pick accuracy) as a trust signal.

### Recommended direction
A weekly launchpad: current-week banner → grouped page cards phrased as questions → data-freshness footer. The insight that should stand out immediately: *what week we're in, when data was refreshed, and where to start*.

---

## 2. Game Picks (`/game_analysis/game_picks`)

### Objective
Review one week's slate: results (or upcoming games), spreads, and how each game resolved by win type; track manual picks for unplayed games.

Questions: What happened this week? Which favorites/underdogs won? What does the spread landscape of the week look like? Which picks did I make and how are they doing?

### Current content
- Season + Week dropdowns.
- Games table (date, teams, scores, spread, win type) with win-type-tinted rows and manual-winner checkboxes for unplayed games (persisted in localStorage).
- Win-type counts bar with count/% labels and a "No result yet" bucket.
- Spread-by-win-type scatter with ×N collision markers.

### Assessment
- The table is the right core. Win-type tinting works but is the *only* encoding of who won — there is no bold/checkmark on the winning team, so the user must decode the tint + spread sign to figure out the winner. Color-only encoding is also an accessibility risk.
- The counts bar and scatter both summarize the same one-week slate (max 16 points); the scatter carries little insight at week granularity — spread-vs-win-type patterns only emerge across many weeks (which is exactly what Spread Win % does better).
- Manual picks exist but have no scoreboard: no "your picks: 9/12 correct" summary, which is the entire payoff of tracking picks.

### Layout & hierarchy
Filter bar → table → charts is logical. The charts sit below the fold and feel like an appendix. No week navigation affordance beyond the dropdown (no prev/next week).

### Data & analytical value
- 🔴 Default selection lands on the **last week that exists in the data** (Week 22 = Super Bowl, a 1-row table) instead of the *current/most relevant* week. First impression for most of the offseason is a nearly empty page. Other pages default to Week 18 — inconsistent (see cross-page review).
- 🟡 Missing context per game: favorite ML/total, or the model's pick (exists on Matchup Previews) — the user reviewing a week must open a second page to see what the model said.
- 🟢 A pick-tracking summary (record, units if desired) would close the loop on the manual-winner feature.

### Visual effectiveness
- Table: good. Consider explicit winner marking beyond row tint.
- Counts bar: fine.
- Scatter: weak at single-week granularity; either give it a clear question to answer or demote it.

### User experience
- Win-type color legend is implicit (learned from the counts bar); a first-time user sees tinted rows with no key.
- Checkbox affordance for manual winners is discoverable only on unplayed games; there is no explanation on the page that this feature exists.

### Improvement opportunities
- 🔴 Default to the current in-progress week (or last completed week), consistent across the app.
- 🔴 Show pick-tracking results (record for manually picked weeks).
- 🟡 Make the winner explicit in the table (not color-only).
- 🟡 Add prev/next week stepping.
- 🟢 Reconsider the one-week scatter's purpose.

### Recommended direction
The "week in review / week in progress" page. Flow: current week auto-selected → slate table with unmistakable winners and my picks → summary of pick performance → win-type distribution as secondary context. The standout insight: *how the week resolved and how my picks did*.

---

## 3. Win Types (`/game_analysis/win_types`)

### Objective
Understand the long-run structure of NFL outcomes: how often favorites win, how often home teams win, and how the seven-category win-type mix shifts across seasons or weeks.

Questions: Are favorites more/less reliable this season vs. history? Is home advantage changing? Which win types dominate at each grouping?

### Current content
- Group-by toggle (Season / Week).
- One block per season (11 blocks) or per week, each with 3 KPIs (Favorite-is-Home %, Favorite-Win %, Home-Win %), a stacked win-type bar with count/% labels and a dashed Home-Favorite line, and a spread scatter with ×N markers.

### Assessment
- The KPIs are exactly the right numbers. The problem is *format*: 11 stacked blocks force the user to scroll and memorize to answer the page's core question, which is inherently comparative ("is 2025's 65% favorite-win rate high or low?"). The trend across seasons is the insight, and it is never drawn as a trend.
- Each block duplicates a scatter whose value at season granularity is again marginal (271 points collapse into bands); across 11 blocks that's ~22 canvas charts, which also makes the page heavy (this app's known screenshot/render timeouts are worst here).

### Layout & hierarchy
Within a block, KPIs → bar → scatter is fine. Across the page, there is no summary layer above the blocks — the most important information (the cross-season trend) is not visible anywhere.

### Data & analytical value
- 🔴 Missing: cross-group trend view — the three KPIs as lines across seasons (or weeks), so deviations pop out. All the numbers already exist on the page; only the comparative presentation is missing.
- 🟡 A league-history benchmark line/band (e.g., 10-year average favorite-win %) would let each season's KPI be read as above/below normal.
- 🟢 In Week grouping, mixing all seasons per week number is a legitimate cut but is never labeled as such — clarify what population each week block covers.

### Visual effectiveness
- Stacked bars with in-bar count|% labels: good.
- Repeated per-block scatters: high cost, low message. One scatter for a *selected* block would serve better than 11 always-rendered ones.

### User experience
Long scroll with no way to jump to a season and no way to see two seasons side by side. No explanation of the 7 win-type categories or the quirky buckets ("(No Score)", played pick'em → Underdog) — these are preserved old-app behaviors that will confuse anyone who didn't build the app.

### Improvement opportunities
- 🔴 Add a comparative summary (KPI trends across all groups) at the top; make per-group blocks the drill-down.
- 🟡 Render heavy charts on demand rather than 22 at once.
- 🟡 Add a win-type glossary/legend explaining the 7 categories and edge-case buckets.
- 🟢 Jump navigation (season index) for the block list.

### Recommended direction
"Trends first, blocks second." Top: three KPI trend lines with a historical-average band. Below: selectable season/week detail block. The standout insight: *how this season's favorite/home dynamics compare to history*.

---

## 4. Team Comparison (`/game_analysis/team_comparison`)

### Objective
Head-to-head evaluation of two teams at a chosen week: who is better overall/offense/defense, in which stats, and with what trend — the "should I favor Team A?" workhorse.

### Current content
- Season, Week, Team 1/Team 2 selectors.
- Per team: record, grades (Ovr/Off/Def), Points-Margin-by-week chart, Points-Margin-vs-Opp-Allowed chart.
- Center column: stat pills (Last/Total/Avg) per stat with league-rank bars (#N), grouped Overall / Offensive / Defensive, with +/– breakdown buttons for substats.

### Assessment
- The center rank-bar column is the strongest single component in the app: values + league context in one glance. The Session-3 redesign (pills, legend, rank labels) reads well.
- **Data gap displayed as content:** Turnover Margin / Turnovers / Turnovers Allowed rows render `--` and `0` for every team (turnover data is null in the pipeline — a known issue). Three permanently dead rows in the most prominent component erode trust; the page should either explain the gap or not show the rows until the pipeline provides the data. *(Flagged as a data inconsistency worth resolving at the source.)*
- Grades (Ovr 55 / Off 40 / Def 63) appear with zero scale context — is 55 good? The Weekly Grading tab knows the league mean is ~54 with σ≈12; none of that context reaches this page.

### Layout & hierarchy
3-column layout is right. The two side charts per team are below the grades and compete with the center column; their titles ("Points Margin Vs Opp Allowed — Wk18") are terse and their purpose (trend/matchup framing) isn't stated.

### Data & analytical value
- 🟡 Grades lack league context (rank or percentile next to the number would resolve it — the data already exists in grades.json).
- 🟡 No direct link to the corresponding Matchup Preview when the two selected teams actually play each other that week — a natural journey the app already supports elsewhere.
- 🟢 "Last" column is the single last game; a Last-3 form indicator is available data and matches how bettors think, but only add it if the Last/Total/Avg triple is felt insufficient.

### Visual effectiveness
- Rank bars: excellent. One caveat: bar direction/length semantics ("bar = league rank") are explained only in a small hint line; for defensive stats where low rank = good, the user must trust the inversion was handled.
- Side charts are small multiples without shared scales between the two teams — comparing margins visually across the two teams is harder than it needs to be.

### User experience
Team pickers default to a fixed pair rather than anything contextual; selecting is easy. Substat +/– expanders are discoverable. No loading jank observed.

### Improvement opportunities
- 🔴 Resolve or explain the dead turnover rows (pipeline fix preferred; interim: an explicit "unavailable" treatment).
- 🟡 Give grades scale context (rank/percentile).
- 🟡 Align/share scales between the two teams' margin charts.
- 🟢 Cross-link to Matchup Preview / Scorecards for the selected teams.

### Recommended direction
Keep the structure; polish trust and context. The standout insight: *which team holds the edge, in which phase, backed by league ranks* — with no placeholder rows undermining it.

---

## 5. Scorecards — Teams (`/game_analysis/scorecards_teams`)

### Objective
A one-team identity card: how does this team play (pass/rush lean on both sides of the ball) and how do its core stats total up for the season?

### Current content
- Season + Team selectors; record; Offense Style & Defense Style donuts; Offense/Defense stat cards (points, passing, rushing, TDs) with sparklines.

### Assessment
- The playstyle donuts are a distinctive, on-objective element.
- **Labeling problem:** stat cards show season totals next to per-game or rate labels — e.g. `4735 / Pass Yds/Gm`, `419 / Comp/Gm`, `Points 471 / 6.7 Passing EPA` are rendered as adjacent value/label pairs whose pairing is ambiguous or wrong on read (4,735 is clearly a season total, not yards *per game*). Whether this is a label bug or a layout-adjacency artifact, the user cannot trust which number belongs to which label. *(Presentation inconsistency — the underlying values match the old app.)*
- Values have no league context: 471 points allowed is meaningless without a rank — and ranks exist elsewhere in the app for these very stats.

### Layout & hierarchy
Donuts before stats is right (identity first). Offense and Defense mirror each other well. Only one team visible at a time — fine for the objective, but there is no "vs league average" anchor anywhere.

### Data & analytical value
- 🔴 Fix/clarify the value↔label pairing on every stat card.
- 🟡 Add league rank or league-average reference per card (data already computed for Team Comparison).
- 🟢 Sparklines are unlabeled (no axis, no hover cue in some cards) — fine as texture, but a min/max or last-value marker would make them informative.

### Visual effectiveness
Donuts: good format for 2–3-way splits; ensure segment labels state what the split is measuring (yards share? play share? EPA share?) — currently the metric behind "Style" is not disclosed on the page.

### User experience
Simple and fast. Missing: any link to the team's Grading Model view or Team Comparison — the natural next steps after reading an identity card.

### Improvement opportunities
- 🔴 Unambiguous stat labeling (value, unit, and aggregation level explicit).
- 🟡 League context per stat block; disclose the metric behind the style donuts.
- 🟢 Cross-links to the same team in Grading Model / Team Comparison.

### Recommended direction
A trustworthy team identity card: style donuts (with stated metric) → cleanly labeled stat blocks with league rank chips → sparklines as trend texture. Standout insight: *this team's playing identity and where it sits in the league*.

---

## 6. Spread Win Percentage (`/game_analysis/spread_win_percentage`)

### Objective
Quantify how reliably favorites win as a function of spread size — the empirical backbone for spread-based picking — and apply it to a chosen week ("Weekly Picks").

### Current content
- Filters: multi-select Season/Week, win types, bin size (0.5/1/2), signed/absolute mode, min-N, CI toggle.
- 6 KPIs; calibration chart, win-type heatmap, 100%-stacked mix, lift curve; full bucket table with Wilson CIs; Weekly Picks panel (own season/week selectors) with expected favorite share, per-game recommended picks, confidence, low-N notes.

### Assessment
- Analytically the richest and most rigorous page in the app; the KPI set, calibration + CI, and the honest "Low N" notes are excellent.
- It is also the most expert-facing: "lift", "CI (Calibration)", "Wilson", signed vs. absolute spreads, min-N greying — none of these are explained in-page. The audience that needs this page's conclusion ("lay big favorites, fade small ones") may not survive its vocabulary.
- The Weekly Picks panel is effectively a second page embedded at the bottom, with its *own* season/week controls that ignore the top filters. Two filter systems on one page, with different semantics (top = historical population; bottom = target week), is the page's main comprehension hazard — the relationship is real and correct but never stated.

### Layout & hierarchy
KPIs → charts → table → picks is a sound "evidence then application" flow, but the application (Weekly Picks — the actionable part) is buried at the very bottom of a long page.

### Data & analytical value
- The right numbers are present. 🟢 Only gap: the Weekly Picks table shows historical fav % and the actual winner but no running tally of how these bucket-based picks performed for the week/season shown (the accuracy question is answered only on Matchup Previews, for a *different* engine — see cross-page review).

### Visual effectiveness
- Calibration with CI: best chart in the app.
- Heatmap + 100% stacked mix partially duplicate each other (both show win-type composition by bucket); one of the two carries the message.
- Bucket table: greyed low-N rows are a great pattern; "Season span" column earns its place with multi-season filters.

### User experience
- 🔴 The historical-population vs. target-week duality needs one sentence of framing where the panels meet.
- 🟡 Filter literacy: bin size / signed vs absolute / min-N / CI deserve one-line explanations (tooltip-level).
- 🟢 Multi-select chips work well.

### Improvement opportunities
- 🔴 Clarify the two-filter-system relationship; consider surfacing the picks panel (or a summary of it) higher.
- 🟡 Merge or differentiate the heatmap vs. stacked-mix pair.
- 🟡 Add plain-language explanations for the statistical controls.
- 🟢 Weekly Picks hit-rate tally.

### Recommended direction
Keep the rigor; add the narration. Flow: "How reliable are favorites by spread?" (KPIs + calibration) → "What's the composition?" (one composition chart) → "Apply it to week X" (picks with performance tally). Standout insights: *the calibration curve and this week's bucket-based picks*.

---

## 7. Matchup Previews (`/game_analysis/matchup_previews`)

### 7a. Week Preview tab

**Objective:** For a chosen week, see every game's win probabilities under four models, the pick, and (for completed games) whether it hit.

**Assessment.** Cards show all four model probabilities as four text lines per game, with the selected "primary metric" driving the pick. Content is complete and correct; the format is text-dense — 16 cards × 4 lines makes cross-model *disagreement* (the interesting signal, e.g. DAL@NYG: Trend 36% vs ML Fair 60%) invisible without reading every line. Accuracy KPI + win-type mini-KPIs on top are well placed. "FH/FA" corner badges rely on hover titles to decode.

- 🟡 Make model disagreement scannable (the four probabilities are the same quantity — they beg for a compact comparative encoding per card rather than four prose lines).
- 🟡 Sort by "Highest prob" exists; a "most model disagreement" ordering would directly serve the value-hunting user.
- 🟢 Spell out FH/FA/UH/UA on first use.

### 7b. Matchup tab

**Objective:** Deep single-game dossier: grades, market snapshot (spread/total/ML with implied & fair probs, overround), spread-pick engine with historical bucket evidence, trend-edge predictor, recent form, all-time head-to-head.

**Assessment.** The best "one game" view in the app; the Matchup Snapshot (implied vs fair probability, vig) is a genuinely educational component. Issues are mostly framing:
- "All-Time Matchup" only covers 2015+ (dataset start) — the label overpromises; say "since 2015".
- The Spread Pick Engine block exposes internals (bucket id, N=388, Grades Δ) with no hierarchy between *the pick* and *the evidence*; the pick line reads as one dense sentence.
- Trend Edge Predictor's stat-selector + rank bar + two trend charts ask the user to do the synthesis themselves; the block never states *which team the trends favor overall* even though the engine computes a trend pick.
- Recent Form tables: the Opp column mixes perspective (`TB`, `@TB`) without a header explaining home/away notation.

- 🟡 Lead each engine block with its conclusion, evidence second.
- 🟢 Rename all-time section; explain @-notation.

### 7c. Model Overview tab

**Objective:** Judge the pick engine's historical accuracy across all seasons/weeks.

**Assessment.** Computes ~2,300 games client-side (~2s) and renders a giant grid: one row per week, one cell per game, confidence % per cell, green = correct. As an at-a-glance texture ("mostly green, greener at high confidence?") it works; as an analytical answer it under-delivers: the core question — *does accuracy rise with confidence?* — is answered nowhere, despite min-confidence filter + accuracy KPI allowing the user to grind it out manually, one threshold at a time.
- 🔴 The page should answer accuracy-by-confidence directly (a small summary by confidence band would replace dozens of manual filter passes).
- 🟡 The grid's per-cell numbers (2,300 tiny percentages) add noise; the color already carries correctness. Consider the numbers as hover detail.
- 🟢 A "Correct %" column colored/benchmarked against break-even would make weekly rows readable.

### Recommended direction (page)
The app's flagship. Week Preview = scan + disagreement; Matchup = conclusion-first dossier; Model Overview = trust dashboard led by accuracy-vs-confidence. Standout insights: *who the models like, where they disagree, and whether to trust them*.

---

## 8. Prop Bets — Players (`/player_analysis/prop_bets_players`)

### Objective
Given a player, stat, and prop line: how often has the player cleared the line this season, and what does the week-by-week record look like?

### Current content
Season-type/Season/Team/Side/Stat filters; Set Line input; pivot table (player × week values + total); selected-player bar chart vs line; made-vs-below donut.

### Assessment
- The pivot + line + hit-rate flow matches the job exactly.
- **Stat selector is a wall of ~44 raw snake_case names** (`passing_yards_after_catch`, `pacr`, `wopr`, `racr`...) with no grouping or ordering by relevance. Actual prop markets are ~10 stats; the rest are noise for this page's purpose. Same issue recurs on 4 other pages (see cross-page).
- The pivot mixes prop-relevant players with noise rows (punters with 28 passing yards, `-2` totals) because it lists everyone with any value; the user's target is the top 1–3 players per team/stat.
- Missing weeks (byes) silently drop columns (W8 absent) — correct behavior, never explained.
- Hit-rate output ("Made vs Below line" donut) doesn't state the numbers as odds or compare to a book's implied probability — but computing fair odds from hit-rate is exactly what Parlay Builder does; the two pages don't share it.

### Layout & hierarchy
Filters → pivot → detail is fine. The Set Line input is the pivotal control but is visually just another filter box; its effect (colors the detail chart/donut) is not obvious until used.

### Data & analytical value
- 🟡 Hit-rate as N/M with implied fair odds would complete the page's answer.
- 🟡 Recent-form weighting is a natural user question ("has he cleared it in the last 5?") — the bar chart shows it but nothing summarizes it.
- 🟢 League/opponent context deliberately lives on Matchup/Value Bets — keep this page simple, but link onward.

### Visual & UX
- Bar-vs-line chart is the right visual. Donut for a 2-value split is decoration; the number itself is the message.
- Stat names leak the data layer; the same stats appear Title-Cased on Grading Model pages — inconsistent vocabulary.

### Improvement opportunities
- 🔴 Curate/group the stat list (prop-market stats first, everything else behind an "advanced" tier) — applies to all 5 player pages.
- 🟡 Elevate the line-setting interaction and summarize the result in words ("cleared 250.5 in 8 of 14 games, 57%").
- 🟢 De-noise the pivot (relevance ordering already partially there via totals).

### Recommended direction
"Player vs line" calculator: pick player + stat → set line → immediate verdict sentence with hit rate, implied odds, and week bars. Standout insight: *how often the line was cleared and what that's worth*.

---

## 9. Build Parlay (`/player_analysis/build_parlay`)

### Objective
Assemble multi-leg player-prop parlays and see combined historical probability and fair odds.

### Current content
Header KPIs (Expected Probability / Expected Odds); per-leg filter set (season, type, week, team, stat type, stat, player, line); leg cards with hit-rate rings; add-leg button.

### Assessment
- The core computation (product of per-leg hit rates → expected odds) is the page's whole value and it works.
- Empty state is a wall of every filter option with `—` KPIs; nothing tells the user "pick a team, stat, player, then set a line" — the workflow order must be inferred.
- Known preserved quirks are UX debt: **Week dropdown is displayed but unused in the calculation**, and the player list ignores season type. A visible control that does nothing is worse than no control. *(Deliberate parity decision — flag for a product decision rather than silent preservation.)*
- Legs don't warn about correlation (same-game legs multiply as independent) — a methodological caveat that materially affects the number shown; one sentence of disclosure would keep the tool honest.

### Layout & hierarchy
KPIs on top is right (the answer stays visible while building). Leg builder below is serviceable.

### Improvement opportunities
- 🔴 Guided empty/first-leg state (what to do, in what order).
- 🟡 Resolve or remove the inert Week control (product decision).
- 🟡 Independence disclaimer, strongest when legs share a game.
- 🟢 Persist parlays across visits (picks already persist on Game Picks — inconsistent memory model).

### Recommended direction
A focused calculator: add legs → each leg shows its own hit rate → combined probability + fair odds always visible, with honesty about independence assumptions. Standout insight: *what this parlay is really worth historically*.

---

## 10. Player Team Stats (`/player_analysis/player_team_stats`)

### Objective
League-wide scan: for one stat, who are the top players on every team — organized by conference/division.

### Current content
Season-type/Season/Side/Stat filters, weeks-range control, 32 team cards (division-ordered) each with a top-5 player bar chart on a shared x-axis.

### Assessment
- The shared x-axis across all 32 charts is the page's best decision — it makes cross-team magnitude comparison honest.
- 32 always-rendered canvas charts is the app's heaviest render after Win Types; the page answers "who leads each team" but not the more common "who leads the *league*" — there is no flat top-N view across teams, even though the data is on the page.
- Same raw-stat-name selector issue as Prop Bets.

### Layout & hierarchy
AFC → NFC with division subheads is scannable. No jump links; finding NFC West means scrolling past 24 cards.

### Improvement opportunities
- 🟡 A league-wide top-N strip above the team grid would answer the page's most common question instantly.
- 🟡 Division/conference jump navigation.
- 🟢 Render charts lazily as they scroll into view (page weight).

### Recommended direction
"League leaders, then team-by-team." Standout insight: *who dominates this stat league-wide and within each team* — currently only the second half is served.

---

## 11. Matchup Bets (`/player_analysis/matchup_bets`)

### Objective
For one game: which player-stat combinations face the weakest opposing defense (mismatch edges), and what has each relevant player produced weekly.

### Current content
Season/Week/Game/Stat filters + Set Line; Mismatch panel (Top-N, Best Edge / Avg Edge KPIs, formula caption); opponent-allowed & rank chart; player pivot (both teams); per-player detail chart + made/below donut.

### Assessment
- The edge formula caption ("Edge = Offense strength (inverted rank) + Opponent allowed rank. Higher = better") is the right instinct — the only in-page methodology note in the player section — but "52.0" still lacks a scale (out of what? what's a big edge?).
- **Stat selector is ~130 raw names including punting internals** (`pt_touchback`, `fg_missed_50_59`) — the worst instance of the shared stat-list problem; the mismatch concept only makes sense for a dozen offensive stats.
- The pivot repeats the Prop Bets pattern (good — consistency), and the flow mismatch → chart → player detail is a genuinely useful drill-down.
- Default week uses browser-local timezone (documented deviation) — benign, but week defaults should be one shared rule app-wide.

### Improvement opportunities
- 🔴 Curate the stat list to mismatch-meaningful stats.
- 🟡 Give the edge score a scale (range, percentile, or qualitative bands) so 52.0 means something.
- 🟢 Cross-link each player row to Prop Bets with context carried over.

### Recommended direction
"Game-level prop prospector": pick game + stat → ranked mismatches with a scaled edge → opponent-allowed evidence → per-player line check. Standout insight: *which players in this game face the softest defense for this stat*.

---

## 12. Value Bets (`/player_analysis/value_bets`)

### Objective
Week-wide scan (not single-game): find the biggest offense-vs-defense ranking mismatches across all matchups for one stat, and identify the players positioned to exploit them.

### Current content
Season/Week/Stat filters; Top-N control; 4 KPIs (avg mismatch, best score, avg opp allowed, avg per player); rank-comparison chart (logos + score labels); player pivot with above-average highlighting; helper scatter.

### Assessment
- Clear objective, and the rank-comparison chart with logos is the right centerpiece.
- The player pivot explodes: for top-5 team mismatches it lists **every** player on those offenses (50+ rows including `Ray Davis +31 / 86 total yards` class rows) with full 18-week columns — the signal (top 2–3 players per mismatched team) is drowned in roster noise. The +N mismatch value repeats identically for every player of a team, spending a column on team-level info in a player table.
- Rank semantics ("Y: Rank 1 best", mismatch = sum of rank gaps) again require prior knowledge; KPIs like "AVG PER PLAYER (TABLE) 19.8" summarize the noisy table, not the decision.
- Overlap with Matchup Bets is significant: same mismatch machinery, different scope (week-wide vs single game). The pages never reference each other, and their edge scores use different constructions (to-date-mean ranks vs carry-forward ranks) without saying so — a user who sees "+31" here and "52.0" there has no way to reconcile them.

### Improvement opportunities
- 🔴 Prioritize the pivot: top players per mismatch first, full roster behind an expansion.
- 🟡 State the relationship (and methodological difference) between Value Bets and Matchup Bets edges; cross-link "drill into this game → Matchup Bets".
- 🟢 KPI set could shrink to the two that matter (best mismatch, avg of top-N).

### Recommended direction
Weekly value radar: ranked mismatches with logos → the handful of players who carry each mismatch → hand-off to Matchup Bets for the game-level dig. Standout insight: *this week's top exploitable defense-vs-offense gaps and who benefits*.

---

## 13. Grading Model (`/data/grading_model`)

### 13a. Season tab
League-wide grade landscape for a season: overall/off/def grade charts + off-vs-def scatter. Serves orientation well; charts are canvas-only with no table fallback and no explanation of what a "grade" is (scale, construction) anywhere on the entry tab — the model's front door has no doorplate. 🟡 A 2–3 sentence model explainer (Random Forest, trained on X, grade = scaled prediction, league-mean ≈ 50s) belongs here.

### 13b. Teams tab
Single-team drill-down: weekly contribution chart, top drivers, waterfall, drivers-vs-actual-stats table, per-stat selector. This is the model-interpretability core and is genuinely strong analytically. Assessment:
- The drivers table shows *scaled contributions* next to *raw stats* — the distinction ("Avg" vs "Avg. Cont.") is explained in one caption line that carries the entire comprehension burden of the tab.
- The stat selector is the 130-item raw list again (Title-Cased here — a third naming variant).
- 🟡 Missing-week columns (bye) appear/disappear silently; W10 absent for DAL.

### 13c. Weekly tab
Distribution + ranking for one week: histogram, box plot, ranked table with Z/percentile. The stat KPIs (mean/median/σ/IQR/min-max) are the context every *other* page's grade displays lack. 🟢 Well-formed; its only issue is isolation — Team Comparison and Matchup previews show grades without this context and don't link here.

### 13d. Features tab
Global feature importances: bar, cumulative curve, full table split Overall/Offense/Defense. Fine for its audience. "Refer to the NFL feature glossary" references a glossary that is not linked or present in-app — a dangling pointer. 🟢 Link or embed it.

### Recommended direction (page)
The model's home: explain the model once (Season tab header), keep Teams as the "why is my team graded X" explainer, Weekly as the distribution context provider, Features for the curious. Standout insight: *what the grades mean and why a given team earned theirs* — the "what they mean" half is currently missing.

---

# Cross-Page Review

## Repeated components that should share one pattern
1. **Stat selectors** — five player pages + Grading Model Teams tab all expose the raw pipeline stat list, in three formats (snake_case ~44 items, snake_case ~130 items, Title Case ~130 items). One shared, curated, grouped stat picker (common prop stats first, advanced tier below, consistent display names) is the single highest-leverage shared fix.
2. **Player pivot table** (Prop Bets, Matchup Bets, Value Bets) — same weekly-columns pivot in three places with different row-inclusion and highlighting rules. Good candidate for one component with one relevance-ordering and one "missing week = bye" convention, explained once.
3. **Set Line → hit-rate detail** (Prop Bets, Matchup Bets, Parlay legs) — same interaction three times; should look and phrase results identically (including "N of M, X%" wording and implied-odds framing if adopted).
4. **Grades display** (Team Comparison, Matchup tab, Grading Model) — grade numbers appear with different framing everywhere and with distribution context only on Weekly tab. One shared "grade chip" convention (value + rank/percentile) would propagate context app-wide.
5. **Win-type vocabulary** — full labels (Game Picks, Win Types, Spread Win %), FH/FA/UH/UA codes (Week Preview), colors implied by charts. One legend component + consistent color mapping.
6. **×N collision markers, low-N greying, "Low N" notes** — good honesty patterns that already recur; codify them so every small-sample number in the app gets the same treatment.

## Overlapping objectives
- **Three "who wins this week" surfaces**: Spread Win % Weekly Picks (bucket-historical engine), Matchup Previews Week Preview (4-model engine), Game Picks (manual). They can *disagree* — e.g. 2025 Week 18 CAR@TB: Spread Win % recommends **Underdog away (CAR)** while Matchup Previews picks **TB** (which won). Nothing tells the user these are different engines or how each has performed. Either present them as competing models in one place or clearly position each page's engine and cross-reference.
- **Matchup Bets vs Value Bets**: same mismatch idea at two scopes with different rank constructions and different score scales, unexplained. Position as a two-step journey (Value Bets = weekly radar → Matchup Bets = game drill-down).
- **Scorecards vs Team Comparison vs Grading Model Teams**: three team-centric views (identity / head-to-head / model drivers) that never link to each other despite sharing the team+season selection.

## Disconnected user journeys / gaps
- **No context carry-over**: every page independently defaults and re-asks season/week/team. Following one game from Game Picks → Matchup Preview → Matchup Bets means re-selecting the same game three times. A shared season/week (and where sensible, team/game) context — or at minimum links that carry parameters — is the biggest navigation win available.
- **Inconsistent week defaults**: Game Picks lands on Week 22 (last row in data), most pages on Week 18, Matchup Bets derives "current week" from browser timezone. One shared "default week" rule.
- **No onward links anywhere**: zero cross-page links exist outside the navbar.

## Global opportunities
- 🔴 **Terminology & literacy layer**: the app assumes fluency in Wilson CIs, lift, overround, EPA, WOPR, rank inversions, and its own win-type taxonomy. A consistent lightweight explanation pattern (one-line captions/tooltips, one glossary — which the Features tab already promises but doesn't deliver) would widen the audience without dumbing anything down.
- 🔴 **Conclusion-first framing**: several strong analytical blocks (Spread Pick Engine, Trend Edge, Model Overview, Value Bets pivot) present evidence before, or instead of, the verdict. The app's data is decision-grade; its pages should lead with the decision.
- 🟡 **Render weight**: Win Types (~22 charts), Player Team Stats (32 charts), Model Overview (2,300-cell grid) are heavy enough to time out headless screenshots; lazy/on-demand rendering would help real users on modest hardware too.
- 🟡 **Accessibility**: winner/pick correctness and win types are frequently color-only encodings; small uppercase micro-labels run ~10px; canvas charts have no text alternative. Adding non-color redundancy (marks, text) for the key encodings is the priority subset.
- 🟡 **Responsiveness**: multi-column layouts (Team Comparison 3-col, wide pivots with 18 week columns) need a defined small-screen behavior; wide tables should scroll within their cards.
- 🟢 **Empty/edge states**: sparse-week views (Week 22 = 1 game), pre-selection states (Parlay), and null-data rows (turnovers) each currently render "less page" rather than explaining themselves.

## Data inconsistencies noted (source-level, not presentation)
1. Turnover margin / turnovers / turnovers-allowed are null in pipeline data → dead rows in Team Comparison and a permanently zero "turnover margin" driver row in Grading Model Teams tab. (Known issue; resolving it upgrades two pages at once.)
2. Scorecards stat-card value↔label pairing reads wrong (totals under per-game labels) — verify whether labels or adjacency are at fault.
3. "All-Time Matchup" label vs 2015+ data coverage.
4. Parlay Builder's inert Week control and season-type-ignoring player list (preserved quirks — decide, don't inherit).

---

# Prioritized Summary (application-wide)

**High impact**
1. Shared week/season context + one default-week rule + parameter-carrying cross-links (Home → weekly pages; Game ↔ Preview ↔ Matchup Bets; Team pages ↔ each other).
2. One curated, grouped, consistently-named stat picker across all player pages and the Teams tab.
3. Conclusion-first restructuring of the decision pages: model disagreement visibility (Week Preview), accuracy-by-confidence answer (Model Overview), prioritized player pivots (Value/Matchup Bets), picks summary (Game Picks).
4. Trust fixes: dead turnover rows, Scorecards labeling, engine-disagreement transparency between the two pick systems.
5. Literacy layer: glossary + one-line method captions for statistical/betting jargon, win-type legend.

**Medium impact**
6. Win Types: comparative trend view above the per-season blocks.
7. Grade context everywhere grades appear (rank/percentile chips sourced from the Weekly-tab statistics).
8. Render-on-demand for the three heaviest pages; defined responsive behavior for wide tables/multi-column layouts.
9. Color-independent encodings for winners/picks/win types.

**Low impact**
10. Empty/edge-state explanations (byes, sparse weeks, pre-selection guidance).
11. League-leaders strip on Player Team Stats; jump navigation on long pages.
12. Pick/parlay persistence consistency; donut de-emphasis where a single number carries the message.
