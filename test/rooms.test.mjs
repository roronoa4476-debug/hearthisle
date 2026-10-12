import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Rooms from '../server/rooms.mjs';
import * as R from '../public/js/rules.js';

const tok = (n) => n.toString(16).padStart(32, '0');

function lobbyWith(names) {
  const room = Rooms.createRoom();
  names.forEach((name, i) => Rooms.join(room, tok(i + 1), name));
  return room;
}

test('each colour can only be taken once; spectating frees it', () => {
  const room = lobbyWith(['Host', 'Ali']);
  assert.equal(room.members.get(tok(1)).color, 0, 'first joiner gets the first free colour');
  assert.equal(room.members.get(tok(2)).color, 1);
  assert.equal(Rooms.lobby(room, tok(2), { type: 'pickColor', color: 0 }), false, 'Red is taken by Host');
  assert.equal(Rooms.lobby(room, tok(2), { type: 'pickColor', color: 5 }), true);
  assert.equal(room.members.get(tok(2)).color, 5);
  Rooms.lobby(room, tok(1), { type: 'spectate' });
  assert.equal(room.members.get(tok(1)).role, 'spectator');
  assert.equal(Rooms.lobby(room, tok(2), { type: 'pickColor', color: 0 }), true, 'Red is free again');
});

test('only the host can start, and only with 3 to 6 players', () => {
  const room = lobbyWith(['Host', 'Ali']);
  assert.equal(Rooms.lobby(room, tok(1), { type: 'start' }), false, 'two players is too few');
  Rooms.join(room, tok(3), 'Sara');
  assert.equal(Rooms.lobby(room, tok(2), { type: 'start' }), false, 'not the host');
  Rooms.lobby(room, tok(3), { type: 'pickColor', color: 4 });
  assert.equal(Rooms.lobby(room, tok(1), { type: 'start' }), true);
  assert.equal(room.phase, 'game');
  assert.deepEqual(room.game.seats.map((s) => s.color), [0, 1, 4], 'seats follow colour order');
  assert.equal(R.player(room.game, 2).name, 'Sara');
  assert.equal(R.player(room.game, 2).color, R.PLAYERS[4].color);
});

test('spectators and late joiners watch without a seat', () => {
  const room = lobbyWith(['Host', 'Ali', 'Sara', 'Watcher']);
  Rooms.lobby(room, tok(4), { type: 'spectate' });
  Rooms.lobby(room, tok(1), { type: 'start' });
  assert.equal(room.game.playerCount, 3);
  assert.equal(Rooms.seatOf(room, tok(4)), -1);
  Rooms.join(room, tok(5), 'Late');
  assert.equal(room.members.get(tok(5)).role, 'spectator');
  assert.equal(Rooms.lobby(room, tok(5), { type: 'pickColor', color: 3 }), false, 'no colour picking mid-game');
  assert.equal(Rooms.act(room, tok(4), 'placeAtVertex', [R.validVertices(room.game)[0]]), false, 'spectators cannot move');
});

test('only the player whose turn it is can act', () => {
  const room = lobbyWith(['Host', 'Ali', 'Sara']);
  Rooms.lobby(room, tok(1), { type: 'start' });
  const g = room.game;
  const curTok = room.seatTokens[g.cur];
  const otherTok = room.seatTokens[(g.cur + 1) % 3];
  const vid = R.validVertices(g)[0];
  assert.equal(Rooms.act(room, otherTok, 'placeAtVertex', [vid]), false);
  assert.equal(Rooms.act(room, curTok, 'placeAtVertex', [vid]), true);
  assert.equal(Rooms.act(room, curTok, 'placeAtVertex', ['junk']), false, 'bad input is ignored');
  assert.equal(Rooms.act(room, curTok, 'hack', []), false);
});

test('each person only sees their own hand', () => {
  const room = lobbyWith(['Host', 'Ali', 'Sara', 'Watcher']);
  Rooms.lobby(room, tok(4), { type: 'spectate' });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  room.game.players.forEach((pl) => (pl.dev = [{ type: 'vp', turn: 0 }]));
  const mine = Rooms.viewFor(room, room.seatTokens[0]).game;
  assert.deepEqual(mine.players[0].res, room.game.players[0].res);
  assert.equal(mine.players[0].dev[0].type, 'vp');
  assert.equal(R.totalCards(mine.players[1].res), 0, 'other hands are blanked');
  assert.equal(mine.players[1].cardCount, R.totalCards(room.game.players[1].res), 'but their card count is public');
  assert.equal(mine.players[1].dev[0].type, 'hidden');
  assert.ok(mine.deck.every((c) => c === null), 'deck order is secret');
  const watcher = Rooms.viewFor(room, tok(4));
  assert.equal(watcher.room.you.seat, -1);
  assert.ok(watcher.game.players.every((pl) => pl.dev.every((c) => c.type === 'hidden')));
});

test('only the player who must discard can discard', () => {
  const room = lobbyWith(['Host', 'Ali', 'Sara']);
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const g = room.game;
  const victim = (g.cur + 1) % 3;
  for (const r of R.RES) { g.players[victim].res[r] += 2; g.bank[r] -= 2; }
  room.game = R.resolveRoll(g, [3, 4]);
  assert.equal(room.game.mode, 'discard');
  const n = room.game.discards[0].n;
  const cards = R.emptyRes();
  let left = n;
  for (const r of R.RES) { const k = Math.min(left, room.game.players[victim].res[r]); cards[r] = k; left -= k; }
  assert.equal(Rooms.act(room, room.seatTokens[room.game.cur], 'discard', [cards]), room.game.cur === victim);
  if (room.game.mode === 'discard') assert.equal(Rooms.act(room, room.seatTokens[victim], 'discard', [cards]), true);
  assert.equal(room.game.mode, 'robber');
});

test('a sealed backup restores a game after a restart, and tampering is rejected', async () => {
  const { seal, unseal } = await import('../server/snapshots.mjs');
  const room = lobbyWith(['Host', 'Ali', 'Sara']);
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const sealed = seal(Rooms.snapshotOf(room));
  assert.equal(unseal(sealed.slice(0, -4) + 'AAAA'), null, 'edited backups are refused');
  // simulate the server forgetting everything
  Rooms._rooms.delete(room.code);
  const back = Rooms.restoreRoom(unseal(sealed));
  assert.ok(back);
  assert.equal(back.code, room.code);
  assert.deepEqual(back.game.players, room.game.players);
  assert.equal(Rooms.seatOf(back, tok(2)), Rooms.seatOf(room, tok(2)), 'everyone keeps their seat');
  assert.equal(Rooms.restoreRoom(unseal(sealed)), back, 'a second copy does not overwrite a running room');
});
