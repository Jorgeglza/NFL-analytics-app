// Methodology — how a "profitable" verdict is actually computed, and its caveats.
import { Card } from "../../components/ui";
import { DEFAULT_STAKE } from "../../lib/logic/backtest";
import { predictiveDisclaimer, type PredictiveCoverage } from "../game-analysis/previews/engine";

export default function MethodologyTab({
  predictiveUnavailable,
  predictiveCoverage,
}: {
  predictiveUnavailable: boolean;
  predictiveCoverage: PredictiveCoverage | null;
}) {
  return (
    <div className="space-y-4">
      <Card title="What counts as a bet">
        <p className="text-sm leading-relaxed text-slate-600">
          Every completed regular-season game is replayed through each sub-model's win probability (the same engine that powers Matchup
          Previews' Model Overview/Model Picker tabs). If a model gives one side a higher probability, that side is "the pick" — a straight-up
          bet on that team to win outright, no point spread involved. Games where a model has no opinion (missing input data) aren't counted.
        </p>
      </Card>

      <Card title="How profit is calculated">
        <p className="text-sm leading-relaxed text-slate-600">
          Every bet risks a flat <b>${DEFAULT_STAKE}</b> ("1 unit") — not a percentage of a growing/shrinking bankroll. This isolates whether
          the model's picks themselves are profitable from any bankroll-sizing strategy layered on top.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          The payout uses the actual moneyline price for the side picked (not the favorite's price) — standard American odds: a{" "}
          <code>+150</code> underdog pays <code>150/100 × stake</code> on a win; a <code>-150</code> favorite pays{" "}
          <code>100/150 × stake</code>. A loss costs the full stake. A game with no moneyline on record for the picked side isn't gradable and
          is excluded from profit/ROI (but still counts toward accuracy).
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          <b>ROI</b> = total profit ÷ (graded bets × ${DEFAULT_STAKE}). Positive ROI means the model made money over the sample; 0% is
          break-even; negative loses money. Betting the market's own vig-free favorite straight-up ("ML Fair") is expected to land near or
          below 0% ROI over a large sample — that's the sportsbook's built-in edge, not a bug.
        </p>
      </Card>

      <Card title="Caveats">
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
          <li>This assumes every posted moneyline could actually be bet at that exact price — real books move lines, and closing lines (used
            here) aren't always the price available when a bet would have been placed.</li>
          <li>No transaction costs, limits, or line-shopping across books are modeled — one price per game, taken as given.</li>
          <li>A profitable backtest on historical data is not a guarantee of future profitability — markets adapt, and this is the same
            look-back-only caveat that applies to every model on this page.</li>
          <li>{predictiveUnavailable ? "⚠ Predictive model: data unavailable this session — excluded from every chart/table on this page." : predictiveDisclaimer(predictiveCoverage)}</li>
        </ul>
      </Card>
    </div>
  );
}
