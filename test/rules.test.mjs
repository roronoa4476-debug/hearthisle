import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO } from '../public/js/geometry.js';
import * as R from '../public/js/rules.js';

// Deterministic random numbers so tests always behave the same way.
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

test('board geometry matches the standard island', () => {
  assert.equal(GEO.hexes.length, 19);
  assert.equal(GEO.verts.length, 54);
  assert.equal(GEO.edges.length, 72);
  assert.equal(GEO.coast.length, 30);
  assert.equal(GEO.harbors.length, 9);
  const harborCorners = GEO.harbors.flatMap((h) => h.verts);
  assert.equal(new Set(harborCorners).size, 18, 'harbors never share a corner');
});

test('terrain and numbers use the base-game distribution', () => {
  const count = (list) => list.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
  assert.deepEqual(count(R.TERRAIN_BAG), { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 });
  assert.deepEqual(count(R.DEFAULT_NUMBERS.filter(Boolean)), { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 });
  assert.equal(R.DECK.length, 25);
});

test('random islands keep 6 and 8 apart and the desert has no number', () => {
  const rng = seeded(7);
  for (let i = 0; i < 25; i++) {
    const b = R.newBoard(true, rng);
    assert.ok(R.hotNumbersSeparated(b.numbers));
    assert.equal(b.numbers[b.terrain.indexOf('desert')], 0);
  }
  assert.ok(R.hotNumbersSeparated(R.DEFAULT_NUMBERS));
});

test('setup runs in snake order and the second settlement pays out', () => {
  let g = R.createGame({ autoSetup: false, rng: seeded(3) });
  const order = [];
  for (let step = 0; step < 8; step++) {
    order.push(g.cur);
    const vid = R.validVertices(g)[0];
    g = R.placeAtVertex(g, vid);
    if (step >= 4) {
      const expected = GEO.verts[vid].hexes.filter((h) => R.TERRAIN_RES[g.terrain[h]]).length;
      assert.equal(R.totalCards(g.players[g.cur].res), expected);
    }
    g = R.placeAtEdge(g, R.validEdges(g)[0]);
  }
  assert.deepEqual(order, R.SETUP_ORDER);
  assert.equal(g.phase, 'roll');
  assert.equal(g.cur, 0);
});

test('distance rule blocks settlements next to another settlement', () => {
  let g = R.createGame({ autoSetup: false });
  const vid = 20;
  g = R.placeAtVertex(g, vid);
  for (const n of GEO.verts[vid].adj) assert.equal(R.canSettle(g, n, 1, true), false);
});

test('rolling a number produces for adjacent settlements, not under the robber', () => {
  let g = R.createGame({ autoSetup: true, rng: seeded(5) });
  const before = g.players.map((p) => R.totalCards(p.res));
  // Find a number touching player 0's settlement.
  const myVert = g.townList.find((v) => g.settlements[v].p === 0);
  const hex = GEO.verts[myVert].hexes.find((h) => g.numbers[h] && h !== g.robber);
  const n = g.numbers[hex];
  g = R.resolveRoll(R.startRoll(g), [Math.min(6, n - 1), n - Math.min(6, n - 1)]);
  assert.equal(g.lastRoll, n);
  assert.ok(R.totalCards(g.players[0].res) > before[0]);
  assert.ok(g.producing.includes(hex));
});

test('a 7 lets players choose half of big hands before moving the robber', () => {
  let g = R.createGame({ autoSetup: true });
  g.players[1].res = { wood: 3, brick: 3, wheat: 3, sheep: 0, ore: 0 };
  g = R.resolveRoll(g, [3, 4], seeded(2));
  assert.equal(R.totalCards(g.players[1].res), 9);
  assert.equal(g.mode, 'discard');
  assert.equal(R.moveRobber(g,0),g);
  g=R.discardCards(g,{wood:2,brick:2,wheat:0,sheep:0,ore:0});
  assert.equal(R.totalCards(g.players[1].res),5);
  assert.equal(g.mode,'robber');
  assert.equal(R.endTurn(g), g, 'cannot end turn before moving the robber');
  const target = R.robberTargets(g)[0];
  g = R.moveRobber(g, target, seeded(2));
  assert.equal(g.robber, target);
});

test('building pays costs and roads must connect', () => {
  let g = R.createGame({ autoSetup: true });
  g = R.resolveRoll(g, [1, 1]);
  g.players[0].res = { wood: 1, brick: 1, wheat: 0, sheep: 0, ore: 0 };
  g = R.chooseBuild(g, 'road');
  assert.equal(g.mode, 'road');
  const edges = R.validEdges(g);
  assert.ok(edges.length > 0);
  for (const eid of edges) {
    const e = GEO.edges[eid];
    const touches = [e.a, e.b].some((v) => g.settlements[v]?.p === 0 || GEO.verts[v].edges.some((x) => g.roads[x] === 0));
    assert.ok(touches);
  }
  g = R.placeAtEdge(g, edges[0]);
  assert.equal(R.totalCards(g.players[0].res), 0);
  assert.equal(g.mode, null);
  const broke = R.chooseBuild(g, 'road');
  assert.equal(broke.mode, null, 'cannot build without resources');
});

test('bank trades at 4:1 by default', () => {
  let g = R.createGame({ autoSetup: true });
  g = R.resolveRoll(g, [1, 1]);
  g.players[0].res = { wood: 0, brick: 0, wheat: 4, sheep: 0, ore: 0 };
  g = R.setTrade(g, { give: 'wheat', get: 'ore' });
  const ratio = R.harborRatio(g, 0, 'wheat');
  g = R.bankTrade(g);
  assert.equal(g.players[0].res.ore, 1);
  assert.equal(g.players[0].res.wheat, 4 - ratio);
});

