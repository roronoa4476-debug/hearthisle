// Removing a player mid-game: their seat is played on autopilot, and a
// spectator can take it over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Rooms from '../server/rooms.mjs';
import * as R from '../public/js/rules.js';

const tok = (n) => n.toString(16).padStart(32, '0');
function game(names, { quick = true, spectators = [] } = {}) {
  const room = Rooms.createRoom();
  names.forEach((n, i) => Rooms.join(room, tok(i + 1), n));
  spectators.forEach((n, i) => { Rooms.join(room, tok(60 + i), n); Rooms.lobby(room, tok(60 + i), { type: 'spectate' }); });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick });
  Rooms.lobby(room, tok(1), { type: 'start' });
  return room;
}
const memberId = (room, t) => room.members.get(t).id;
const playUntil = (room, cond, limit = 400) => {
  // real players just roll and end turns
  for (let i = 0; i < limit && !cond(); i++) {
    const g = room.game;
    if (g.winner !== null) return;
    const t = room.seatTokens[g.cur];
    if (g.mode === 'discard') {
      const d = g.discards.find((x) => room.seatTokens[x.p]);
      const c = R.emptyRes(); let left = d.n; for (const r of R.RES) { const k = Math.min(left, g.players[d.p].res[r]); c[r] = k; left -= k; }
      Rooms.act(room, room.seatTokens[d.p], 'discard', [c]);
    } else if (g.mode === 'robber') Rooms.act(room, t, 'moveRobber', [R.robberTargets(g)[0]]);
    else if (g.mode === 'steal') Rooms.act(room, t, 'stealFrom', [g.victims[0]]);
    else if (g.phase === 'roll') { room.game = R.resolveRoll(R.startRoll(g), R.rollDice()); Rooms.autopilot(room); }
    else Rooms.act(room, t, 'endTurn');
  }
};

test('only the host can remove someone, and never themselves', () => {
  const room = game(['Host', 'Ali', 'Sara']);
  assert.equal(Rooms.lobby(room, tok(2), { type: 'remove', id: memberId(room, tok(3)) }), false);
  assert.equal(Rooms.lobby(room, tok(1), { type: 'remove', id: memberId(room, tok(1)) }), false);
});

test('a removed player’s turns are played automatically and the game keeps going', () => {
  const room = game(['Host', 'Ali', 'Sara']);
  const seat = Rooms.seatOf(room, tok(3));
  assert.equal(Rooms.lobby(room, tok(1), { type: 'remove', id: memberId(room, tok(3)) }), true);
  assert.equal(room.seatTokens[seat], null, 'the seat is now empty');
  assert.notEqual(room.game.cur, seat, 'if it was their turn, autopilot already finished it');
  let turnsPassed = 0;
  const start = room.game.turn;
  playUntil(room, () => (turnsPassed = room.game.turn - start) >= 9);
  assert.ok(turnsPassed >= 9, `the table kept playing (${turnsPassed} turns)`);
  assert.ok(room.game.players[seat], 'their pieces and cards are still in the game');
  assert.equal(Rooms.viewFor(room, tok(1)).room.vacant.includes(seat), true);
});

test('autopilot discards for an empty seat on a 7 and moves the robber on its turn', () => {
  const room = game(['Host', 'Ali', 'Sara']);
  const seat = Rooms.seatOf(room, tok(3));
  Rooms.lobby(room, tok(1), { type: 'remove', id: memberId(room, tok(3)) });
  // give the empty seat a big hand and make a real player roll a 7
  for (const r of R.RES) { room.game.players[seat].res[r] += 3; room.game.bank[r] -= 3; }
  playUntil(room, () => room.game.phase === 'roll' && room.game.cur !== seat);
  room.game = R.resolveRoll(R.startRoll(room.game), [3, 4]);
  Rooms.autopilot(room);
  assert.ok(!room.game.discards.some((d) => d.p === seat), 'the empty seat discarded on its own');
  // now make it the empty seat's turn on a 7
  playUntil(room, () => room.game.cur === seat || room.game.mode === 'robber', 50);
});

test('a spectator can take over the empty seat and play it', () => {
  const room = game(['Host', 'Ali', 'Sara'], { spectators: ['Zoya'] });
  const seat = Rooms.seatOf(room, tok(2));
  const cards = { ...room.game.players[seat].res };
  Rooms.lobby(room, tok(1), { type: 'remove', id: memberId(room, tok(2)) });
  assert.equal(Rooms.lobby(room, tok(3), { type: 'takeSeat', seat }), false, 'a seated player cannot grab a second seat');
  assert.equal(Rooms.lobby(room, tok(60), { type: 'takeSeat', seat }), true);
  assert.equal(Rooms.seatOf(room, tok(60)), seat);
  assert.equal(room.game.seats[seat].name, 'Zoya');
  assert.equal(Rooms.lobby(room, tok(1), { type: 'takeSeat', seat }), false, 'the seat is no longer free');
  const view = Rooms.viewFor(room, tok(60));
  assert.equal(view.room.you.seat, seat);
  assert.deepEqual(Object.keys(view.game.players[seat].res), Object.keys(cards), 'Zoya now sees that seat’s hand');
  assert.equal(Rooms.join(room, tok(2), 'Ali'), null, 'the removed player cannot come back in');
});

test('removing during the opening placements lets autopilot place for them', () => {
  const room = game(['Host', 'Ali', 'Sara'], { quick: false });
  const order = room.game.setupOrder;
  const first = order[0];
  const victim = [0, 1, 2].find((p) => p !== Rooms.seatOf(room, tok(1)));
  Rooms.lobby(room, tok(1), { type: 'remove', id: memberId(room, room.seatTokens[victim]) });
  // real players place; autopilot fills in the removed player's two settlements
  for (let i = 0; i < 20 && room.game.phase === 'setup'; i++) {
    const g = room.game; const t = room.seatTokens[g.cur];
    if (g.setup.need === 'settlement') Rooms.act(room, t, 'placeAtVertex', [R.validVertices(g)[0]]);
    else Rooms.act(room, t, 'placeAtEdge', [R.validEdges(g)[0]]);
  }
  void first;
  assert.notEqual(room.game.phase, 'setup', 'setup finished');
  assert.equal(room.game.townList.filter((v) => room.game.settlements[v].p === victim).length, 2);
});
