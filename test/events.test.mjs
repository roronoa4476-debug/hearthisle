// Game events drive the table animations and sounds. They must describe
// exactly what happened, once each, and never reveal a hidden card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/js/rules.js';
import * as Rooms from '../server/rooms.mjs';
import { freshEvents, shownPoints } from '../public/js/effects.js';
import { getGeometry } from '../public/js/geometry.js';

const seeded = (seed = 13) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const tok = (n) => n.toString(16).padStart(32, '0');
const G = getGeometry(4);
const after = (before, next) => (next.events || []).filter((e) => e.id > Math.max(0, ...(before.events || []).map((x) => x.id)));
const sum = (basket) => Object.values(basket || {}).reduce((a, n) => a + n, 0);
const types = (before, next) => after(before, next).map((e) => e.type);
function hand(g, p, patch) { for (const r of R.RES) { const n = patch[r] || 0; g.bank[r] += g.players[p].res[r] - n; g.players[p].res[r] = n; } }
function mainPhase(seed = 5) {
  const g = R.createGame({ autoSetup: true, rng: seeded(seed) });
  return { ...g, phase: 'main' };
}

test('a new game starts with a single turn event; quick-start placements are not replayed', () => {
  for (const autoSetup of [true, false]) {
    const g = R.createGame({ autoSetup, rng: seeded(2) });
    assert.deepEqual(g.events.map((e) => e.type), ['turn']);
    assert.equal(g.events[0].p, g.firstPlayer);
    assert.ok(Number.isInteger(g.id));
  }
});

test('rolling: a roll event, then either production that matches the gains or a seven', () => {
  let g = R.createGame({ autoSetup: true, rng: seeded(4) });
  for (let n = 0; n < 40; n++) {
    const rolled = R.startRoll(g, seeded(n + 1));
    assert.deepEqual(types(g, rolled), ['roll']);
    const dice = rolled.dice;
    const done = R.resolveRoll(rolled, dice);
    const fresh = after(rolled, done);
    if (dice[0] + dice[1] === 7) assert.deepEqual(fresh.map((e) => e.type), ['seven']);
    else {
      assert.deepEqual(fresh.map((e) => e.type), ['produce']);
      // every card paid is accounted for exactly once, from a producing tile
      const fromFlows = done.players.map(() => R.emptyRes());
      for (const f of fresh[0].flows) { fromFlows[f.p][f.res] += f.n; assert.ok(done.producing.includes(f.hex)); }
      assert.deepEqual(fromFlows, done.gains);
    }
    g = { ...R.clearProducing(done), phase: 'roll', mode: null, discards: [] };
  }
});

test('opening placements: build and turn events in snake order, cards for the second settlement', () => {
  let g = R.createGame({ autoSetup: false, rng: seeded(8) });
  const seen = [];
  while (g.phase === 'setup') {
    const before = g;
    g = g.setup.need === 'settlement' ? R.placeAtVertex(g, R.validVertices(g)[0]) : R.placeAtEdge(g, R.validEdges(g)[0]);
    seen.push(...after(before, g));
  }
  assert.equal(seen.filter((e) => e.type === 'build').length, 16, '8 settlements and 8 roads');
  assert.ok(seen.filter((e) => e.type === 'build').every((e) => sum(e.cost) === 0), 'openings are free');
  const produce = seen.filter((e) => e.type === 'produce');
  assert.equal(produce.length, 4, 'each player collects once, for their second settlement');
  const turns = seen.filter((e) => e.type === 'turn').map((e) => e.p);
  const order = g.setupOrder;
  const expected = order.slice(1).filter((p, i) => p !== order[i]); // turn changes only
  assert.deepEqual(turns, expected);
});

