// Team metadata helpers (colors, logos, WCAG-readable text color).
import { getTeams } from "../data/loader";

export interface TeamMeta {
  abbr: string;
  name: string;
  conference: string;
  division: string;
  color: string;
  color2: string;
  logo: string;
}

let teamsPromise: Promise<Map<string, TeamMeta>> | null = null;

export function getTeamMetaMap(): Promise<Map<string, TeamMeta>> {
  if (!teamsPromise) {
    teamsPromise = getTeams().then((rows) => {
      const map = new Map<string, TeamMeta>();
      for (const r of rows) {
        const abbr = String(r.team_abbr ?? "");
        if (!abbr) continue;
        map.set(abbr, {
          abbr,
          name: String(r.team_name ?? abbr),
          conference: String(r.team_conf ?? ""),
          division: String(r.team_division ?? ""),
          color: normalizeHex(r.team_color) ?? "#333333",
          color2: normalizeHex(r.team_color2) ?? "#777777",
          logo: String(r.team_logo_espn ?? r.team_logo_wikipedia ?? ""),
        });
      }
      return map;
    });
  }
  return teamsPromise;
}

export function normalizeHex(c: unknown): string | null {
  if (c == null) return null;
  const s = String(c).trim().replace(/^#/, "");
  if ((s.length === 3 || s.length === 6) && /^[0-9a-fA-F]+$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

/** Black or white text depending on background luminance. */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((ch) => ch + ch).join("") : s;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.35 ? "#000000" : "#ffffff";
}
