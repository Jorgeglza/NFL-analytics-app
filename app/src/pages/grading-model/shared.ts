// Shared helpers for the Grading Model tabs (ports of season/weekly/teams tab utils).
import type { Row } from "../../lib/data/loader";

/** {team: "W-L" | "W-L-T"} from completed games in a season (all game types). */
export function seasonRecords(schedule: Row[], season: number): Map<string, string> {
  const rec = new Map<string, { w: number; l: number; t: number }>();
  const bump = (team: string, r: "w" | "l" | "t") => {
    if (!rec.has(team)) rec.set(team, { w: 0, l: 0, t: 0 });
    rec.get(team)![r]++;
  };
  for (const g of schedule) {
    if (Number(g.season) !== season || g.home_score == null || g.away_score == null) continue;
    const hs = Number(g.home_score);
    const as_ = Number(g.away_score);
    const ht = String(g.home_team);
    const at = String(g.away_team);
    if (hs > as_) {
      bump(ht, "w");
      bump(at, "l");
    } else if (as_ > hs) {
      bump(at, "w");
      bump(ht, "l");
    } else {
      bump(ht, "t");
      bump(at, "t");
    }
  }
  const out = new Map<string, string>();
  for (const [t, r] of rec) out.set(t, r.t === 0 ? `${r.w}-${r.l}` : `${r.w}-${r.l}-${r.t}`);
  return out;
}

export interface WeekGameInfo {
  opp: string;
  won: boolean;
  resultLine: string; // "W 24–17 vs DAL"
}

/** Per-team result line for a season/week (completed games only). */
export function weekGameInfo(schedule: Row[], season: number, week: number): Map<string, WeekGameInfo> {
  const out = new Map<string, WeekGameInfo>();
  for (const g of schedule) {
    if (Number(g.season) !== season || Number(g.week) !== week) continue;
    if (g.home_score == null || g.away_score == null) continue;
    const hs = Number(g.home_score);
    const as_ = Number(g.away_score);
    const ht = String(g.home_team);
    const at = String(g.away_team);
    const resH = hs > as_ ? "W" : hs < as_ ? "L" : "T";
    const resA = as_ > hs ? "W" : as_ < hs ? "L" : "T";
    out.set(ht, { opp: at, won: resH === "W", resultLine: `${resH} ${hs}–${as_} vs ${at}` });
    out.set(at, { opp: ht, won: resA === "W", resultLine: `${resA} ${as_}–${hs} @ ${ht}` });
  }
  return out;
}

/** rank(ascending=False, method="min") — 1 = best. */
export function rankDesc(values: number[]): number[] {
  return values.map((v) => values.filter((x) => x > v).length + 1);
}

/** Axis limits rounded to nearest 5 with ±5 padding, like the old scatter helpers. */
export function axisRange(vals: number[]): [number, number] {
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 10;
    hi += 10;
  }
  return [Math.floor(lo / 5) * 5 - 5, Math.ceil(hi / 5) * 5 + 5];
}

export function medianOf(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function hexToRgb(h: string): [number, number, number] {
  let s = h.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** n on-brand colors blending primary -> secondary (or white), port of _team_palette. */
export function teamPalette(n: number, primary: string, secondary: string): string[] {
  if (n <= 0) return [];
  const p = hexToRgb(primary || "#333333");
  let sHex = secondary || "#ffffff";
  if (primary && secondary && primary.toLowerCase() === secondary.toLowerCase()) sHex = "#ffffff";
  const s = hexToRgb(sHex);
  if (n === 1) return [primary || "#333333"];
  const colors: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 0.8;
    const rgb = p.map((pv, k) => Math.round(pv + (s[k] - pv) * t));
    colors.push(`#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`);
  }
  return colors;
}

/** Opponent label from game_id ("2024_05_DAL_SF" → "@SF" for DAL, "DAL" for SF). */
export function opponentLabel(gameId: string, team: string): string {
  const parts = gameId.split("_");
  if (parts.length !== 4) return "";
  const [, , away, home] = parts;
  if (team === away) return `@${home}`;
  if (team === home) return away;
  return "";
}
