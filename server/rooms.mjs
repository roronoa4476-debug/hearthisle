// Online rooms. The server owns every game: clients send intentions, the
// server checks it is their turn, applies the pure rules, and sends each
// person a copy of the game with other players' hands hidden.
import { randomBytes, randomInt } from 'node:crypto';
import * as R from '../public/js/rules.js';

export const COLORS = R.PLAYERS.map((p) => p.name); // 6 colours, index = colour id
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MEMBERS = 16;
const MAX_ROOMS = 500; // protects a small free server from someone spamming new rooms
const RESTORE_HOLD_MS = 8000; // after a restart, wait for everyone's backups before play resumes
const BACKUP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const ROLL_MS = 550;
const PRODUCE_MS = 2200;

const rooms = new Map();
const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

export function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}
const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Player';
const cleanCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const basket = (b) => Object.fromEntries(R.RES.map((r) => [r, isInt(b?.[r], 0, 30) ? b[r] : 0]));

export function getRoom(code) {
  return rooms.get(cleanCode(code));
}

export function createRoom({ force = false } = {}) {
  if (!force && rooms.size >= MAX_ROOMS) return null;
  const room = {
    code: makeCode(),
    members: new Map(), // token -> member
    hostToken: null,
    phase: 'lobby',
    options: { quick: false },
    game: null,
    seatTokens: [], // game seat index -> member token
    touched: Date.now(),
    version: 0,
    timers: {},
    listeners: new Set(), // (room) => void, set by the transport
  };
  rooms.set(room.code, room);
  return room;
}

/** Join or re-join. Returns the member. */
export function join(room, token, name) {
  room.touched = Date.now();
  if (room.removed?.has(token)) return null; // the host removed this person
  let m = room.members.get(token);
  if (!m) {
    if (room.members.size >= MAX_MEMBERS) return null;
    m = { token, id: randomBytes(6).toString('hex'), name: cleanName(name), color: null, role: 'spectator', connected: 0, joined: Date.now() };
    room.members.set(token, m);
    // Lobby newcomers get the first free colour automatically; they can change it.
    if (room.phase === 'lobby') {
      const free = freeColors(room);
      if (free.length && seated(room).length < 6) {
        m.color = free[0];
        m.role = 'player';
      }
    }
  } else if (name) {
    m.name = cleanName(name);
  }
  if (!room.hostToken) room.hostToken = token; // the room's creator, permanently
  return m;
}

export const seated = (room) => [...room.members.values()].filter((m) => m.role === 'player');
export const freeColors = (room) => COLORS.map((_, i) => i).filter((c) => !seated(room).some((m) => m.color === c));
export const seatOf = (room, token) => (room.game ? room.seatTokens.indexOf(token) : -1);

// Practice is a separate room, never a privilege that can be enabled in a live game.
export function createPracticeRoom(token, name = 'Tester') {
  const room = createRoom();
  if (!room) return null;
  join(room, token, name);
  room.practice = true;
  startPractice(room, token);
  return room;
}

function stockPractice(room) {
  const g = structuredClone(room.game);
  for (const r of R.RES) {
    for (const pl of g.players) { g.bank[r] += pl.res[r]; pl.res[r] = 0; }
    g.players[0].res[r] = 12;
    g.players[1].res[r] = g.players[2].res[r] = 3;
    g.bank[r] -= 18;
  }
  room.game = g;
}

function startPractice(room, token) {
  const m = room.members.get(token);
  m.role = 'player';
  m.color = 0;
  room.phase = 'game';
  room.seatTokens = [token, null, null];
  room.game = R.createGame({ autoSetup: true, rng: secureRandom, seats: [
    { name: m.name, color: 0 }, { name: 'Practice Blue', color: 1 }, { name: 'Practice White', color: 2 },
  ] });
  // The first action phase is ready to try; subsequent turns use ordinary dice/rules.
  room.game.phase = 'main';
  room.game.log[0] = { ...room.game.log[0], text: 'Solo practice ready: build, trade with the bank, or try a development card.' };
  stockPractice(room);
}