test('building and buying: one event each, with the cost; free roads cost nothing', () => {
  let g = mainPhase();
  hand(g, g.cur, { wood: 5, brick: 5, wheat: 5, sheep: 5, ore: 5 });
  const p = g.cur;
  let b = R.chooseBuild(g, 'road');
  let next = R.placeAtEdge(b, R.validEdges(b)[0]);
  assert.deepEqual(after(b, next).filter((e) => e.type === 'build').map(({ id, ...e }) => e), [{ type: 'build', p, kind: 'road', cost: R.COST.road }]);
  g = next;
  b = R.chooseBuild(g, 'city');
  next = R.placeAtVertex(b, R.validVertices(b)[0]);
  assert.deepEqual(after(b, next).map((e) => [e.type, e.kind, e.cost]), [['build', 'city', R.COST.city]]);
  g = next;
  next = R.buyDevCard(g);
  const buy = after(g, next);
  assert.deepEqual(buy.map((e) => e.type), ['buyDev']);
  assert.equal(buy[0].card, next.players[p].dev.at(-1).type);
  // Road Building: free roads
  g = { ...next, turn: next.turn + 1 };
  g.players[p].dev.push({ type: 'roads', turn: 0 });
  next = R.playDevCard(g, 'roads');
  assert.deepEqual(types(g, next), ['playDev']);
  const free = R.placeAtEdge(next, R.validEdges(next)[0]);
  assert.deepEqual(after(next, free).map((e) => [e.type, sum(e.cost)]), [['build', 0]]);
});

test('illegal moves add no events', () => {
  const g = mainPhase();
  hand(g, g.cur, {});
  // every one of these is refused (unaffordable, wrong phase or mode, not a legal spot)
  for (const next of [R.chooseBuild(g, 'city'), R.buyDevCard(g), R.bankTrade(g), R.endTurn({ ...g, mode: 'robber' }), R.placeAtEdge(g, 0), R.moveRobber(g, 3), R.startRoll(g)]) {
    assert.equal(after(g, next).length, 0);
  }
});

test('robber, steal, discards, plenty, monopoly, trades, offers and turns each emit once', () => {
  let g = mainPhase(9);
  const p = g.cur;
  const q = (p + 1) % 4;
  // robber onto a tile next to q, who has one card
  const hex = G.hexes.find((h) => h.id !== g.robber && h.verts.some((v) => g.settlements[v]?.p === q) && !h.verts.some((v) => g.settlements[v] && g.settlements[v].p !== q)).id;
  for (const x of [0, 1, 2, 3]) hand(g, x, x === q ? { ore: 1 } : {});
  g = { ...g, mode: 'robber' };
  let next = R.moveRobber(g, hex, () => 0);
  assert.deepEqual(after(g, next).map((e) => e.type), ['robber', 'steal']);
  const st = after(g, next)[1];
  assert.deepEqual([st.from, st.to, st.res], [q, p, 'ore']);
  // discards on a seven
  g = next;
  hand(g, p, { wood: 4, brick: 4 });
  const seven = R.resolveRoll({ ...g, phase: 'roll', mode: null }, [3, 4]);
  assert.deepEqual(types(g, seven), ['seven']);
  const disc = R.discardCards(seven, { ...R.emptyRes(), wood: 4 }, p);
  assert.deepEqual(after(seven, disc).map((e) => [e.type, e.p, e.cards.wood]), [['discard', p, 4]]);
  // plenty and monopoly
  g = { ...R.moveRobber(disc, G.hexes.find((h) => h.id !== disc.robber).id, () => 0), mode: null, turn: 50 };
  g.players[p].dev = [{ type: 'plenty', turn: 0 }];
  let pl = R.playDevCard(g, 'plenty');
  pl = R.pickResource(R.pickResource(pl, 'ore'), 'sheep');
  assert.deepEqual(after(g, pl).map((e) => e.type), ['playDev', 'plenty', 'plenty']);
  g = { ...pl, devPlayed: false };
  hand(g, q, { wheat: 2 });
  hand(g, (p + 2) % 4, { wheat: 1 });
  g.players[p].dev = [{ type: 'monopoly', turn: 0 }];
  const mono = R.pickResource(R.playDevCard(g, 'monopoly'), 'wheat');
  const m = after(g, mono).find((e) => e.type === 'monopoly');
  assert.equal(m.takes[q], 2);
  assert.equal(m.takes[(p + 2) % 4], 1);
  assert.equal(m.takes[p], 0);
  // bank trade, offer, player trade
  g = mono;
  hand(g, p, { ore: 4 });
  const bt = R.bankTrade(R.setTrade(g, { give: 'ore', get: 'wood' }));
  const bank = after(g, bt);
  assert.deepEqual(bank.map((e) => e.type), ['bank']);
  assert.deepEqual([bank[0].give.ore, bank[0].get.wood], [R.harborRatio(g, p, 'ore'), 1]);
  hand(bt, q, { sheep: 1 });
  const offered = R.proposeTrade(bt, { ...R.emptyRes(), wood: 1 }, { ...R.emptyRes(), sheep: 1 });
  assert.deepEqual(types(bt, offered), ['offer']);
  const traded = R.confirmTrade(R.respondTrade(offered, q, true), q);
  const tr = after(offered, traded);
  assert.deepEqual(tr.map((e) => [e.type, e.a, e.b, e.aGives.wood, e.bGives.sheep]), [['trade', p, q, 1, 1]]);
  // end of turn
  const ended = R.endTurn(traded);
  assert.deepEqual(after(traded, ended).map((e) => [e.type, e.p]), [['turn', ended.cur]]);
});

