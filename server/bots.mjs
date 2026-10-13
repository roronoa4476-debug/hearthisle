// Computer players. botStep() looks at the game from one bot seat and returns
// the state after its next move (or the same object when it has nothing to do).
// Bots only use public information plus their own hand: they never look at
// other players' cards or the order of the development deck.
import * as R from '../public/js/rules.js';
import { getGeometry } from '../public/js/geometry.js';

const geo = (g) => getGeometry(g.playerCount);
const TARGET_DEPTH = 3; // how many roads ahead a bot plans towards a new settlement

/** Expected cards per roll for p, by resource (pips; cities count double). */
function income(g, p) {
  const out = R.emptyRes();
  for (const v of g.townList) {
    const t = g.settlements[v];
    if (t.p !== p) continue;
    for (const h of geo(g).verts[v].hexes) {
      const r = R.TERRAIN_RES[g.terrain[h]];
      if (r) out[r] += R.pips(g.numbers[h]) * (t.city ? 2 : 1);
    }
  }
  return out;
}

/** How good a corner would be for p: odds, resources p lacks, and harbours. */
function spotValue(g, vid, p) {
  const G = geo(g);
  const have = income(g, p);
  let s = 0;
  for (const h of G.verts[vid].hexes) {
    const r = R.TERRAIN_RES[g.terrain[h]];
    if (!r || g.robber === h) continue;
    s += R.pips(g.numbers[h]) * (have[r] < 3 ? 1.3 : 1);
  }
  for (const hb of G.harbors) {
    if (!hb.verts.includes(vid)) continue;
    s += hb.type === 'any' ? 1 : have[hb.type] >= 4 ? 2.5 : 0.6;
  }
  return s;
}

const opponentTown = (g, v, p) => !!g.settlements[v] && g.settlements[v].p !== p;

/** The best new settlement spot p can reach by road, and the first road towards it. */
function roadPlan(g, p) {
  const G = geo(g);
  const start = new Set();
  for (const e of g.roadList) {
    if (g.roads[e] !== p) continue;
    for (const v of [G.edges[e].a, G.edges[e].b]) if (!opponentTown(g, v, p)) start.add(v);
  }
  for (const v of g.townList) if (g.settlements[v].p === p) start.add(v);
  const seen = new Set(start);
  let frontier = [...start].map((v) => ({ v, first: null }));
  let best = null;
  for (let dist = 1; dist <= TARGET_DEPTH && frontier.length; dist++) {
    const next = [];
    for (const { v, first } of frontier) {
      for (const eid of G.verts[v].edges) {
        if (g.roads[eid] !== undefined) continue;
        const e = G.edges[eid];
        const w = e.a === v ? e.b : e.a;
        if (seen.has(w)) continue;
        seen.add(w);
        const step = { v: w, first: first ?? eid };
        if (R.canSettle(g, w, p, true)) {
          const score = spotValue(g, w, p) / (1 + 0.45 * dist);
          if (!best || score > best.score) best = { edge: step.first, target: w, score, dist };
        }
        if (!opponentTown(g, w, p)) next.push(step);
      }
    }
    frontier = next;
  }
  return best && R.canRoad(g, best.edge, p) ? best : null;
}

/** When there is nowhere left to settle: the road that most lengthens p's longest road. */
function roadExtension(g, p) {
  let best = null;
  for (const e of geo(g).edges) {
    if (!R.canRoad(g, e.id, p)) continue;
    const len = R.longestRoadFor({ ...g, roads: { ...g.roads, [e.id]: p }, roadList: [...g.roadList, e.id] }, p);
    if (!best || len > best.len) best = { edge: e.id, len };
  }
  return best;
}

/** Next road to build: towards a new settlement spot, else lengthening the longest road. */
function nextRoad(g, p) {
  return roadPlan(g, p)?.edge ?? roadExtension(g, p)?.edge;
}

