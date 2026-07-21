// Single shared glossary — replaces the Grading Model Features tab's external
// link to the nflverse docs and Win Types' standalone glossary. Stat
// definitions are adapted from nflverse's own player-stats data dictionaries
// (nflreadr `dictionary_playerstats.csv` / `dictionary_playerstats_def.csv`,
// scraped 2026-07-20), scoped to the columns this app actually exposes via
// `statPicker.ts`'s curated stat picker. Win-type + analytics sections are
// authored for this app.
import { CATEGORY_COLORS } from "./logic/winType";

export interface GlossaryEntry {
  term: string;
  desc: string;
  color?: string;
}

export interface GlossarySection {
  title: string;
  entries: GlossaryEntry[];
}

export const WIN_TYPE_GLOSSARY: GlossaryEntry[] = [
  { term: "Favorite home", desc: "The favorite won and was the home team.", color: CATEGORY_COLORS["Favorite home"] },
  { term: "Favorite away", desc: "The favorite won on the road.", color: CATEGORY_COLORS["Favorite away"] },
  { term: "Underdog home", desc: "The underdog won at home. Also covers pick'em games (no favorite) won by the home team.", color: CATEGORY_COLORS["Underdog home"] },
  { term: "Underdog away", desc: "The underdog won on the road. Also covers pick'em games won by the away team.", color: CATEGORY_COLORS["Underdog away"] },
  { term: "Tie", desc: "The game ended tied. Its own category — not counted as a favorite win or loss in any percentage.", color: CATEGORY_COLORS.Tie },
  { term: "Favorite Home (No Score)", desc: "Not played yet and the favorite is the home team.", color: CATEGORY_COLORS["Favorite Home (No Score)"] },
  { term: "Favorite Away (No Score)", desc: "Not played yet and the favorite is the away team.", color: CATEGORY_COLORS["Favorite Away (No Score)"] },
  { term: "No Favorite", desc: "Not played yet and no favorite (pick'em or missing spread).", color: CATEGORY_COLORS["No Favorite"] },
];

const PASSING: GlossaryEntry[] = [
  { term: "Passing Yards", desc: "Yards gained on pass plays." },
  { term: "Passing TDs", desc: "The number of passing touchdowns." },
  { term: "Completions", desc: "The number of completed passes." },
  { term: "Attempts", desc: "The number of pass attempts as defined by the NFL." },
  { term: "Interceptions", desc: "The number of interceptions thrown." },
  { term: "Sacks", desc: "The number of times the passer was sacked." },
  { term: "Sack Yards", desc: "Yards lost on sack plays." },
  { term: "Passing Air Yards", desc: "Passing air yards, including incomplete passes." },
  { term: "Passing Yards After Catch", desc: "Yards after the catch gained on plays where this player was the passer (unofficial stat)." },
  { term: "Passing First Downs", desc: "First downs gained on pass attempts." },
  { term: "Passing EPA", desc: "Total Expected Points Added on pass attempts and sacks." },
  { term: "PACR", desc: "Passing (yards) Air (yards) Conversion Ratio — passing yards per air yard thrown." },
  { term: "Dakota", desc: "An adjusted EPA + CPOE composite designed to predict a QB's efficiency next season." },
];

const RUSHING: GlossaryEntry[] = [
  { term: "Carries", desc: "The number of official rush attempts, including scrambles and kneel-downs." },
  { term: "Rushing Yards", desc: "Yards gained when rushing with the ball, including scrambles and kneel-downs." },
  { term: "Rushing TDs", desc: "The number of rushing touchdowns, including scrambles." },
  { term: "Rushing First Downs", desc: "First downs gained on rush attempts, including scrambles." },
  { term: "Rushing EPA", desc: "Expected Points Added on rush attempts, including scrambles and kneel-downs." },
];

const RECEIVING: GlossaryEntry[] = [
  { term: "Receptions", desc: "The number of pass receptions." },
  { term: "Targets", desc: "The number of pass plays where the player was the targeted receiver." },
  { term: "Receiving Yards", desc: "Yards gained after a pass reception." },
  { term: "Receiving TDs", desc: "The number of touchdowns following a pass reception." },
  { term: "Receiving Air Yards", desc: "Receiving air yards, including incomplete passes." },
  { term: "Receiving Yards After Catch", desc: "Yards after the catch gained on plays where this player was the receiver (unofficial stat)." },
  { term: "Receiving First Downs", desc: "First downs gained on receptions." },
  { term: "Receiving EPA", desc: "Total Expected Points Added on plays where this player was targeted." },
  { term: "RACR", desc: "Receiving (yards) Air (yards) Conversion Ratio — receiving yards per air yard targeted." },
  { term: "Target Share", desc: "This player's share of the team's total receiving targets in the game." },
  { term: "Air Yards Share", desc: "This player's share of the team's total air yards in the game." },
  { term: "WOPR", desc: "Weighted Opportunity Rating — 1.5× target share + 0.7× air yards share; a weighted usage score." },
];

