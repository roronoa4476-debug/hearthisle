// Instant moves: what a browser predicts for its own move must be exactly what
// the server then does, and a move the server would refuse is never predicted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/js/rules.js';
import * as Rooms from '../server/rooms.mjs';
import { predict } from '../public/js/predict.js';

const tok = (n) => n.toString(16).padStart(32, '0');

// What the server does with each predictable move (mirrors Rooms.act).
const SERVER = {
  chooseBuild: (g, [k]) => R.chooseBuild(g, k),
  cancelBuild: (g) => R.cancelBuild(g),
  placeAtVertex: (g, [v]) => R.placeAtVertex(g, v),
  placeAtEdge: (g, [e]) => R.placeAtEdge(g, e),
  endTurn: (g) => R.endTurn(g),
  bankTrade: (g, [give, get]) => R.bankTrade(g, give, get),
  discard: (g, [cards], seat) => (R.mustDiscard(g, seat) ? R.discardCards(g, cards, seat) : g),
  pickResource: (g, [r]) => R.pickResource(g, r),
};

/** Every move a player could try right now (legal or not). */
function candidates(g, seat) {
  const moves = [['endTurn', []], ['cancelBuild', []]];
  for (const k of ['road', 'settlement', 'city']) moves.push(['chooseBuild', [k]]);
  for (const v of R.validVertices(g)) moves.push(['placeAtVertex', [v]]);
  for (const e of R.validEdges(g)) moves.push(['placeAtEdge', [e]]);
  moves.push(['placeAtEdge', [0]], ['placeAtVertex', [0]]);
  for (const give of R.RES) for (const get of R.RES) moves.push(['bankTrade', [give, get]]);
  for (const r of R.RES) moves.push(['pickResource', [r]]);
  const d = g.discards?.find((x) => x.p === seat);
  if (d) {
    const cards = R.emptyRes();
    let left = d.n;
    for (const r of R.RES) { const k = Math.min(left, g.players[seat].res[r]); cards[r] = k; left -= k; }
    moves.push(['discard', [cards]], ['discard', [{ ...cards, wood: cards.wood + 1 }]]);
  }
  return moves;
}

const sig = ({ id, ...rest }) => JSON.stringify(rest);
function compare(pred, server, seat, label, before) {
  for (const key of ['cur', 'phase', 'mode', 'turn', 'longest', 'army', 'winner', 'freeRoads', 'plentyLeft', 'robber', 'serial', 'devPlayed', 'paired']) assert.deepEqual(pred[key], server[key], `${label}: ${key}`);
  for (const key of ['bank', 'roads', 'roadList', 'settlements', 'townList', 'discards', 'roadLens']) assert.deepEqual(pred[key], server[key], `${label}: ${key}`);
  assert.deepEqual(pred.players[seat].res, server.players[seat].res, `${label}: your hand`);
  assert.equal(pred.players[seat].cardCount, R.totalCards(server.players[seat].res), `${label}: your card count`);
  // the events this move created (older ones differ only by what this seat may see)
  const newest = Math.max(0, ...before.events.map((e) => e.id));
  const made = (g) => g.events.filter((e) => e.id > newest).map(sig);
  assert.deepEqual(made(pred), made(server), `${label}: the same animations`);
}

test('predicted moves match the server exactly, and refused moves are never predicted', () => {
  let checked = 0;
  let refused = 0;
  let heldBack = 0;
  for (const [count, quick] of [[3, false], [4, true], [5, true]]) {
    const room = Rooms.createRoom();
    Rooms.join(room, tok(1), 'Host');
    Rooms.lobby(room, tok(1), { type: 'spectate' });
    for (let i = 0; i < count; i++) Rooms.lobby(room, tok(1), { type: 'addBot' });
    Rooms.lobby(room, tok(1), { type: 'setOption', quick });
    Rooms.lobby(room, tok(1), { type: 'start' });
    for (let tick = 0; tick < 3000 && room.game.winner === null; tick++) {
      if (tick % 3 === 0) {
        const g = room.game;
        const seats = g.mode === 'discard' ? g.discards.map((d) => d.p) : [g.cur];
        for (const seat of seats) {
          const view = Rooms.viewFor(room, room.seatTokens[seat]).game;
          for (const [name, args] of candidates(g, seat)) {
            const server = SERVER[name](g, args, seat);
            const pred = predict(view, seat, name, args);
            const allowedOnServer = server !== g && (name !== 'pickResource' || g.mode === 'plenty');
            if (!allowedOnServer) {
              assert.equal(pred, null, `${name}(${JSON.stringify(args)}) is refused by the server, so it must not be predicted`);
              refused++;
              continue;
            }
            if (g.mode === 'discard' && name !== 'discard') continue; // only discarding happens in discard mode
            if (name === 'endTurn' && !pred) {
              // held back because the next player might win with point cards this seat can't see
              const next = server.cur;
              const hidden = view.players[next].dev.filter((c) => c.type === 'hidden').length;
              assert.ok(R.victoryPoints(view, next, false) + hidden >= R.winTarget(view), 'End Turn is only held back when a hidden win is possible');
              heldBack++;
              continue;
            }
            assert.ok(pred, `${name}(${JSON.stringify(args)}) is certain and should be predicted`);
            compare(pred, server, seat, `${name}(${JSON.stringify(args)})`, g);
            checked++;
          }
        }
      }
      Rooms.botTick(room, { instant: true });
    }
  }
  assert.ok(checked > 300, `checked ${checked} predicted moves`);
  assert.ok(refused > 1000, `checked ${refused} refused moves`);
});

test('ending your turn waits for the server when the next player could win with hidden point cards', () => {
  const g = { ...R.createGame({ autoSetup: true, winPoints: 8 }), phase: 'main' };
  const seat = g.cur;
  const next = R.endTurn(g).cur;
  // the next player has 2 points on the board and enough face-down cards to reach 8
  const hidden = Array.from({ length: 6 }, () => ({ type: 'hidden', turn: 0 }));
  const view = { ...g, players: g.players.map((pl, i) => (i === next ? { ...pl, dev: hidden } : pl)) };
  assert.equal(predict(view, seat, 'endTurn', []), null);
  assert.ok(predict(g, seat, 'endTurn', []), 'with no hidden cards the result is certain');
});

test('nothing hidden is ever predicted: dice, card draws, steals, Monopoly and player trades wait for the server', () => {
  const g = { ...R.createGame({ autoSetup: true }), phase: 'main' };
  const seat = g.cur;
  for (const name of ['roll', 'buyDevCard', 'playDevCard', 'moveRobber', 'stealFrom', 'propose', 'confirm', 'respond', 'counter']) {
    assert.equal(predict(g, seat, name, []), null, name);
  }
  assert.equal(predict({ ...g, mode: 'monopoly' }, seat, 'pickResource', ['ore']), null, 'Monopoly takes hidden cards');
  assert.equal(predict(g, (seat + 1) % 4, 'endTurn', []), null, 'never for someone else');
  assert.equal(predict(g, null, 'endTurn', []), null, 'never for a spectator');
});
