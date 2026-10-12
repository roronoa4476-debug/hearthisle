// Online rooms. The server owns every game: clients send intentions, the
// server checks it is their turn, applies the pure rules, and sends each
// person a copy of the game with other players' hands hidden.
import { randomBytes, randomInt } from 'node:crypto';
import * as R from '../public/js/rules.js';

export const COLORS = R.PLAYERS.map((p) => p.name); // 6 colours, index = colour id
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MEMBERS = 16;
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

export function createRoom() {
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
  if (!room.hostToken || !room.members.has(room.hostToken)) room.hostToken = token;
  return m;
}

export const seated = (room) => [...room.members.values()].filter((m) => m.role === 'player');
export const freeColors = (room) => COLORS.map((_, i) => i).filter((c) => !seated(room).some((m) => m.color === c));
export const seatOf = (room, token) => (room.game ? room.seatTokens.indexOf(token) : -1);

function changed(room) {
  room.touched = Date.now();
  room.version++;
  for (const fn of room.listeners) fn(room);
}

/* ---------- lobby ---------- */
export function lobby(room, token, msg) {
  const m = room.members.get(token);
  if (!m) return false;
  const isHost = room.hostToken === token;
  switch (msg.type) {
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
    if (name === 'discard') {
      if (g.mode !== 'discard' || g.discards[0]?.p !== seat) return false;
      next = R.discardCards(g, basket(args[0]));
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
  changed(room);
  return true;
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
    changed(room);
    clearTimeout(room.timers.produce);
    room.timers.produce = setTimeout(() => {
      if (!room.game) return;
      const cleared = R.clearProducing(room.game);
      if (cleared !== room.game) {
        room.game = cleared;
        changed(room);
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
  // If the host leaves, hand hosting to someone who is still here.
  const host = room.members.get(room.hostToken);
  if (!host || host.connected === 0) {
    const next = [...room.members.values()].sort((a, b) => a.joined - b.joined).find((x) => x.connected > 0);
    if (next) room.hostToken = next.token;
  }
  changed(room);
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
    hostToken: room.hostToken,
    phase: room.phase,
    options: room.options,
    game: room.game ? { ...room.game, toast: null } : null,
    seatTokens: room.seatTokens,
    members: [...room.members.values()].map(({ token, id, name, color, role, joined }) => ({ token, id, name, color, role, joined })),
  };
}

/** Rebuild a room from a sealed copy a browser handed back. Returns the room or null. */
export function restoreRoom(data) {
  if (!data || data.v !== 1 || typeof data.code !== 'string' || !Array.isArray(data.members)) return null;
  const existing = rooms.get(data.code);
  // A room already running is the truth, unless it was itself just restored
  // from an older copy and nothing has happened since.
  if (existing && !(existing.restoredFrom === existing.version && data.version > existing.version)) return existing;
  if (data.game && !R.validSavedGame(data.game)) return existing || null;
  const room = existing || createRoomWithCode(data.code);
  room.hostToken = data.hostToken;
  room.phase = data.phase === 'game' && data.game ? 'game' : 'lobby';
  room.options = { quick: !!data.options?.quick };
  room.game = room.phase === 'game' ? data.game : null;
  room.seatTokens = Array.isArray(data.seatTokens) ? data.seatTokens : [];
  room.members = new Map(data.members.map((m) => [m.token, { ...m, connected: 0 }]));
  room.version = data.version;
  room.restoredFrom = data.version;
  if (room.game) {
    // Finish anything that was mid-animation when the server stopped.
    if (room.game.rolling) room.game = R.resolveRoll({ ...room.game, rolling: false }, room.game.dice, secureRandom);
    room.game = R.clearProducing(room.game);
  }
  return room;
}

function createRoomWithCode(code) {
  const room = createRoom();
  rooms.delete(room.code);
  room.code = code;
  rooms.set(code, room);
  return room;
}

export const _rooms = rooms; // for tests