const FANTASY: GlossaryEntry[] = [
  { term: "Fantasy Points", desc: "Standard (non-PPR) fantasy points." },
  { term: "Fantasy Points PPR", desc: "Fantasy points under points-per-reception scoring." },
];

const DEFENSE: GlossaryEntry[] = [
  { term: "Def Sacks", desc: "Number of sacks made by this player." },
  { term: "Def Tackles Solo", desc: "Number of unassisted (solo) tackles by this player." },
  { term: "Def Tackle Assists", desc: "Number of assisted tackles by this player." },
  { term: "Def Tackles For Loss", desc: "Number of tackles for loss (TFL) by this player." },
  { term: "Def Interceptions", desc: "Number of interceptions made by this player." },
  { term: "Def Pass Defended", desc: "Number of passes defended/broken up by this player." },
  { term: "Def QB Hits", desc: "Number of QB hits by this player (excludes plays where the QB was sacked)." },
  { term: "Def Fumbles Forced", desc: "Number of times this player forced a fumble." },
];

const ADVANCED: GlossaryEntry[] = [
  { term: "EPA", desc: "Expected Points Added — how many points a play (or a player/team's cumulative plays) added to their scoring expectation, given the down, distance and field position." },
  { term: "CPOE", desc: "Completion Percentage Over Expected — how much more (or less) often a QB completed passes than expected, given how difficult each throw was." },
  { term: "Turnover Margin", desc: "Turnovers forced minus turnovers committed. Positive is good." },
  { term: "Points Margin", desc: "Points scored minus points allowed in a game." },
];

const ANALYTICS: GlossaryEntry[] = [
  { term: "Spread", desc: "The point handicap a sportsbook assigns to make a game roughly a coin flip. A negative spread means that team is favored by that many points." },
  { term: "Favorite / Underdog", desc: "The favorite is expected to win (negative spread for them); the underdog is the other side." },
  { term: "Moneyline", desc: "Odds to bet on a team to win outright, with no point spread involved." },
  { term: "Implied Probability", desc: "The win probability a moneyline price implies, before removing the sportsbook's built-in edge." },
  { term: "Vig / Overround", desc: "The sportsbook's built-in edge — the amount implied probabilities on both sides of a bet exceed 100%." },
  { term: "Fair Odds / Fair Probability", desc: "Odds or probability with the vig removed — the 'true' estimate, not what a book would actually pay." },
  { term: "Wilson CI (Confidence Interval)", desc: "A statistically sound range for a win rate estimated from a small sample — wider when there are fewer games, so a 4-for-5 record isn't overstated as 80% forever." },
  { term: "Low N", desc: "A flag on stats built from very few games — treat the number as a rough signal, not a reliable rate." },
  { term: "Calibration", desc: "Whether predicted probabilities match reality — e.g. among games given a 70% win probability, roughly 70% should actually be won." },
  { term: "Lift", desc: "How much better a model's picks perform versus always picking the favorite (or a coin flip) — the model's edge over a naive baseline." },
  { term: "Bucket", desc: "A group of games with a similar spread (e.g. 3.5–6.5 point favorites), used to estimate a historical win rate for that range." },
  { term: "Elo Rating", desc: "A running team-strength score (like in chess) that rises after wins and falls after losses, weighted by opponent strength and margin of victory." },
  { term: "Pythagorean Win %", desc: "An expected win percentage estimated from points scored vs. allowed, rather than actual wins and losses — smooths out small-sample luck." },
  { term: "Blend / Consensus", desc: "A combined probability averaging multiple models (market history, grades, moneyline, Elo, Pythagorean) rather than trusting any single one." },
  { term: "Grade", desc: "This app's 0–100 team-strength score from a Random Forest model trained weekly on that season's results — see the Grading Model page." },
  { term: "Rank / Percentile", desc: "Where a team or stat sits among all 32 teams that week — #1 is best, #32 is worst." },
];

export const GLOSSARY_SECTIONS: GlossarySection[] = [
  { title: "Win Types", entries: WIN_TYPE_GLOSSARY },
  { title: "Passing", entries: PASSING },
  { title: "Rushing", entries: RUSHING },
  { title: "Receiving", entries: RECEIVING },
  { title: "Fantasy", entries: FANTASY },
  { title: "Defense", entries: DEFENSE },
  { title: "Advanced / Team Stats", entries: ADVANCED },
  { title: "Betting & Model Terms", entries: ANALYTICS },
];