function changed(room, meaningful = true) {
  room.touched = Date.now();
  if (meaningful) {
    room.version++;
    room.playedSinceRestore = true;
  }
  for (const fn of room.listeners) fn(room);
}

/** After a restart, hold moves until every seated player is back or a few seconds pass. */
export function holding(room) {
  if (!room.holdUntil) return false;
  const everyoneBack = room.seatTokens.every((t) => t === null || room.members.get(t)?.connected > 0);
  if (everyoneBack || Date.now() >= room.holdUntil) {
    room.holdUntil = 0;
    return false;
  }
  return true;
}

/* ---------- lobby ---------- */
export function lobby(room, token, msg) {
  const m = room.members.get(token);
  if (!m) return false;
  const isHost = room.hostToken === token;
  switch (msg.type) {
    case 'practiceRefill':
      if (!room.practice || !isHost || seatOf(room, token) !== 0 || !R.tradeOpen(room.game) || room.game.offer) return false;
      stockPractice(room);
      break;
    case 'practiceReset':
      if (!room.practice || !isHost) return false;
      Object.values(room.timers).forEach(clearTimeout);
      startPractice(room, token);
      break;
    case 'setName':
      m.name = cleanName(msg.name);
      if (room.game) {
        const s = seatOf(room, token);
        if (s >= 0) room.game.seats[s].name = m.name;
      }
      break;
    case 'pickColor': {
      if (room.phase !== 'lobby' || !isInt(msg.color, 0, 5)) return false;
      if (seated(room).some((o) => o !== m && o.color === msg.color)) return false; // taken
      m.color = msg.color;
      m.role = 'player';
      break;
    }
    case 'remove': {
      if (!isHost) return false;
      const target = [...room.members.values()].find((x) => x.id === msg.id);
      if (!target || target.token === room.hostToken) return false;
      const seat = seatOf(room, target.token);
      if (seat >= 0) room.seatTokens[seat] = null; // the seat stays in the game, played by autopilot
      room.members.delete(target.token);
      room.removed = room.removed || new Set();
      room.removed.add(target.token);
      autopilot(room);
      break;
    }
    case 'takeSeat': {
      // a spectator takes over a seat whose player was removed
      if (room.practice || room.phase !== 'game' || !room.game || room.game.winner !== null) return false;
      if (!isInt(msg.seat, 0, room.game.playerCount - 1) || room.seatTokens[msg.seat] !== null) return false;
      if (seatOf(room, token) >= 0) return false;
      room.seatTokens[msg.seat] = token;
      m.role = 'player';
      m.color = room.game.seats[msg.seat].color;
      room.game = { ...room.game, seats: room.game.seats.map((x, i) => (i === msg.seat ? { ...x, name: m.name } : x)) };
      room.game = R.noteTakeover(room.game, msg.seat, m.name);
      break;
    }
    case 'spectate':
      if (room.phase !== 'lobby') return false;
      m.color = null;
      m.role = 'spectator';
      break;
    case 'setOption':
      if (!isHost || room.phase !== 'lobby') return false;
      room.options.quick = !!msg.quick;
      break;
    case 'start': {
      if (!isHost || room.phase !== 'lobby') return false;
      const players = seated(room).sort((a, b) => a.color - b.color);
      if (players.length < 3 || players.length > 6) return false;
      room.seatTokens = players.map((p) => p.token);
      room.game = R.createGame({
        seats: players.map((p) => ({ name: p.name, color: p.color })),
        autoSetup: room.options.quick,
        chooseFirst: true,
        rng: secureRandom,
      });
      room.phase = 'game';
      break;
    }
    case 'backToLobby':
      if (room.practice) return false;
      if (!isHost || room.phase !== 'game' || (room.game && room.game.winner === null && !msg.force)) return false;
      Object.values(room.timers).forEach(clearTimeout);
      room.phase = 'lobby';
      room.game = null;
      room.seatTokens = [];
      break;
    default:
      return false;
  }
  changed(room);
  return true;
}

