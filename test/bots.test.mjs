// Computer players, lobby options, the turn timer and rematches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Rooms from '../server/rooms.mjs';
import * as R from '../public/js/rules.js';
import { botStep, wantsOffer, discardChoice } from '../server/bots.mjs';
import { soundsFor } from '../public/js/sound.js';
import { seal, unseal } from '../server/snapshots.mjs';

const tok = (n) => n.toString(16).padStart(32, '0');
const seeded = (seed = 13) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A room where the host only watches and `bots` computer players play. */
function botTable(bots, options = {}) {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.lobby(room, tok(1), { type: 'spectate' });
  for (let i = 0; i < bots; i++) assert.equal(Rooms.lobby(room, tok(1), { type: 'addBot' }), true);
  Rooms.lobby(room, tok(1), { type: 'setOption', ...options });
  assert.equal(Rooms.lobby(room, tok(1), { type: 'start' }), true);
  return room;
}
function playOut(room, limit = 20000) {
  let ticks = 0;
  while (room.game.winner === null && ticks < limit) {
    assert.equal(Rooms.botTick(room, { instant: true }), true, `bots stalled in ${room.game.phase}/${room.game.mode}`);
    if (ticks % 25 === 0) assert.ok(R.validSavedGame(room.game), 'state stays valid');
    ticks++;
  }
  return ticks;
}

for (const [count, quick] of [[3, false], [4, false], [4, true], [5, false], [6, true]]) {
  test(`${count} bots finish a whole game on their own (${quick ? 'quick start' : 'placing openings'})`, () => {
    const room = botTable(count, { quick });
    playOut(room);
    const g = room.game;
    assert.notEqual(g.winner, null, 'someone wins');
    assert.ok(R.victoryPoints(g, g.winner, true) >= R.winTarget(g));
    assert.ok(R.validSavedGame(g));
    assert.ok(g.townList.length > count * 2, 'bots built beyond their openings');
  });
}

test('bots respect a lower points target and the friendly robber', () => {
  const room = botTable(4, { quick: true, winPoints: 8, friendlyRobber: true });
  assert.equal(room.game.winPoints, 8);
  assert.equal(room.game.friendlyRobber, true);
  playOut(room);
  const g = room.game;
  assert.ok(R.victoryPoints(g, g.winner, true) >= 8 && R.victoryPoints(g, g.winner, true) < 10);
});

test('a human can play with bots: bots wait for the human, then carry on', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  for (let i = 0; i < 2; i++) Rooms.lobby(room, tok(1), { type: 'addBot' });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const me = Rooms.seatOf(room, tok(1));
  for (let i = 0; i < 200 && room.game.cur !== me; i++) Rooms.botTick(room, { instant: true });
  assert.equal(room.game.cur, me);
  // The human's turn: bots have nothing to do.
  if (room.game.mode !== 'discard') assert.equal(Rooms.botTick(room, { instant: true }), false);
});

test('bots answer trade offers they like and decline ones they cannot pay', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.lobby(room, tok(1), { type: 'addBot' });
  Rooms.lobby(room, tok(1), { type: 'addBot' });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const me = Rooms.seatOf(room, tok(1));
  for (let i = 0; i < 200 && !(room.game.cur === me && room.game.phase === 'main' && !room.game.mode); i++) {
    if (room.game.cur === me && room.game.phase === 'roll') { room.game = R.resolveRoll(R.startRoll(room.game), [2, 2]); continue; }
    if (room.game.cur === me) { room.game = R.endTurn(room.game); continue; }
    Rooms.botTick(room, { instant: true });
  }
  const g = room.game;
  const [a, b] = [0, 1, 2].filter((p) => p !== me);
  for (const r of R.RES) { g.bank[r] += g.players[me].res[r] + g.players[a].res[r] + g.players[b].res[r]; g.players[me].res[r] = g.players[a].res[r] = g.players[b].res[r] = 0; }
  const give = (p, patch) => { for (const [r, n] of Object.entries(patch)) { g.players[p].res[r] += n; g.bank[r] -= n; } };
  give(me, { ore: 2 });
  give(a, { wood: 3 }); // has spare wood
  // b has nothing, so it can't accept
  assert.equal(Rooms.act(room, tok(1), 'propose', [{ ...R.emptyRes(), ore: 2 }, { ...R.emptyRes(), wood: 1 }]), true);
  while (Rooms.botTick(room, { instant: true }) === true);
  assert.equal(room.game.offer.responses[a], 'accepted');
  assert.equal(room.game.offer.responses[b], 'declined');
  assert.equal(Rooms.act(room, tok(1), 'confirm', [a]), true);
  assert.equal(room.game.players[me].res.wood, 1);
  assert.equal(wantsOffer({ ...room.game, offer: null }, a), false);
});

