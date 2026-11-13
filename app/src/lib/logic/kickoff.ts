// nflverse schedule times are US Eastern wall-clock (`gameday` "YYYY-MM-DD" +
// `gametime` "HH:MM", ET with DST). Parsing them as local time shows a 13:00 ET
// kickoff as "1:00 PM" everywhere (audit B9). These helpers convert to the
// real instant, so the browser can format it in the viewer's own timezone.

const NY = "America/New_York";

/** Minutes NY is offset from UTC at `instantMs` (e.g. -240 on EDT, -300 on EST). */
function nyOffsetMinutes(instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - instantMs) / 60000);
}

/** Epoch ms of an Eastern wall-clock date/time, or null if unparseable. */
export function easternToEpochMs(gameday: unknown, gametime: unknown): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(gameday ?? ""));
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(gametime ?? ""));
  const [h, mi] = t ? [Number(t[1]), Number(t[2])] : [12, 0];
  const wallAsUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, mi);
  // Two passes handle the DST boundary (offset at the guess vs. the result).
  let ms = wallAsUtc - nyOffsetMinutes(wallAsUtc) * 60000;
  ms = wallAsUtc - nyOffsetMinutes(ms) * 60000;
  return ms;
}

/**
 * Kickoff in the viewer's timezone with its abbreviation, e.g.
 * "Sun, Nov 15, 12:00 PM CST". Date only when there is no `gametime`.
 */
export function formatKickoff(gameday: unknown, gametime: unknown, opts: { weekday?: boolean } = {}): string {
  const ms = easternToEpochMs(gameday, gametime);
  if (ms == null) return "—";
  const hasTime = gametime != null && String(gametime).trim() !== "";
  return new Date(ms).toLocaleString("en-US", {
    ...(opts.weekday === false ? {} : { weekday: "short" }),
    month: "short",
    day: "2-digit",
    ...(hasTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {}),
  });
}
