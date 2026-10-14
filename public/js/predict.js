// Instant moves: the browser has the same rules as the server, so for your own
// moves whose result is certain it applies them straight away instead of
// waiting a round trip. The server still decides; its next update replaces
// this guess (and if it refused the move, it sends the real table back).
//
// Only moves that depend on nothing hidden are predicted. Dice, development
// card draws, steals, Monopoly and trades with players wait for the server,
// because only it knows the deck and other players' hands.
import * as R from './rules.js';

const PREDICTABLE = {
  chooseBuild: (g, [kind]) => R.chooseBuild(g, kind),
  cancelBuild: (g) => R.cancelBuild(g),
  placeAtVertex: (g, [vid]) => R.placeAtVertex(g, vid),
  placeAtEdge: (g, [eid]) => R.placeAtEdge(g, eid),
  endTurn: (g) => R.endTurn(g),
  bankTrade: (g, [give, get]) => R.bankTrade(g, give, get),
  discard: (g, [cards], seat) => R.discardCards(g, cards, seat),
  pickResource: (g, [res]) => (g.mode === 'plenty' ? R.pickResource(g, res) : g), // Monopoly takes hidden cards
};

function hiddenWinPossible(g, p) {
  const hidden = g.players[p].dev.filter((c) => c.type === 'hidden').length;
  return R.victoryPoints(g, p, false) + hidden >= R.winTarget(g);
}

/**
 * The table as it will be after your move, or null when the move can't be
 * predicted (or wouldn't be allowed). `g` is your own view of the game.
 */
export function predict(g, seat, name, args = []) {
  const rule = PREDICTABLE[name];
  if (!rule || !g || seat === null || seat < 0 || g.winner !== null || g.rolling) return null;
  if (name === 'discard') {
    if (!R.mustDiscard(g, seat)) return null;
  } else if (g.cur !== seat || g.mode === 'discard') return null;
  let next;
  try {
    next = rule(g, args, seat);
  } catch {
    return null;
  }
  if (!next || next === g) return null;
  // Ending your turn can hand the win to the next player through point cards
  // only they can see. If that could happen, wait for the server.
  if (name === 'endTurn' && next.cur !== seat && hiddenWinPossible(next, next.cur)) return null;
  // keep the view's own conventions: your card count and your private notices
  const players = next.players.map((pl, i) => (i === seat ? { ...pl, cardCount: R.totalCards(pl.res) } : pl));
  return { ...next, players, toast: R.noticeFor(next.toast, seat) };
}