/* ---------- game actions ---------- */
const TURN_ACTIONS = new Set(['roll', 'endTurn', 'cancelBuild', 'chooseBuild', 'placeAtVertex', 'placeAtEdge', 'moveRobber', 'stealFrom', 'buyDevCard', 'playDevCard', 'pickResource', 'setTrade', 'bankTrade', 'propose', 'confirm', 'withdraw']);

export function act(room, token, name, args = []) {
  const g = room.game;
  if (!g || room.phase !== 'game' || !Array.isArray(args)) return false;
  const seat = seatOf(room, token);
  if (seat < 0) return false; // spectators can't act
  let next = g;
  try {
    if (holding(room)) return false;
    if (name === 'discard') {
      if (!R.mustDiscard(g, seat)) return false;
      next = R.discardCards(g, basket(args[0]), seat);
    } else if (name === 'respond') {
      next = R.respondTrade(g, seat, !!args[0]);
    } else if (name === 'counter') {
      next = R.counterTrade(g, seat, basket(args[0]), basket(args[1]));
    } else if (TURN_ACTIONS.has(name)) {
      if (seat !== g.cur || g.mode === 'discard') return false;
      const [a, b] = args;
      switch (name) {
        case 'roll':
          return roll(room);
        case 'endTurn': next = R.endTurn(g); break;
        case 'cancelBuild': next = R.cancelBuild(g); break;
        case 'chooseBuild': if (!['road', 'settlement', 'city'].includes(a)) return false; next = R.chooseBuild(g, a); break;
        case 'placeAtVertex': if (!Number.isInteger(a)) return false; next = R.placeAtVertex(g, a); break;
        case 'placeAtEdge': if (!Number.isInteger(a)) return false; next = R.placeAtEdge(g, a); break;
        case 'moveRobber': if (!R.robberTargets(g).includes(a)) return false; next = R.moveRobber(g, a, secureRandom); break;
        case 'stealFrom': if (!Number.isInteger(a)) return false; next = R.stealFrom(g, a, secureRandom); break;
        case 'buyDevCard': next = R.buyDevCard(g); break;
        case 'playDevCard': if (!R.DEV_TYPES.includes(a)) return false; next = R.playDevCard(g, a); break;
        case 'pickResource': if (!R.RES.includes(a)) return false; next = R.pickResource(g, a); break;
        case 'setTrade': {
          const patch = {};
          if (R.RES.includes(a?.give)) patch.give = a.give;
          if (R.RES.includes(a?.get)) patch.get = a.get;
          next = R.setTrade(g, patch);
          break;
        }
        case 'bankTrade': next = R.bankTrade(g); break;
        case 'propose': next = R.proposeTrade(g, basket(a), basket(b)); break;
        case 'confirm': if (!Number.isInteger(a)) return false; next = R.confirmTrade(g, a); break;
        case 'withdraw': next = R.withdrawTrade(g); break;
      }
    } else {
      return false;
    }
  } catch {
    return false; // malformed input never crashes the room
  }
  if (next === g) return false;
  room.game = next;
  autopilot(room);
  changed(room);
  return true;
}

/* ---------- autopilot for seats whose player was removed ---------- */
const vacant = (room, p) => room.seatTokens[p] === null;
const pipScore = (g, vid) => R.vertexValue(g, vid);