test('awards: an event only when Longest Road or Largest Army changes hands', () => {
  let g = mainPhase(3);
  const p = g.cur;
  g = { ...g, turn: 40 };
  g.players[p].dev = [0, 1, 2].map(() => ({ type: 'knight', turn: 0 }));
  const awards = [];
  for (let i = 0; i < 3; i++) {
    const before = { ...g, devPlayed: false };
    g = R.playDevCard(before, 'knight');
    awards.push(...after(before, g).filter((e) => e.type === 'award'));
    g = { ...R.moveRobber(g, G.hexes.find((h) => h.id !== g.robber).id, () => 0), mode: null, victims: [] };
  }
  assert.deepEqual(awards.map((e) => [e.kind, e.from, e.to]), [['army', null, p]]);
});

test('reaching the target emits one win and no further turn', () => {
  const g = mainPhase(6);
  const p = g.cur;
  g.players[p].dev = Array.from({ length: 8 }, () => ({ type: 'vp', turn: 0 }));
  hand(g, p, { wood: 1, brick: 1 });
  const b = R.chooseBuild(g, 'road');
  const won = R.placeAtEdge(b, R.validEdges(b)[0]);
  assert.equal(won.winner, p);
  assert.deepEqual(after(b, won).map((e) => e.type), ['build', 'win']);
});

test('only the latest events are kept, ids always increase', () => {
  let g = mainPhase(7);
  for (let i = 0; i < 80; i++) g = R.endTurn({ ...g, phase: 'main', mode: null });
  assert.equal(g.events.length, R.MAX_EVENTS);
  const ids = g.events.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length);
});

/* ---------- privacy ---------- */
function humanRoom(names = ['A', 'B', 'C']) {
  const room = Rooms.createRoom();
  names.forEach((n, i) => Rooms.join(room, tok(i + 1), n));
  Rooms.join(room, tok(9), 'Watcher');
  Rooms.lobby(room, tok(9), { type: 'spectate' });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  return room;
}
const tokenOf = (room, seat) => room.seatTokens[seat];