test('bot discards keep what they are saving for', () => {
  const g = R.createGame({ autoSetup: true, rng: seeded(4) });
  for (const r of R.RES) { g.bank[r] += g.players[0].res[r]; g.players[0].res[r] = 0; }
  Object.assign(g.players[0].res, { wood: 6, brick: 1, wheat: 1, sheep: 1, ore: 1 });
  for (const r of R.RES) g.bank[r] -= g.players[0].res[r];
  const out = discardChoice(g, 0, 5);
  assert.equal(R.totalCards(out), 5);
  assert.equal(out.wood, 5, 'throws away the pile of wood first');
});

test('bots never act for someone else', () => {
  const g = R.createGame({ autoSetup: true, rng: seeded(9) });
  assert.equal(botStep(g, (g.cur + 1) % 4), g);
});

test('lobby bots: host only, free colours only, removable in the lobby but not mid-game', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.join(room, tok(2), 'Ali');
  assert.equal(Rooms.lobby(room, tok(2), { type: 'addBot' }), false, 'only the host adds bots');
  for (let i = 0; i < 4; i++) assert.equal(Rooms.lobby(room, tok(1), { type: 'addBot' }), true);
  assert.equal(Rooms.lobby(room, tok(1), { type: 'addBot' }), false, 'all six colours are taken');
  const bots = [...room.members.values()].filter((m) => m.bot);
  assert.equal(new Set(bots.map((b) => b.name)).size, 4, 'each bot has its own name');
  assert.equal(new Set(Rooms.seated(room).map((m) => m.color)).size, 6);
  assert.equal(Rooms.lobby(room, tok(2), { type: 'pickColor', color: bots[0].color }), false, 'a bot’s colour is taken');
  assert.equal(Rooms.lobby(room, tok(1), { type: 'remove', id: bots[0].id }), true);
  assert.equal(room.removed?.has(bots[0].token) ?? false, false);
  assert.equal(Rooms.lobby(room, tok(1), { type: 'start' }), true);
  assert.equal(Rooms.lobby(room, tok(1), { type: 'remove', id: bots[1].id }), false);
  const view = Rooms.viewFor(room, tok(2)).room;
  assert.ok(view.members.filter((m) => m.bot).every((m) => m.connected));
  assert.equal(view.members.find((m) => m.bot).name, 'Clover', 'bots have plain names; the Bot tag marks them');
});

test('options are validated and only the host can change them', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.join(room, tok(2), 'Ali');
  assert.equal(Rooms.lobby(room, tok(2), { type: 'setOption', winPoints: 8 }), false);
  Rooms.lobby(room, tok(1), { type: 'setOption', winPoints: 99, turnTimer: 7, balanced: 'yes', friendlyRobber: true });
  assert.deepEqual(room.options, { ...Rooms.DEFAULT_OPTIONS, friendlyRobber: true });
  Rooms.lobby(room, tok(1), { type: 'setOption', winPoints: 12, turnTimer: 90, balanced: true });
  assert.deepEqual(room.options, { quick: false, winPoints: 12, balanced: true, friendlyRobber: true, turnTimer: 90 });
  assert.throws(() => R.createGame({ winPoints: 3 }));
});