/** What the bot is saving for, with its cost. */
function goal(g, p) {
  const left = R.piecesLeft(g, p);
  const res = g.players[p].res;
  const missing = (cost) => Object.keys(cost).reduce((n, r) => n + Math.max(0, cost[r] - res[r]), 0);
  const options = [];
  const settleSpots = geo(g).verts.filter((v) => R.canSettle(g, v.id, p, false));
  if (left.settlement > 0 && settleSpots.length) options.push({ kind: 'settlement', bias: 0 });
  if (left.city > 0 && g.townList.some((v) => R.canCity(g, v, p))) options.push({ kind: 'city', bias: 0.5 });
  if (left.road > 0 && left.settlement > 0 && !settleSpots.length && roadPlan(g, p)) options.push({ kind: 'road', bias: 0 });
  if (g.deck.length) options.push({ kind: 'dev', bias: 1.5 });
  // Board full, cities built, deck empty: Longest Road is the only points left.
  if (!options.length && left.road > 0 && roadExtension(g, p)) options.push({ kind: 'road', bias: 0 });
  if (!options.length) return null;
  const scored = options.map((o) => ({ ...o, cost: R.COST[o.kind], score: missing(R.COST[o.kind]) + o.bias }));
  scored.sort((a, b) => a.score - b.score);
  return scored[0];
}

/** Cards needed for the current goal that p doesn't have yet. */
function shortfall(g, p, target = goal(g, p)) {
  const out = R.emptyRes();
  if (!target) return out;
  for (const r of Object.keys(target.cost)) out[r] = Math.max(0, target.cost[r] - g.players[p].res[r]);
  return out;
}

/** Cards p could spare without hurting the current goal. */
function surplus(g, p, target = goal(g, p)) {
  const out = { ...g.players[p].res };
  if (target) for (const r of Object.keys(target.cost)) out[r] = Math.max(0, out[r] - target.cost[r]);
  return out;
}

const firstChanged = (g, steps) => {
  for (const step of steps) {
    const next = step();
    if (next && next !== g) return next;
  }
  return g;
};

/* ---------- individual decisions ---------- */
function setupMove(g, p, rng) {
  if (g.setup.need === 'settlement') {
    const spots = R.validVertices(g);
    if (!spots.length) return g;
    const best = spots.map((v) => ({ v, s: spotValue(g, v, p) + rng() * 0.4 })).sort((a, b) => b.s - a.s)[0];
    return R.placeAtVertex(g, best.v);
  }
  const G = geo(g);
  const edges = R.validEdges(g);
  const look = (eid) => {
    const e = G.edges[eid];
    const far = e.a === g.setup.lastV ? e.b : e.a;
    return Math.max(0, ...G.verts[far].adj.filter((v) => v !== g.setup.lastV && R.canSettle(g, v, p, true)).map((v) => spotValue(g, v, p)));
  };
  const best = edges.map((eid) => ({ eid, s: look(eid) + rng() * 0.2 })).sort((a, b) => b.s - a.s)[0];
  return best ? R.placeAtEdge(g, best.eid) : g;
}

/** Discard down to the required count, keeping what the goal needs. */
export function discardChoice(g, p, n) {
  const target = goal(g, p);
  const keep = target ? target.cost : {};
  const hand = { ...g.players[p].res };
  const out = R.emptyRes();
  for (let i = 0; i < n; i++) {
    const r = R.RES.filter((k) => hand[k] > 0).sort((a, b) => (hand[b] - (keep[b] || 0)) - (hand[a] - (keep[a] || 0)))[0];
    if (!r) break;
    hand[r]--;
    out[r]++;
  }
  return out;
}

