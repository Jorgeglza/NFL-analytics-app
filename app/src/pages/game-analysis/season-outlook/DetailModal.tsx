import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { PlayoffSimResult } from "../../../lib/logic/playoffSim";
import type { TeamMeta } from "../../../lib/team/meta";
import { Modal } from "../../../components/Modal";
import { useECharts } from "../../../components/charts/useECharts";
import { Card } from "../../../components/ui";

const ITERATIONS = 2000;

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function recordStr(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export default function DetailModal({
  result,
  meta,
  week,
  onClose,
}: {
  result: PlayoffSimResult;
  meta: TeamMeta | undefined;
  week: string;
  onClose: () => void;
}) {
  const accent = meta?.color ?? "#002f6c";
  const teamName = meta?.name ?? result.team;

  const winsOption = useMemo<EChartsOption>(() => {
    const labels = result.winsHistogram.map((_, w) => String(w));
    return {
      grid: { left: 10, right: 10, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: labels, name: "Wins", nameLocation: "middle", nameGap: 22, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: (v: number) => pct(v / ITERATIONS) } },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const { dataIndex, value } = p as { dataIndex: number; value: number };
          return `${value} of ${ITERATIONS.toLocaleString()} simulations finished <b>${dataIndex}-${17 - dataIndex}</b><br/>${pct(value / ITERATIONS)}`;
        },
      },
      series: [
        {
          type: "bar",
          data: result.winsHistogram.map((v, w) => ({
            value: v,
            itemStyle: { color: Math.round(result.avgWins) === w ? accent : "#94a3b8" },
          })),
          barMaxWidth: 20,
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: "#0f172a", width: 2, type: "dashed" },
            label: { formatter: `Current: ${result.currentWins}`, position: "insideEndTop", fontSize: 10, fontWeight: "bold", color: "#0f172a" },
            data: [{ xAxis: String(result.currentWins) }],
          },
        },
      ],
    } as EChartsOption;
  }, [result.winsHistogram, result.avgWins, result.currentWins, accent]);
  const winsRef = useECharts(winsOption);

  const seedOption = useMemo<EChartsOption>(() => {
    const labels = ["Missed", "1", "2", "3", "4", "5", "6", "7"];
    return {
      grid: { left: 10, right: 10, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: labels, name: "Seed", nameLocation: "middle", nameGap: 22, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: (v: number) => pct(v / ITERATIONS) } },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const { dataIndex, value } = p as { dataIndex: number; value: number };
          return `${labels[dataIndex] === "Missed" ? "Missed playoffs" : `Seed ${labels[dataIndex]}`} in ${value} of ${ITERATIONS.toLocaleString()} simulations<br/>${pct(value / ITERATIONS)}`;
        },
      },
      series: [
        {
          type: "bar",
          data: result.seedHistogram.map((v, i) => ({ value: v, itemStyle: { color: i === 0 ? "#cbd5e1" : accent } })),
          barMaxWidth: 28,
        },
      ],
    } as EChartsOption;
  }, [result.seedHistogram, accent]);
  const seedRef = useECharts(seedOption);

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          {meta?.logo && <img src={meta.logo} alt="" className="h-6 w-6 object-contain" loading="lazy" decoding="async" />}
          {teamName} — {result.conference} {result.division}
        </div>
      }
      subtitle={`Record ${recordStr(result.currentWins, result.currentLosses, result.currentTies)} through week ${week} · Playoff ${pct(result.playoffPct)} · Division title ${pct(result.divisionTitlePct)} · Avg seed ${result.avgSeed == null ? "—" : result.avgSeed.toFixed(1)}`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Current record (week {week})</div>
            <div className="text-lg font-extrabold text-slate-800">{recordStr(result.currentWins, result.currentLosses, result.currentTies)}</div>
          </div>
          <div className="text-slate-300">+</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              Expected wins over {result.remainingGames.length} remaining {result.remainingGames.length === 1 ? "game" : "games"}
            </div>
            <div className="text-lg font-extrabold" style={{ color: accent }}>
              {(result.avgWins - result.currentWins >= 0 ? "+" : "")}
              {(result.avgWins - result.currentWins).toFixed(1)}
            </div>
          </div>
          <div className="text-slate-300">=</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Projected final wins (avg)</div>
            <div className="text-lg font-extrabold text-slate-800">{result.avgWins.toFixed(1)}</div>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {ITERATIONS.toLocaleString()} simulated seasons as of week {week}. Standings lock in every result through week {week}; each remaining
          game below is then decided by drawing a random number against the two teams&apos; Elo-implied win probability (frozen as of week {week}).
          The two charts show the spread of outcomes across all {ITERATIONS.toLocaleString()} simulated seasons, not a single prediction.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Win total distribution"
            subtitle={`Dashed line = current wins (${result.currentWins}); avg finish ${result.avgWins.toFixed(1)}`}
            accent="#7c3aed"
          >
            <div ref={winsRef} className="h-48" />
          </Card>
          <Card title="Playoff seed distribution" subtitle={`Share of simulations by finishing seed (${pct(result.playoffPct)} made the playoffs)`} accent="#E87722">
            <div ref={seedRef} className="h-48" />
          </Card>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Remaining schedule — how each game is predicted</h3>
          <p className="mb-2 text-xs text-slate-500">
            {teamName}&apos;s frozen Elo rating is <b>{Math.round(result.remainingGames[0]?.teamElo ?? 0)}</b>. Each row is the actual win
            probability the simulation draws from for that game.
          </p>
          {result.remainingGames.length ? (
            <div className="space-y-2">
              {result.remainingGames.map((g) => (
                <div key={`${g.week}-${g.opponent}`} className="flex items-center gap-1.5 text-sm sm:gap-3">
                  <span className="w-10 shrink-0 text-slate-500 sm:w-14">Wk {g.week}</span>
                  <span className="w-16 shrink-0 truncate font-medium text-slate-700 sm:w-28">
                    {g.home ? "vs" : "@"} {g.opponent}
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:block sm:w-24">
                    {Math.round(g.teamElo)} vs {Math.round(g.opponentElo)}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="flex h-full items-center justify-end pr-1.5 text-[10px] font-bold text-white"
                      style={{ width: `${Math.max(g.winProb * 100, 12)}%`, background: accent }}
                    >
                      {pct(g.winProb)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-400">No games remaining — the regular season is complete for this team.</div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-2">
          <MetricRow label="Simulated seasons" value={ITERATIONS.toLocaleString()} />
          <MetricRow label="Playoff appearances" value={`${Math.round(result.playoffPct * ITERATIONS).toLocaleString()} / ${ITERATIONS.toLocaleString()}`} />
          <MetricRow label="Division titles" value={`${Math.round(result.divisionTitlePct * ITERATIONS).toLocaleString()} / ${ITERATIONS.toLocaleString()}`} />
        </div>
      </div>
    </Modal>
  );
}