/** Play the simplest legal move for empty seats until a real person has to act. */
export function autopilot(room) {
  for (let guard = 0; guard < 80; guard++) {
    const g = room.game;
    if (!g || room.phase !== 'game' || g.winner !== null || g.rolling) return;
    let next = g;
    if (g.mode === 'discard') {
      const d = g.discards.find((x) => vacant(room, x.p));
      if (!d) return; // waiting for real people to discard
      next = R.discardCards(g, randomCards(g.players[d.p].res, d.n), d.p);
    } else if (!vacant(room, g.cur)) {
      return;
    } else if (g.offer) {
      next = R.withdrawTrade(g);
    } else if (g.phase === 'setup') {
      if (g.setup.need === 'settlement') {
        const best = R.validVertices(g).sort((a, b) => pipScore(g, b) - pipScore(g, a))[0];
        next = R.placeAtVertex(g, best);
      } else {
        next = R.placeAtEdge(g, R.validEdges(g)[0]);
      }
    } else if (g.mode === 'robber') {
      const targets = R.robberTargets(g);
      // prefer a tile without the autopilot seat's own buildings
      const own = (hid) => R.hexCorners(g, hid).some((v) => g.settlements[v]?.p === g.cur);
      next = R.moveRobber(g, targets.find((h) => !own(h)) ?? targets[0], secureRandom);
    } else if (g.mode === 'steal') {
      next = R.stealFrom(g, g.victims[0], secureRandom);
    } else if (g.mode === 'plenty') {
      next = R.pickResource(g, R.RES.find((r) => g.bank[r] > 0));
    } else if (g.mode === 'monopoly') {
      next = R.pickResource(g, 'ore');
    } else if (g.freeRoads > 0) {
      const edge = R.validEdges(g)[0];
      next = edge === undefined ? { ...g, freeRoads: 0, mode: null } : R.placeAtEdge(g, edge);
    } else if (g.mode) {
      next = R.cancelBuild(g);
    } else if (g.phase === 'roll') {
      next = R.resolveRoll(R.startRoll(g, secureRandom), R.rollDice(secureRandom), secureRandom);
    } else if (g.phase === 'main') {
      next = R.endTurn(g);
    }
    if (next === g) return; // nothing legal to do; never loop forever
    room.game = next;
  }
}

function randomCards(res, n) {
  const pool = R.RES.flatMap((r) => Array(res[r]).fill(r));
  const out = R.emptyRes();
  for (let i = 0; i < n && pool.length; i++) out[pool.splice(randomInt(pool.length), 1)[0]]++;
  return out;
}

function roll(room) {
  const started = R.startRoll(room.game, secureRandom);
  if (started === room.game) return false;
  room.game = started;
  changed(room);
  clearTimeout(room.timers.roll);
  room.timers.roll = setTimeout(() => {
    if (!room.game?.rolling) return;
    room.game = R.resolveRoll(room.game, room.game.dice, secureRandom);
    autopilot(room);
    changed(room);
    clearTimeout(room.timers.produce);
    room.timers.produce = setTimeout(() => {
      if (!room.game) return;
      const cleared = R.clearProducing(room.game);
      if (cleared !== room.game) {
        room.game = cleared;
        changed(room, false);
      }
    }, PRODUCE_MS);
  }, ROLL_MS);
  return true;
}

/* ---------- what each person is allowed to see ---------- */
export function viewFor(room, token) {
  const me = room.members.get(token);
  const seat = seatOf(room, token);
  const g = room.game;
  let game = null;
  if (g) {
    const reveal = g.winner !== null;
    game = {
      ...g,
      toast: R.noticeFor(g.toast, seat >= 0 ? seat : null),
      deck: g.deck.map(() => null),
      players: g.players.map((pl, i) =>
        i === seat || reveal
          ? { ...pl, cardCount: R.totalCards(pl.res) }
          : { res: R.emptyRes(), dev: pl.dev.map(() => ({ type: 'hidden', turn: 0 })), knights: pl.knights, cardCount: R.totalCards(pl.res) },
      ),
    };
  }
  return {
    type: 'room',
    room: {
      code: room.code,
      phase: room.phase,
      options: room.options,
      practice: !!room.practice,
      version: room.version,
      restoring: holding(room),
      vacant: room.seatTokens.flatMap((t, i) => (t === null ? [i] : [])),
      you: me ? { id: me.id, name: me.name, color: me.color, role: me.role, seat, host: room.hostToken === token } : null,
      members: [...room.members.values()]
        .sort((a, b) => a.joined - b.joined)
        .map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role, connected: m.connected > 0, host: room.hostToken === m.token, seat: seatOf(room, m.token) })),
    },
    game,
  };
}