function robberHex(g, p) {
  const leader = (q) => 1 + 0.2 * R.victoryPoints(g, q, false);
  const score = (hid) => {
    let s = 0;
    for (const v of R.hexCorners(g, hid)) {
      const t = g.settlements[v];
      if (!t) continue;
      if (t.p === p) return -100;
      s += (t.city ? 2 : 1) * leader(t.p) * (R.pips(g.numbers[hid]) || 0.2) + (g.players[t.p].cardCount ?? R.totalCards(g.players[t.p].res) ? 0.5 : 0);
    }
    return s;
  };
  return R.robberTargets(g).sort((a, b) => score(b) - score(a))[0];
}

function stealTarget(g) {
  const cards = (q) => R.totalCards(g.players[q].res);
  return g.victims.slice().sort((a, b) => R.victoryPoints(g, b, false) - R.victoryPoints(g, a, false) || cards(b) - cards(a))[0];
}

function wantedResource(g, p, fromBank) {
  const need = shortfall(g, p);
  const ok = (r) => !fromBank || g.bank[r] > 0;
  const missing = R.RES.filter((r) => need[r] > 0 && ok(r)).sort((a, b) => need[b] - need[a]);
  if (missing.length) return missing[0];
  const have = g.players[p].res;
  return ['ore', 'wheat', 'sheep', 'brick', 'wood'].filter(ok).sort((a, b) => have[a] - have[b])[0];
}

const robberOnMe = (g, p) => R.hexCorners(g, g.robber).some((v) => g.settlements[v]?.p === p) && g.numbers[g.robber] > 0;

function playUsefulDev(g, p) {
  const can = (type) => R.canPlayDev(g, type);
  const steps = [];
  if (can('knight')) {
    const army = g.army === null ? 3 : g.players[g.army].knights + 1;
    if (robberOnMe(g, p) || (g.army !== p && g.players[p].knights + 1 >= army)) steps.push(() => R.playDevCard(g, 'knight'));
  }
  const need = R.totalCards(shortfall(g, p));
  if (can('plenty') && need > 0) steps.push(() => R.playDevCard(g, 'plenty'));
  if (can('monopoly') && need > 0) steps.push(() => R.playDevCard(g, 'monopoly'));
  if (can('roads') && (roadPlan(g, p) || goal(g, p)?.kind === 'road')) steps.push(() => R.playDevCard(g, 'roads'));
  return firstChanged(g, steps);
}

function build(g, kind, place) {
  const chosen = R.chooseBuild(g, kind);
  if (chosen === g || chosen.mode !== kind) return g;
  const placed = place(chosen);
  return placed === chosen ? g : placed;
}

function bankTradeTowardGoal(g, p) {
  if (!R.tradeOpen(g)) return g;
  const target = goal(g, p);
  if (!target) return g;
  const need = shortfall(g, p, target);
  const spare = surplus(g, p, target);
  for (const get of R.RES.filter((r) => need[r] > 0 && g.bank[r] > 0)) {
    const give = R.RES.filter((r) => r !== get && spare[r] >= R.harborRatio(g, p, r)).sort((a, b) => spare[b] - R.harborRatio(g, p, b) - (spare[a] - R.harborRatio(g, p, a)))[0];
    if (!give) continue;
    const next = R.bankTrade(R.setTrade(g, { give, get }));
    if (next.players[p].res[get] > g.players[p].res[get]) return next;
  }
  return g;
}