test('the drawn development card is shown only to its buyer', () => {
  const room = humanRoom();
  const g = { ...room.game, phase: 'main' };
  const p = g.cur;
  hand(g, p, { sheep: 1, wheat: 1, ore: 1 });
  room.game = g;
  assert.equal(Rooms.act(room, tokenOf(room, p), 'buyDevCard'), true);
  const card = room.game.players[p].dev.at(-1).type;
  const ev = (t) => Rooms.viewFor(room, t).game.events.find((e) => e.type === 'buyDev');
  assert.equal(ev(tokenOf(room, p)).card, card, 'the buyer sees it');
  for (const s of [0, 1, 2].filter((s) => s !== p)) assert.equal(ev(tokenOf(room, s)).card, null, 'other players do not');
  assert.equal(ev(tok(9)).card, null, 'spectators do not');
  // nothing else in the other players' view reveals it (VP cards especially)
  for (const s of [0, 1, 2].filter((s) => s !== p)) {
    const view = Rooms.viewFor(room, tokenOf(room, s)).game;
    assert.ok(view.players[p].dev.every((c) => c.type === 'hidden'));
    assert.deepEqual(shownPoints(view, s)[p], R.victoryPoints(view, p, false), 'their points show only public points');
  }
  // once the game is over, everything is revealed
  room.game = { ...room.game, winner: p };
  assert.equal(ev(tokenOf(room, (p + 1) % 3)).card, card);
});

test('a stolen resource is shown only to the thief and the victim', () => {
  const room = humanRoom();
  let g = { ...room.game, phase: 'main', mode: 'robber' };
  const thief = g.cur;
  const victim = (thief + 1) % 3;
  const hex = G.hexes.find((h) => h.id !== g.robber && h.verts.some((v) => g.settlements[v]?.p === victim) && !h.verts.some((v) => g.settlements[v] && g.settlements[v].p !== victim));
  assert.ok(hex, 'this board has a tile touching only the victim');
  for (const x of [0, 1, 2]) hand(g, x, x === victim ? { brick: 1 } : {});
  room.game = g;
  assert.equal(Rooms.act(room, tokenOf(room, thief), 'moveRobber', [hex.id]), true);
  const ev = (t) => Rooms.viewFor(room, t).game.events.find((e) => e.type === 'steal');
  assert.equal(ev(tokenOf(room, thief)).res, 'brick');
  assert.equal(ev(tokenOf(room, victim)).res, 'brick');
  const bystander = [0, 1, 2].find((s) => s !== thief && s !== victim);
  assert.equal(ev(tokenOf(room, bystander)).res, null);
  assert.equal(ev(tok(9)).res, null);
});

/* ---------- playing each event once ---------- */
test('freshEvents: never replays, skips old news on connect, plays a new game from the start', () => {
  const g1 = { id: 1, serial: 10, events: [{ id: 8, type: 'roll' }, { id: 10, type: 'produce' }] };
  assert.deepEqual(freshEvents(null, g1, 0, { sync: true }), { play: [], seen: 10 });
  const g2 = { ...g1, serial: 12, events: [...g1.events, { id: 12, type: 'turn' }] };
  assert.deepEqual(freshEvents(g1, g2, 10).play.map((e) => e.id), [12]);
  assert.deepEqual(freshEvents(g2, g2, 12).play, [], 'the same update twice plays nothing');
  const rematch = { id: 2, serial: 3, events: [{ id: 3, type: 'turn' }] };
  assert.deepEqual(freshEvents(g2, rematch, 12).play.map((e) => e.id), [3]);
  assert.deepEqual(freshEvents(null, rematch, 99).play.map((e) => e.id), [3], 'a game started from the lobby plays its start');
  const older = { ...g1, serial: 5, events: [{ id: 5, type: 'roll' }] };
  assert.deepEqual(freshEvents(g2, older, 12), { play: [], seen: 5 }, 'restored from an older backup');
  const flood = { ...g1, serial: 100, events: Array.from({ length: 30 }, (_, i) => ({ id: 71 + i, type: i === 25 ? 'turn' : 'build' })) };
  assert.deepEqual(freshEvents(g1, flood, 10).play.map((e) => e.type), ['turn'], 'a big backlog skips to the latest turn');
});