export function connected(room, token, delta) {
  const m = room.members.get(token);
  if (!m) return;
  m.connected = Math.max(0, m.connected + delta);
  // The host never changes: whoever created the room stays host, even while
  // they refresh or drop out. Their seat and host role wait for them.
  changed(room, false);
}

/** Forget rooms nobody has touched for a while. */
export function sweep(maxIdleMs = 6 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const someoneHere = [...room.members.values()].some((m) => m.connected > 0);
    if (!someoneHere && now - room.touched > maxIdleMs) {
      Object.values(room.timers).forEach(clearTimeout);
      rooms.delete(code);
    }
  }
}

/* ---------- surviving a server restart ---------- */
export function snapshotOf(room) {
  return {
    v: 1,
    code: room.code,
    version: room.version,
    savedAt: Date.now(),
    hostToken: room.hostToken,
    phase: room.phase,
    options: room.options,
    practice: !!room.practice,
    game: room.game ? { ...room.game, toast: null } : null,
    seatTokens: room.seatTokens,
    removed: [...(room.removed || [])],
    members: [...room.members.values()].map(({ token, id, name, color, role, joined }) => ({ token, id, name, color, role, joined })),
  };
}

/** Rebuild a room from a sealed copy a browser handed back. Returns the room or null. */
export function restoreRoom(data) {
  if (!data || data.v !== 1 || typeof data.code !== 'string' || !Array.isArray(data.members)) return null;
  if (!Number.isInteger(data.version) || Date.now() - (data.savedAt || 0) > BACKUP_MAX_AGE_MS) return rooms.get(data.code) || null;
  const existing = rooms.get(data.code);
  // A running room is the truth, unless it was itself restored from a backup
  // and nobody has played since: then a newer backup replaces it.
  if (existing && !(existing.restoredFrom !== undefined && !existing.playedSinceRestore && data.version > existing.version)) return existing;
  if (data.game && !R.validSavedGame(data.game)) return existing || null;
  const live = existing ? existing.members : new Map(); // keep counts for people already reconnected
  const room = existing || createRoomWithCode(data.code);
  room.hostToken = data.hostToken;
  room.phase = data.phase === 'game' && data.game ? 'game' : 'lobby';
  room.options = { quick: !!data.options?.quick };
  room.practice = data.practice === true;
  room.game = room.phase === 'game' ? data.game : null;
  room.seatTokens = Array.isArray(data.seatTokens) ? data.seatTokens.map((t) => (typeof t === 'string' ? t : null)) : [];
  room.removed = new Set(Array.isArray(data.removed) ? data.removed : []);
  room.members = new Map(data.members.map((m) => [m.token, { ...m, connected: live.get(m.token)?.connected || 0 }]));
  room.version = data.version;
  room.restoredFrom = data.version;
  room.playedSinceRestore = false;
  room.holdUntil = room.phase === 'game' ? Date.now() + RESTORE_HOLD_MS : 0;
  clearTimeout(room.timers.hold);
  if (room.holdUntil) room.timers.hold = setTimeout(() => changed(room, false), RESTORE_HOLD_MS + 100).unref(); // tell everyone play has resumed
  if (room.game) {
    // Finish anything that was mid-animation when the server stopped.
    if (room.game.rolling) room.game = R.resolveRoll({ ...room.game, rolling: false }, room.game.dice, secureRandom);
    room.game = R.clearProducing(room.game);
    autopilot(room);
  }
  return room;
}

function createRoomWithCode(code) {
  const room = createRoom({ force: true });
  rooms.delete(room.code);
  room.code = code;
  rooms.set(code, room);
  return room;
}

export const _rooms = rooms; // for tests