test('development cards cannot be played on the turn they are bought', () => {
  let g = R.createGame({ autoSetup: true });
  g = R.resolveRoll(g, [1, 1]);
  g.players[0].res = { wood: 0, brick: 0, wheat: 1, sheep: 1, ore: 1 };
  g.deck.push('knight');
  g = R.buyDevCard(g);
  assert.equal(g.players[0].dev[0].type, 'knight');
  assert.equal(R.canPlayDev(g, 'knight'), false);
  g.turn++;
  assert.equal(R.canPlayDev(g, 'knight'), true);
});

test('longest road needs five connected roads', () => {
  const g = R.createGame({ autoSetup: false });
  // Walk around the outer coast for five edges.
  const path = [];
  let v = GEO.coast[0].a;
  const used = new Set();
  while (path.length < 5) {
    const next = GEO.verts[v].edges.find((e) => !used.has(e) && GEO.edges[e].hexes.length === 1);
    used.add(next);
    path.push(next);
    v = GEO.edges[next].a === v ? GEO.edges[next].b : GEO.edges[next].a;
  }
  path.forEach((e) => {
    g.roads[e] = 2;
    g.roadList.push(e);
  });
  assert.equal(R.longestRoadFor(g, 2), 5);
});

test('reaching ten points ends the game', () => {
  let g = R.createGame({ autoSetup: true });
  g = R.resolveRoll(g, [1, 1]);
  g.players[0].dev = Array.from({ length: 8 }, () => ({ type: 'vp', turn: 0 }));
  g.players[0].res = { wood: 1, brick: 1, wheat: 0, sheep: 0, ore: 0 };
  g = R.chooseBuild(g, 'road');
  g = R.placeAtEdge(g, R.validEdges(g)[0]);
  assert.equal(g.winner, 0);
});

for (const kind of ['road', 'settlement', 'city']) {
  test(`trading away payment cancels a pending ${kind} and cannot overspend`, () => {
    let g = R.createGame({ autoSetup: false, rng: seeded(8) });
    g.phase = 'main';
    g.setup = null;
    g.roads[0] = 0;
    g.roadList = [0];
    const vid = GEO.edges[0].a;
    if (kind === 'city') {
      g.settlements[vid] = { p: 0, city: false };
      g.townList = [vid];
    }
    g.players[0].res = { ...R.emptyRes(), ...R.COST[kind] };
    g.players[1].res.ore = 1;
    g = R.chooseBuild(g, kind);
    assert.equal(g.mode, kind);
    const target = kind === 'road' ? R.validEdges(g)[0] : R.validVertices(g)[0];
    assert.notEqual(target, undefined);
    const give = kind === 'city' ? 'wheat' : 'wood';
    g = R.acceptOffer(R.setTrade(g, { give, get: 'ore', giveN: 1, getN: 1 }), 1);
    assert.equal(g.mode, null, 'unaffordable pending build is cancelled');
    // Even a stale placement request must be rejected by the rules engine.
    const stale = { ...g, mode: kind };
    const placed = kind === 'road' ? R.placeAtEdge(stale, target) : R.placeAtVertex(stale, target);
    assert.equal(placed, stale);
    assert.ok(R.RES.every((r) => placed.players[0].res[r] >= 0));
  });
}

test('bank trading cancels a city when it spends the required wheat', () => {
  let g = R.resolveRoll(R.createGame({ rng: seeded(9) }), [1, 1]);
  g.players[0].res = { wood: 0, brick: 0, wheat: 4, sheep: 0, ore: 3 };
  g = R.chooseBuild(g, 'city');
  assert.equal(g.mode, 'city');
  g = R.bankTrade(R.setTrade(g, { give: 'wheat', get: 'sheep' }));
  assert.equal(g.mode, null);
  assert.equal(g.players[0].res.sheep, 1);
});

test('trading preserves an affordable build; Road Building completes before trading', () => {
  let g = R.resolveRoll(R.createGame({ rng: seeded(10) }), [1, 1]);
  g.players[0].res = { wood: 1, brick: 1, wheat: 1, sheep: 0, ore: 0 };
  g.players[1].res.ore = 2;
  g = R.chooseBuild(g, 'road');
  g = R.acceptOffer(R.setTrade(g, { give: 'wheat', get: 'ore' }), 1);
  assert.equal(g.mode, 'road');
  g = R.placeAtEdge(g, R.validEdges(g)[0]);
  assert.equal(g.players[0].res.wood, 0);
  assert.equal(g.players[0].res.brick, 0);
  g.players[0].dev = [{ type: 'roads', turn: 0 }];
  g = R.playDevCard(g, 'roads');
  g.players[1].res.wood = 1;
  const offer=R.setTrade(g,{give:'ore',get:'wood'});
  assert.equal(R.acceptOffer(offer,1),offer,'finish the development card effect before another action');
  assert.equal(g.players[0].res.wood,0);
  assert.equal(g.mode, 'road');
  const before = structuredClone(g.players[0].res);
  const roads = g.roadList.length;
  g = R.placeAtEdge(g, R.validEdges(g)[0]);
  g = R.placeAtEdge(g, R.validEdges(g)[0]);
  assert.equal(g.roadList.length, roads + 2);
  assert.deepEqual(g.players[0].res, before);
});