function mainMove(g, p) {
  const G = geo(g);
  const res = g.players[p].res;
  const left = R.piecesLeft(g, p);
  return firstChanged(g, [
    // 1. A settlement on the best open corner.
    () => R.canBuild(g, 'settlement') ? build(g, 'settlement', (s) => {
      const best = R.validVertices(s).sort((a, b) => spotValue(s, b, p) - spotValue(s, a, p))[0];
      return best === undefined ? s : R.placeAtVertex(s, best);
    }) : g,
    // 2. Upgrade the most productive settlement.
    () => R.canBuild(g, 'city') ? build(g, 'city', (s) => {
      const best = R.validVertices(s).sort((a, b) => spotValue(s, b, p) - spotValue(s, a, p))[0];
      return best === undefined ? s : R.placeAtVertex(s, best);
    }) : g,
    // 3. A development card that helps right now.
    () => playUsefulDev(g, p),
    // 4. A road towards the next settlement spot (only when there is nowhere to settle yet),
    //    or, late in the game, a road that lengthens the longest road.
    () => {
      if (!R.canBuild(g, 'road')) return g;
      if (G.verts.some((v) => R.canSettle(g, v.id, p, false))) return g;
      const plan = roadPlan(g, p);
      const edge = plan && left.settlement > 0 ? plan.edge : goal(g, p)?.kind === 'road' ? nextRoad(g, p) : undefined;
      return edge === undefined ? g : build(g, 'road', (s) => R.placeAtEdge(s, edge));
    },
    // 5. Trade spare cards with the bank or a harbour to reach the goal.
    () => bankTradeTowardGoal(g, p),
    // 6. Buy a development card when saving for one, or to avoid losing cards on a 7.
    () => {
      const target = goal(g, p);
      const big = R.totalCards(res) > 7;
      return (target?.kind === 'dev' || big) && R.afford(res, R.COST.dev) && g.deck.length ? R.buyDevCard(g) : g;
    },
    // 7. Nothing useful left: end the turn.
    () => R.endTurn(g),
  ]);
}

/** One move for bot seat p, or g itself when the bot isn't the one to act. */
export function botStep(g, p, rng = Math.random) {
  if (!g || g.winner !== null || g.rolling) return g;
  if (g.mode === 'discard') {
    const d = g.discards.find((x) => x.p === p);
    return d ? R.discardCards(g, discardChoice(g, p, d.n), p) : g;
  }
  if (g.cur !== p) return g;
  if (g.offer) return R.withdrawTrade(g);
  if (g.phase === 'setup') return setupMove(g, p, rng);
  switch (g.mode) {
    case 'robber': return R.moveRobber(g, robberHex(g, p), rng);
    case 'steal': return R.stealFrom(g, stealTarget(g), rng);
    case 'plenty': return R.pickResource(g, wantedResource(g, p, true));
    case 'monopoly': return R.pickResource(g, wantedResource(g, p, false));
    case 'road': {
      if (g.freeRoads > 0) {
        const want = nextRoad(g, p);
        const edge = want !== undefined && R.validEdges(g).includes(want) ? want : R.validEdges(g)[0];
        return edge === undefined ? R.cancelBuild({ ...g, freeRoads: 0 }) : R.placeAtEdge(g, edge);
      }
      return R.cancelBuild(g);
    }
    case 'settlement':
    case 'city':
      return R.cancelBuild(g);
  }
  if (g.phase === 'roll') {
    // Chase the robber off a producing tile before rolling.
    if (R.canPlayDev(g, 'knight') && robberOnMe(g, p)) return R.playDevCard(g, 'knight');
    return g; // the room rolls the dice (with the normal animation)
  }
  if (g.phase === 'main') return mainMove(g, p);
  return g;
}

/** Whether bot q is happy to take the current offer (it gives offer.get, receives offer.give). */
export function wantsOffer(g, q) {
  const o = g.offer;
  if (!o || !R.afford(g.players[q].res, o.get)) return false;
  if (R.victoryPoints(g, g.cur, false) >= R.winTarget(g) - 2) return false; // don't help a leader finish
  const need = shortfall(g, q);
  const spare = surplus(g, q);
  let gain = 0;
  for (const r of R.RES) gain += (o.give[r] || 0) * (need[r] > 0 ? 1.5 : 0.9);
  let cost = 0;
  for (const r of R.RES) cost += (o.get[r] || 0) * ((o.get[r] || 0) > spare[r] ? 1.6 : 0.8);
  return gain >= cost;
}

export const _internals = { roadPlan, goal, spotValue }; // for tests