test('balanced maps are fairer than plain random ones', () => {
  let plain = 0;
  let balanced = 0;
  for (let i = 1; i <= 12; i++) {
    plain += R.boardImbalance(R.newBoard(true, seeded(i), 4), 4);
    const b = R.newBoard(true, seeded(i), 4, true);
    balanced += R.boardImbalance(b, 4);
    assert.ok(R.hotNumbersSeparated(b.numbers, 4), 'no touching 6 and 8');
  }
  assert.ok(balanced < plain * 0.6, `balanced ${balanced} vs random ${plain}`);
});

test('friendly robber protects players with 2 points or fewer', () => {
  let g = R.createGame({ autoSetup: true, rng: seeded(3), friendlyRobber: true });
  g = { ...g, phase: 'main', mode: 'robber' };
  const touches = (hid, p) => R.hexCorners(g, hid).some((v) => g.settlements[v]?.p === p);
  const others = [1, 2, 3].filter((p) => p !== g.cur);
  const targets = R.robberTargets(g);
  for (const hid of targets) for (const p of others) assert.equal(touches(hid, p), false, 'protected players are never blocked');
  const blocked = R.hexCorners(g, 0).length && g.players.map((_, i) => i).some((p) => p !== g.cur && touches(0, p));
  if (blocked && !targets.includes(0)) assert.equal(R.moveRobber(g, 0), g, 'moving there is refused');
  const open = R.robberTargets({ ...g, friendlyRobber: false });
  assert.ok(open.length > targets.length);
});

test('a reached points target ends the game at that score', () => {
  const g = R.createGame({ autoSetup: true, rng: seeded(5), winPoints: 8 });
  assert.equal(R.winTarget(g), 8);
  assert.equal(R.winTarget({ ...g, winPoints: undefined }), 10, 'older saves keep 10');
  assert.equal(R.validSavedGame({ ...g, winPoints: 9 }), false);
});

test('the turn timer finishes a late player’s turn and logs it', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.join(room, tok(2), 'Ali');
  Rooms.join(room, tok(3), 'Sara');
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true, turnTimer: 60 });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const view = Rooms.viewFor(room, tok(1)).room;
  assert.ok(view.deadlineIn > 55_000 && view.deadlineIn <= 60_000, 'a minute on the clock');
  const late = room.game.cur;
  const turn = room.game.turn;
  assert.equal(Rooms.expireTurn(room), true);
  assert.notEqual(room.game.cur, late);
  assert.equal(room.game.turn, turn + 1, 'only the late player’s turn was played');
  assert.match(room.game.log[0].text, /ran out of time/);
  assert.equal(Rooms.expireTurn({ ...room, options: { ...room.options }, game: { ...room.game, winner: 0 } }), false);
});

test('an old countdown never carries into the next game', () => {
  const room = Rooms.createRoom();
  for (let i = 1; i <= 3; i++) Rooms.join(room, tok(i), `P${i}`);
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true, turnTimer: 60 });
  Rooms.lobby(room, tok(1), { type: 'start' });
  assert.ok(Rooms.viewFor(room, tok(1)).room.deadlineIn > 0);
  Rooms.lobby(room, tok(1), { type: 'backToLobby', force: true });
  assert.equal(Rooms.viewFor(room, tok(1)).room.deadlineIn, null);
  Rooms.lobby(room, tok(1), { type: 'setOption', turnTimer: 0 });
  Rooms.lobby(room, tok(1), { type: 'start' });
  assert.equal(Rooms.viewFor(room, tok(1)).room.deadlineIn, null);
});

test('without a timer, nobody is rushed', () => {
  const room = Rooms.createRoom();
  for (let i = 1; i <= 3; i++) Rooms.join(room, tok(i), `P${i}`);
  Rooms.lobby(room, tok(1), { type: 'start' });
  assert.equal(Rooms.viewFor(room, tok(1)).room.deadlineIn, null);
});

