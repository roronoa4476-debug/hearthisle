// Regression tests for bugs found in review. Each one failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Rooms from '../server/rooms.mjs';
import * as R from '../public/js/rules.js';
import { seal, unseal } from '../server/snapshots.mjs';

const tok = (n) => n.toString(16).padStart(32, '0');
function startedRoom(names = ['Host', 'Ali', 'Sara'], { spectators = [] } = {}) {
  const room = Rooms.createRoom();
  names.forEach((n, i) => Rooms.join(room, tok(i + 1), n));
  spectators.forEach((n, i) => { Rooms.join(room, tok(50 + i), n); Rooms.lobby(room, tok(50 + i), { type: 'spectate' }); });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  return room;
}
const allText = (view) => JSON.stringify(view.game);

test('bug: a drawn development card is never sent to opponents or spectators', () => {
  const room = startedRoom(['Host', 'Ali', 'Sara'], { spectators: ['Watcher'] });
  const g = room.game;
  room.game = R.resolveRoll(g, [1, 1]);
  const cur = room.game.cur;
  const curTok = room.seatTokens[cur];
  for (const r of ['sheep', 'wheat', 'ore']) { room.game.players[cur].res[r] += 1; room.game.bank[r] -= 1; }
  room.game.deck.push('vp');
  assert.equal(Rooms.act(room, curTok, 'buyDevCard'), true);
  assert.match(Rooms.viewFor(room, curTok).game.toast.text, /Victory Point/, 'the buyer is told what they drew');
  for (const t of [...room.seatTokens.filter((x) => x !== curTok), tok(50)]) {
    assert.doesNotMatch(allText(Rooms.viewFor(room, t)), /Victory Point|You drew/, 'nobody else learns the card');
  }
});

test('bug: a steal tells only the thief and the victim which resource moved', () => {
  const room = startedRoom(['Host', 'Ali', 'Sara'], { spectators: ['Watcher'] });
  let g = R.resolveRoll(room.game, [3, 4]);
  if (g.mode === 'discard') g = { ...g, mode: 'robber', discards: [] };
  const cur = g.cur;
  room.game = g;
  const victim = (cur + 1) % 3;
  for (const r of R.RES) { room.game.bank[r] += room.game.players[victim].res[r]; room.game.players[victim].res[r] = 0; }
  room.game.players[victim].res.ore = 3; room.game.bank.ore -= 3; // only ore, so the stolen card is certain
  room.game = { ...room.game, mode: 'steal', victims: [victim] };
  assert.equal(Rooms.act(room, room.seatTokens[cur], 'stealFrom', [victim]), true);
  assert.match(Rooms.viewFor(room, room.seatTokens[cur]).game.toast.text, /Ore/);
  assert.match(Rooms.viewFor(room, room.seatTokens[victim]).game.toast.text, /Ore/);
  const bystander = (cur + 2) % 3;
  assert.doesNotMatch(Rooms.viewFor(room, room.seatTokens[bystander]).game.toast?.text || '', /Ore/);
  assert.doesNotMatch(Rooms.viewFor(room, tok(50)).game.toast?.text || '', /Ore/);
});

test('bug: an older backup arriving first does not block a newer one', () => {
  const room = startedRoom();
  const old = seal(Rooms.snapshotOf(room));
  // play on: the newest backup is further ahead
  room.game = R.resolveRoll(room.game, [1, 1]);
  Rooms.act(room, room.seatTokens[room.game.cur], 'endTurn');
  const newer = seal(Rooms.snapshotOf(room));
  const newestTurn = room.game.turn;
  Rooms._rooms.delete(room.code); // server restart
  const a = Rooms.restoreRoom(unseal(old));
  Rooms.connected(a, tok(1), +1); // the stale player reconnects first
  const b = Rooms.restoreRoom(unseal(newer));
  assert.equal(b.game.turn, newestTurn, 'the newer backup wins');
  assert.equal(Rooms.seatOf(b, tok(1)), 0);
});

test('bug: nobody can act on a just-restored game until the newest backup has had a chance to arrive', () => {
  const room = startedRoom();
  room.game = R.resolveRoll(room.game, [1, 1]);
  const sealed = seal(Rooms.snapshotOf(room));
  Rooms._rooms.delete(room.code);
  const back = Rooms.restoreRoom(unseal(sealed));
  Rooms.connected(back, room.seatTokens[back.game.cur], +1);
  assert.equal(Rooms.act(back, room.seatTokens[back.game.cur], 'endTurn'), false, 'held while others reconnect');
  for (const t of back.seatTokens) if (t !== room.seatTokens[back.game.cur]) Rooms.connected(back, t, +1);
  assert.equal(Rooms.act(back, room.seatTokens[back.game.cur], 'endTurn'), true, 'everyone is back, play resumes');
});

test('bug: several players can discard at the same time on a 7', () => {
  const room = startedRoom();
  const g = room.game;
  const a = (g.cur + 1) % 3;
  const b = (g.cur + 2) % 3;
  for (const p of [a, b]) for (const r of R.RES) { g.players[p].res[r] += 2; g.bank[r] -= 2; }
  room.game = R.resolveRoll(g, [3, 4]);
  assert.equal(room.game.mode, 'discard');
  const pay = (p) => { const n = room.game.discards.find((d) => d.p === p).n; const c = R.emptyRes(); let left = n; for (const r of R.RES) { const k = Math.min(left, room.game.players[p].res[r]); c[r] = k; left -= k; } return c; };
  const [first, second] = room.game.discards.map((d) => d.p);
  assert.ok(first !== undefined && second !== undefined);
  // the second player in the list goes first
  assert.equal(Rooms.act(room, room.seatTokens[second], 'discard', [pay(second)]), true);
  assert.equal(Rooms.act(room, room.seatTokens[first], 'discard', [pay(first)]), true);
  assert.equal(room.game.mode, 'robber');
});

test('bug: hidden information never leaks through the shared state sent to others', () => {
  const room = startedRoom(['Host', 'Ali', 'Sara'], { spectators: ['Watcher'] });
  room.game.players.forEach((pl, i) => { pl.dev = [{ type: i ? 'monopoly' : 'knight', turn: 0 }]; });
  const v = Rooms.viewFor(room, tok(50));
  assert.doesNotMatch(allText(v), /monopoly|knight"/i);
  assert.ok(!('snapshot' in v), 'backups are added by the transport, sealed');
});