test('a whole bot game, as seen by each seat: every event plays exactly once, in order, privately', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.lobby(room, tok(1), { type: 'spectate' });
  for (let i = 0; i < 4; i++) Rooms.lobby(room, tok(1), { type: 'addBot' });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const viewers = [...room.seatTokens, tok(1)];
  const state = viewers.map(() => ({ prev: null, seen: 0, played: [] }));
  const observe = () => viewers.forEach((t, i) => {
    const view = Rooms.viewFor(room, t).game;
    const s = state[i];
    const { play, seen } = freshEvents(s.prev, view, s.seen);
    s.played.push(...play.map((e) => ({ ...e, during: view.winner === null })));
    s.prev = view;
    s.seen = seen;
  });
  observe();
  for (let t = 0; t < 6000 && room.game.winner === null; t++) {
    Rooms.botTick(room, { instant: true });
    observe();
  }
  assert.notEqual(room.game.winner, null);
  state.forEach((s, i) => {
    const ids = s.played.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'no event plays twice');
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'in order');
    assert.equal(s.played.filter((e) => e.type === 'win').length, 1, 'one win');
    const seat = i < 4 ? i : null;
    for (const e of s.played) {
      if (e.type === 'buyDev' && e.p !== seat && e.during) assert.equal(e.card, null, 'never sees another player’s drawn card');
      if (e.type === 'steal' && e.from !== seat && e.to !== seat && e.during) assert.equal(e.res, null, 'never sees what others stole');
      if (e.type === 'buyDev' && e.p === seat) assert.ok(e.card, 'the buyer always sees their card');
    }
  });
  const seen = (type) => state.reduce((n, s) => n + s.played.filter((e) => e.type === type).length, 0);
  assert.ok(seen('buyDev') > 0 && seen('produce') > 0 && seen('turn') > 10, 'the game exercised the events');
  // every seat saw the same public sequence of moves
  const publicIds = (s) => s.played.map((e) => `${e.id}:${e.type}`).join();
  for (const s of state) assert.equal(publicIds(s), publicIds(state[0]));
});

/* ---------- lighter, faster updates ---------- */
test('bank trades carry their own choice; the old per-click setTrade message is gone', () => {
  const room = humanRoom();
  const g = { ...room.game, phase: 'main' };
  const p = g.cur;
  hand(g, p, { ore: 4 });
  room.game = g;
  const t = tokenOf(room, p);
  assert.equal(Rooms.act(room, t, 'setTrade', [{ give: 'ore' }]), false);
  assert.equal(Rooms.act(room, t, 'bankTrade', ['ore', 'nope']), false);
  assert.equal(Rooms.act(room, t, 'bankTrade', ['ore', 'ore']), false);
  assert.equal(Rooms.act(room, t, 'bankTrade', ['ore', 'wood']), true);
  assert.equal(room.game.players[p].res.wood, 1);
  assert.equal(Rooms.act(room, tokenOf(room, (p + 1) % 3), 'bankTrade', ['ore', 'wood']), false, 'only on your turn');
});

test('updates carry only recent moves; the full history is sent on request', () => {
  const room = humanRoom();
  room.game = { ...room.game, log: Array.from({ length: 120 }, (_, i) => ({ id: i, text: `move ${i}`, color: '#000' })) };
  const view = Rooms.viewFor(room, tok(1)).game;
  assert.equal(view.log.length, 30);
  assert.equal(view.log[0].text, 'move 0', 'newest first, as before');
  assert.equal(view.logCount, 120);
  assert.equal(room.game.log.length, 120, 'nothing is lost on the server');
  assert.equal(Rooms.historyFor(room).length, 120, 'opening the history panel gets every move');
  assert.deepEqual(Rooms.historyFor(Rooms.createRoom()), [], 'a lobby has no history');
});