test('rematch starts a fresh island with the same people, bots and options', () => {
  const room = Rooms.createRoom();
  Rooms.join(room, tok(1), 'Host');
  Rooms.join(room, tok(2), 'Ali');
  Rooms.lobby(room, tok(1), { type: 'addBot' });
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true, winPoints: 12 });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const seats = room.seatTokens.slice();
  assert.equal(Rooms.lobby(room, tok(1), { type: 'rematch' }), false, 'not before someone wins');
  room.game = { ...room.game, winner: 1 };
  assert.equal(Rooms.lobby(room, tok(2), { type: 'rematch' }), false, 'only the host');
  const before = room.game;
  assert.equal(Rooms.lobby(room, tok(1), { type: 'rematch' }), true);
  assert.notEqual(room.game, before);
  assert.equal(room.game.winner, null);
  assert.equal(room.game.winPoints, 12);
  assert.deepEqual([...room.seatTokens].sort(), [...seats].sort());
  assert.equal(room.phase, 'game');
});

test('bots and options survive a server restart', () => {
  const room = botTable(3, { quick: true, winPoints: 12, turnTimer: 90 });
  for (let i = 0; i < 10; i++) Rooms.botTick(room, { instant: true });
  const sealed = seal(Rooms.snapshotOf(room));
  Rooms._rooms.delete(room.code);
  const back = Rooms.restoreRoom(unseal(sealed));
  assert.equal(back.options.winPoints, 12);
  assert.equal(back.options.turnTimer, 90);
  assert.equal([...back.members.values()].filter((m) => m.bot).length, 3);
  assert.equal(Rooms.holding(back), false, 'bots count as already reconnected');
  playOut(back);
  assert.notEqual(back.game.winner, null);
});

test('sounds follow what happened on the table', () => {
  const g = R.createGame({ autoSetup: true, rng: seeded(2) });
  assert.deepEqual(soundsFor(g, { ...g, rolling: true }, 1), ['dice']);
  assert.deepEqual(soundsFor(g, { ...g, winner: 0 }, 1), ['win']);
  assert.ok(soundsFor(g, { ...g, robber: (g.robber + 1) % 19 }, 1).includes('robber'));
  assert.ok(soundsFor({ ...g, cur: 2 }, { ...g, cur: 1, phase: 'roll' }, 1).includes('turn'));
  assert.deepEqual(soundsFor(g, g, 1), []);
});

test('bots finish 12-point games, building roads for Longest Road once the board is full', () => {
  for (const count of [4, 6]) {
    const room = botTable(count, { quick: true, winPoints: 12 });
    playOut(room);
    assert.ok(R.victoryPoints(room.game, room.game.winner, true) >= 12);
  }
  assert.equal(R.WIN_CHOICES.includes(15), false, '15 can run out of board, so it is not offered');
});

test('a late discard only discards: the player still gets the rest of their turn', () => {
  const room = Rooms.createRoom();
  for (let i = 1; i <= 3; i++) Rooms.join(room, tok(i), `P${i}`);
  Rooms.lobby(room, tok(1), { type: 'setOption', quick: true, turnTimer: 60 });
  Rooms.lobby(room, tok(1), { type: 'start' });
  const g = room.game;
  const p = g.cur;
  for (const r of R.RES) { g.players[p].res[r] += 2; g.bank[r] -= 2; }
  room.game = R.resolveRoll(g, [3, 4]);
  assert.equal(room.game.mode, 'discard');
  const turn = room.game.turn;
  assert.equal(Rooms.expireTurn(room), true);
  assert.equal(room.game.cur, p, 'still their turn');
  assert.equal(room.game.turn, turn);
  assert.equal(room.game.mode, 'robber', 'they move the robber themselves');
});

test('a bot in the middle of a robber move is never cut off by the move limit', () => {
  const room = botTable(3, { quick: true });
  while (!(room.game.mode === 'robber' && Rooms.isBotSeat(room, room.game.cur))) {
    if (room.game.winner !== null) return;
    Rooms.botTick(room, { instant: true });
  }
  room.botSteps = { key: `t${room.game.turn}`, n: 999 };
  assert.equal(Rooms.botTick(room, { instant: true }), true);
  assert.notEqual(room.game.mode, 'robber');
});
