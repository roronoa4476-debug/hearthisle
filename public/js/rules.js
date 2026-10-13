// Game rules for the base game. Pure functions: every action takes a state and
// returns a NEW state (or the same state object when the action is not allowed).
// No DOM access here, so the same module can later run on a multiplayer server.

import { getGeometry } from './geometry.js';
const geo = g => getGeometry(g.playerCount || g.players.length);

export const RES = ['wood', 'brick', 'wheat', 'sheep', 'ore'];
export const RES_NAME = { wood: 'Wood', brick: 'Brick', wheat: 'Wheat', sheep: 'Sheep', ore: 'Ore' };
export const RES_TERRAIN = { wood: 'forest', brick: 'hills', wheat: 'fields', sheep: 'pasture', ore: 'mountains' };
export const TERRAIN_RES = { forest: 'wood', hills: 'brick', fields: 'wheat', pasture: 'sheep', mountains: 'ore', desert: null };
export const TERRAIN_NAME = { forest: 'Forest', hills: 'Hills', fields: 'Fields', pasture: 'Pasture', mountains: 'Mountains', desert: 'Desert' };
export const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};
export const BUILD_NAME = { road: 'Road', settlement: 'Settlement', city: 'City', dev: 'Development card' };
export const SUPPLY = { road: 15, settlement: 5, city: 4 };
export const PLAYERS = [
  { name: 'Red', color: '#e0362c', edge: '#5a120c', mark: 'circle' },
  { name: 'Blue', color: '#1f6fe0', edge: '#0c2a5c', mark: 'diamond' },
  { name: 'White', color: '#f7f3ea', edge: '#3a2a1a', mark: 'triangle', light: true },
  { name: 'Orange', color: '#f5891c', edge: '#6a3306', mark: 'square' },
  { name: 'Green', color: '#2fa84a', edge: '#0f4a1c', mark: 'star' },
  { name: 'Purple', color: '#8e44cf', edge: '#3a145e', mark: 'cross' },
];
// A seat's name and colour. Online games store each player's chosen colour
// (an index into PLAYERS) and name in g.seats; local games use the default order.
export function player(g, p) {
  const seat = g?.seats?.[p];
  const base = PLAYERS[seat ? seat.color : p];
  return seat?.name ? { ...base, name: seat.name } : base;
}
export const SETUP_ORDER = [0, 1, 2, 3, 3, 2, 1, 0];
export const DEV_TYPES = ['knight', 'roads', 'plenty', 'monopoly', 'vp'];
export const DEV_NAME = { knight: 'Knight', roads: 'Road Building', plenty: 'Year of Plenty', monopoly: 'Monopoly', vp: 'Victory Point' };
export const DEV_TEXT = {
  knight: 'Move the robber. Steal 1 random resource.',
  roads: 'Build up to 2 roads for free.',
  plenty: 'Take any 2 resources from the bank.',
  monopoly: 'Take all cards of one resource from other players.',
  vp: 'Adds 1 hidden victory point.',
};
export const DECK = [].concat(
  Array(14).fill('knight'),
  Array(5).fill('vp'),
  Array(2).fill('roads'),
  Array(2).fill('plenty'),
  Array(2).fill('monopoly'),
);
export const TERRAIN_BAG = [
  'mountains', 'pasture', 'forest', 'fields', 'hills', 'pasture', 'hills', 'fields', 'forest', 'desert',
  'forest', 'mountains', 'forest', 'mountains', 'fields', 'pasture', 'hills', 'fields', 'pasture',
];
export const DEFAULT_NUMBERS = [6, 3, 11, 5, 10, 9, 8, 4, 12, 0, 9, 5, 8, 2, 10, 4, 11, 6, 3];
export const WIN_POINTS = 10;
export const WIN_CHOICES = [8, 10, 12]; // 15 can be unreachable: the board and pieces run out first
// Points needed to win this game (a lobby option; older saves use 10).
export const winTarget = (g) => g.winPoints || WIN_POINTS;
const BLOCKING = ['robber', 'steal', 'plenty', 'monopoly', 'discard'];

/* ---------- small helpers ---------- */
export const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);
export const emptyRes = () => ({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
export const totalCards = (r) => RES.reduce((s, k) => s + r[k], 0);
export const afford = (r, c) => Object.keys(c).every((k) => r[k] >= c[k]);
export const costText = (c) => Object.keys(c).map((k) => `${c[k]} ${RES_NAME[k]}`).join(', ');
export const isBlocking = (s) => BLOCKING.includes(s.mode) || s.freeRoads > 0;
const pay = (r, c) => Object.keys(c).forEach((k) => (r[k] -= c[k]));
const clone = (s) => structuredClone(s);
const shuffle = (list, rng) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export const rollDice = (rng = Math.random) => [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];

function log(g, text, who = g.cur) {
  g.log = [{ id: ++g.serial, text, color: player(g, who).color }, ...g.log];
}
// Notices. `text` is what everyone sees (null = nothing); `only` holds private
// texts for particular seats, e.g. the card you drew. The server sends each
// person only their own version, so private details never leave the server.
function toast(g, text, only = null) {
  g.toast = { id: ++g.serial, text, ...(only ? { only } : {}) };
}
const tell = (g, p, text) => toast(g, null, { [p]: text }); // just for one seat
export function noticeFor(t, seat) {
  if (!t) return null;
  const text = t.only && seat !== null && seat !== undefined && t.only[seat] !== undefined ? t.only[seat] : t.text;
  return text ? { id: t.id, text } : null;
}

/* ---------- board creation ---------- */
// Letter-side token sequences. Base diagram: supplied p11; expanded sequence:
// publisher-hosted Encyclopaedia Catanica 17.F.d (p121), same 28-token set.
export const BASE_SEQUENCE = [5,2,6,3,8,10,9,12,11,4,8,10,9,4,5,6,3,11];
export const EXPANSION_SEQUENCE = [2,5,4,6,3,9,8,11,11,10,6,3,8,4,8,10,11,12,10,5,4,9,5,9,12,3,2,6];
export function configFor(count=4) {
  const expanded=count>4;
  return { expanded, resourceCount:expanded?24:19,
    terrain: expanded ? [...TERRAIN_BAG,'forest','forest','pasture','pasture','fields','fields','hills','hills','mountains','mountains','desert'] : TERRAIN_BAG.slice(),
    sequence: expanded?EXPANSION_SEQUENCE:BASE_SEQUENCE,
    deck: expanded?[...DECK,...Array(6).fill('knight'),'roads','plenty','monopoly']:DECK.slice() };
}
export function hotNumbersSeparated(numbers,count=4) {
  const G=getGeometry(count), hot=n=>n===6||n===8;
  return G.hexes.every(h=>!hot(numbers[h.id])||G.neighbors[h.id].every(n=>!hot(numbers[n])));
}
// Lower is fairer: penalises touching 6/8s, touching equal numbers, clumps of
// one terrain, and a resource whose total odds are far from the others.
export function boardImbalance(board,count=4) {
  const G=getGeometry(count), {terrain,numbers}=board, hot=n=>n===6||n===8;
  let score=0;
  for(const h of G.hexes) for(const n of G.neighbors[h.id]) {
    if(n<h.id) continue;
    if(hot(numbers[h.id])&&hot(numbers[n])) score+=10;
    else if(numbers[h.id]&&numbers[h.id]===numbers[n]) score+=3;
    if(terrain[h.id]===terrain[n]) score+=1;
  }
  const odds=RES.map(r=>G.hexes.reduce((s,h)=>s+(TERRAIN_RES[terrain[h.id]]===r?pips(numbers[h.id]):0),0));
  return score+(Math.max(...odds)-Math.min(...odds))*0.5;
}
export function newBoard(randomize=true,rng=Math.random,count=4,balanced=false) {
  if(balanced && randomize) {
    let best=null,bestScore=Infinity;
    for(let i=0;i<60;i++){const b=newBoard(true,rng,count);const sc=boardImbalance(b,count);if(sc<bestScore)[best,bestScore]=[b,sc];}
    return best;
  }
  const cfg=configFor(count), G=getGeometry(count);
  if(!randomize && count<=4) return {terrain:TERRAIN_BAG.slice(),numbers:DEFAULT_NUMBERS.slice()};
  const terrain=shuffle(cfg.terrain,rng), numbers=terrain.map(()=>0), letters=terrain.map(()=>null);
  let k=0;
  for(const hid of G.spiral) if(terrain[hid]!=='desert') {
    numbers[hid]=cfg.sequence[k];letters[hid]=k<25?String.fromCharCode(65+k):['Za','Zb','Zc'][k-25];k++;
  }
  return {terrain,numbers,letters};
}

/* ---------- queries ---------- */
export function canSettle(g, vid, p, setup = g.phase === 'setup') {
  if (g.settlements[vid]) return false;
  const v = geo(g).verts[vid];
  if (!v) return false;
  if (v.adj.some((a) => g.settlements[a])) return false; // distance rule
  if (setup) return true;
  return v.edges.some((e) => g.roads[e] === p);
}
export function canCity(g, vid, p) {
  const s = g.settlements[vid];
  return !!s && s.p === p && !s.city;
}
export function canRoad(g, eid, p) {
  if (!geo(g).edges[eid] || g.roads[eid] !== undefined) return false;
  const e = geo(g).edges[eid];
  if (g.phase === 'setup') return g.setup.need === 'road' && (e.a === g.setup.lastV || e.b === g.setup.lastV);
  return [e.a, e.b].some((vid) => {
    const s = g.settlements[vid];
    if (s) return s.p === p; // an opponent's town blocks the path
    return geo(g).verts[vid].edges.some((x) => x !== eid && g.roads[x] === p);
  });
}
export function piecesLeft(g, p) {
  let road = 0;
  let settlement = 0;
  let city = 0;
  g.roadList.forEach((e) => g.roads[e] === p && road++);
  g.townList.forEach((v) => {
    const t = g.settlements[v];
    if (t.p === p) t.city ? city++ : settlement++;
  });
  return { road: SUPPLY.road - road, settlement: SUPPLY.settlement - settlement, city: SUPPLY.city - city, dev: g.deck.length };
}
export function harborRatio(g, p, r) {
  let ratio = 4;
  for (const h of geo(g).harbors) {
    if (!h.verts.some((v) => g.settlements[v]?.p === p)) continue;
    if (h.type === 'any') ratio = Math.min(ratio, 3);
    else if (h.type === r) ratio = 2;
  }
  return ratio;
}
export function longestRoadFor(g, p) {
  let best = 0;
  const walk = (v, used, len) => {
    if (len > best) best = len;
    const s = g.settlements[v];
    if (len > 0 && s && s.p !== p) return;
    for (const eid of geo(g).verts[v].edges) {
      if (g.roads[eid] !== p || used.has(eid)) continue;
      used.add(eid);
      const e = geo(g).edges[eid];
      walk(e.a === v ? e.b : e.a, used, len + 1);
      used.delete(eid);
    }
  };
  for (const eid of g.roadList) {
    if (g.roads[eid] !== p) continue;
    walk(geo(g).edges[eid].a, new Set(), 0);
    walk(geo(g).edges[eid].b, new Set(), 0);
  }
  return best;
}
export function victoryPoints(g, p, includeHidden) {
  let s = 0;
  g.townList.forEach((v) => {
    const t = g.settlements[v];
    if (t.p === p) s += t.city ? 2 : 1;
  });
  if (g.longest === p) s += 2;
  if (g.army === p) s += 2;
  if (includeHidden) s += g.players[p].dev.filter((c) => c.type === 'vp').length;
  return s;
}
export function canPlayDev(g, type) {
  if (type === 'vp' || g.winner !== null || g.phase === 'setup' || g.devPlayed || g.rolling || isBlocking(g)) return false;
  if (!['roll','main'].includes(g.phase)) return false;
  if(type==='roads' && (piecesLeft(g,g.cur).road<=0 || !geo(g).edges.some(e=>canRoad(g,e.id,g.cur))))return false;
  if(type==='plenty' && totalCards(g.bank)===0)return false;
  return g.players[g.cur].dev.some((c) => c.type === type && c.turn < g.turn);
}
export const tradeOpen = (g) => g.phase === 'main' && g.winner === null && !isBlocking(g) && !g.rolling;
export function bankTradeOk(g) {
  const t = g.trade;
  return tradeOpen(g) && RES.includes(t.give) && RES.includes(t.get) && t.give !== t.get && g.bank[t.get] > 0 && g.players[g.cur].res[t.give] >= harborRatio(g, g.cur, t.give);
}
export function validVertices(g) {
  const p = g.cur;
  if ((g.phase === 'setup' && g.setup.need === 'settlement') || g.mode === 'settlement') {
    return geo(g).verts.filter((v) => canSettle(g, v.id, p)).map((v) => v.id);
  }
  if (g.mode === 'city') return geo(g).verts.filter((v) => canCity(g, v.id, p)).map((v) => v.id);
  return [];
}
export function validEdges(g) {
  if (g.mode !== 'road') return [];
  return geo(g).edges.filter((e) => canRoad(g, e.id, g.cur)).map((e) => e.id);
}
// Friendly robber option: players with 2 or fewer visible points can't be
// blocked or robbed (unless every tile touches one of them).
export const protectedSeat = (g, p) => !!g.friendlyRobber && p !== g.cur && victoryPoints(g, p, false) <= 2;
export function robberTargets(g) {
  if (g.mode !== 'robber') return [];
  const all = geo(g).hexes.filter((h) => h.id !== g.robber);
  const safe = g.friendlyRobber ? all.filter((h) => !h.verts.some((v) => g.settlements[v] && protectedSeat(g, g.settlements[v].p))) : all;
  return (safe.length ? safe : all).map((h) => h.id);
}
export function prompt(g) {
  if (g.winner !== null) return `${player(g, g.winner).name} has won the island.`;
  if (g.phase === 'setup') {
    return g.setup.need === 'settlement'
      ? `Place your ${g.setup.step < g.players.length ? 'first' : 'second'} settlement on a marked corner.`
      : 'Place a road touching that settlement.';
  }
  if (g.rolling) return 'The dice are rolling…';
  switch (g.mode) {
    case 'discard': return `Waiting for ${g.discards.map(d=>player(g,d.p).name).join(' and ')} to discard.`;
    case 'robber': return 'Choose a tile for the robber.';
    case 'steal': return 'Choose a player to steal from.';
    case 'plenty': return `Pick ${g.plentyLeft} resource${g.plentyLeft > 1 ? 's' : ''} from the bank.`;
    case 'monopoly': return 'Pick the resource to claim from everyone.';
    case 'road': return g.freeRoads ? `Place a free road (${g.freeRoads} left).` : 'Choose an edge for your road.';
    case 'settlement': return 'Choose a corner for your settlement.';
    case 'city': return 'Choose a settlement to raise into a city.';
    default: return g.phase === 'roll' ? 'Roll the dice to begin your turn.' : 'Build, trade, or end your turn.';
  }
}

/* ---------- internal mutations (on a cloned state) ---------- */
function placeTown(g, vid, p) {
  g.settlements[vid] = { p, city: false };
  g.townList.push(vid);
}
function placeRoad(g, eid, p) {
  g.roads[eid] = p;
  g.roadList.push(eid);
}
function grantOpening(g, vid, p) {
  for (const h of geo(g).verts[vid].hexes) {
    const r = TERRAIN_RES[g.terrain[h]];
    if (r && g.bank[r]>0) {g.players[p].res[r]++;g.bank[r]--;}
  }
}
function updateLongest(g) {
  const lens = g.players.map((_, p) => longestRoadFor(g, p));
  g.roadLens = lens;
  const max = Math.max(...lens), leaders=lens.flatMap((n,i)=>n===max?[i]:[]);
  const holder = max < 5 ? null : leaders.includes(g.longest) ? g.longest : leaders.length===1 ? leaders[0] : null;
  if (holder !== null && holder !== g.longest) log(g, `${player(g, holder).name} takes Longest Road (${lens[holder]}).`, holder);
  g.longest = holder;
}
function updateArmy(g) {
  const p = g.cur;
  const k = g.players[p].knights;
  if (k >= 3 && g.army !== p && (g.army === null || k > g.players[g.army].knights)) {
    g.army = p;
    log(g, `${player(g, p).name} takes Largest Army.`);
  }
}
function checkWin(g) {
  if (g.winner === null && victoryPoints(g, g.cur, true) >= winTarget(g)) {
    g.winner = g.cur;
    g.mode = null;
    log(g, `${player(g, g.cur).name} reaches ${winTarget(g)} points and wins.`);
  }
}
function steal(g, from, rng) {
  const r = g.players[from].res;
  const pool = RES.flatMap((k) => Array(r[k]).fill(k));
  if (!pool.length) return;
  const k = pool[Math.floor(rng() * pool.length)];
  r[k]--;
  g.players[g.cur].res[k]++;
  toast(g, `${player(g, g.cur).name} stole a card from ${player(g, from).name}.`, {
    [g.cur]: `You took 1 ${RES_NAME[k]} from ${player(g, from).name}.`,
    [from]: `${player(g, g.cur).name} took 1 ${RES_NAME[k]} from you.`,
  });
  log(g, `${player(g, g.cur).name} stole a card from ${player(g, from).name}.`);
}
function vertexScore(g, vid) {
  const kinds = new Set();
  let s = 0;
  for (const h of geo(g).verts[vid].hexes) {
    const r = TERRAIN_RES[g.terrain[h]];
    if (r) {
      s += pips(g.numbers[h]);
      kinds.add(r);
    }
  }
  return s + kinds.size * 0.6;
}

/* ---------- game creation ---------- */
export function createGame({ randomize = true, autoSetup = true, rng = Math.random, playerCount=4, chooseFirst=false, firstPlayer=0, seats=null, winPoints=WIN_POINTS, friendlyRobber=false, balanced=false } = {}) {
  if (seats) playerCount = seats.length;
  if (![3,4,5,6].includes(playerCount)) throw new RangeError('Choose 3–6 players');
  if (!WIN_CHOICES.includes(winPoints)) throw new RangeError('Unsupported points target');
  const board = newBoard(randomize, rng, playerCount, balanced);
  const openingRolls=Array(playerCount).fill(null);
  if(chooseFirst){
    let tied=Array.from({length:playerCount},(_,i)=>i);
    for(let attempt=0;tied.length>1 && attempt<100;attempt++){
      tied.forEach(i=>{openingRolls[i]=rollDice(rng);});
      const max=Math.max(...tied.map(i=>openingRolls[i][0]+openingRolls[i][1]));
      tied=tied.filter(i=>openingRolls[i][0]+openingRolls[i][1]===max);
    }
    firstPlayer=tied[0];
  }
  const setupOrder=Array.from({length:playerCount},(_,i)=>(firstPlayer+i)%playerCount);
  setupOrder.push(...setupOrder.slice().reverse());
  const g = {
    schema: 2, serial: 0, playerCount, seats: seats ? seats.map(({ name, color }) => ({ name: String(name).slice(0, 24), color })) : null, firstPlayer, lead:firstPlayer, paired:false, setupOrder, openingRolls,
    bank:Object.fromEntries(RES.map(r=>[r,configFor(playerCount).resourceCount])),
    letters:board.letters || [], discards:[], gains:[], offer:null,
    terrain: board.terrain,
    numbers: board.numbers,
    robber: board.terrain.indexOf('desert'),
    settlements: {},
    townList: [],
    roads: {},
    roadList: [],
    roadLens: Array(playerCount).fill(0),
    players: PLAYERS.slice(0,playerCount).map(() => ({ res: emptyRes(), dev: [], knights: 0 })),
    cur: firstPlayer,
    phase: 'setup',
    setup: { step: 0, need: 'settlement', lastV: null },
    mode: null,
    dice: [3, 4],
    lastRoll: null,
    rolling: false,
    producing: [],
    toast: null,
    log: [],
    deck: shuffle(configFor(playerCount).deck, rng),
    longest: null,
    army: null,
    winner: null,
    turn: 1,
    devPlayed: false,
    freeRoads: 0,
    plentyLeft: 0,
    victims: [],
    trade: { tab: 'bank', give: 'wheat', get: 'ore', giveN: 1, getN: 1 },
    winPoints, friendlyRobber: !!friendlyRobber,
  };
  if (autoSetup) {
    // Each player takes the best open corner in snake order (a quick-start helper).
    setupOrder.forEach((p, step) => {
      g.cur = p;
      let best = null;
      let bestScore = -1;
      for (const v of geo(g).verts) {
        if (!canSettle(g, v.id, p, true)) continue;
        const sc = vertexScore(g, v.id);
        if (sc > bestScore) [best, bestScore] = [v.id, sc];
      }
      if (best === null) return;
      placeTown(g, best, p);
      if (step >= playerCount) grantOpening(g, best, p);
      let road = null;
      let dist = Infinity;
      for (const eid of geo(g).verts[best].edges) {
        if (g.roads[eid] !== undefined) continue;
        const e = geo(g).edges[eid];
        const o = geo(g).verts[e.a === best ? e.b : e.a];
        const d = Math.hypot(o.x, o.y);
        if (d < dist) [road, dist] = [eid, d];
      }
      if (road !== null) placeRoad(g, road, p);
    });
    g.cur = firstPlayer;
    g.phase = 'roll';
    g.setup = null;
    updateLongest(g);
    log(g, 'Opening settlements placed in snake order.', 3);
    log(g, `${player(g, g.firstPlayer).name} to roll.`, firstPlayer);
  } else {
    log(g, `A new island is drawn. ${player(g, g.firstPlayer).name} places first.`, firstPlayer);
    toast(g, `${player(g, g.firstPlayer).name}: place your first settlement on a corner.`);
  }
  return g;
}

/* ---------- actions ---------- */
export function startRoll(s, rng = Math.random) {
  if (s.phase !== 'roll' || s.rolling || s.winner !== null || isBlocking(s) || s.mode) return s;
  return { ...s, rolling: true, dice: rollDice(rng) };
}

export function resolveRoll(s, dice, rng = Math.random) {
  if (s.phase !== 'roll' || s.winner !== null || isBlocking(s) || !Array.isArray(dice) || dice.length!==2 || dice.some(n=>!Number.isInteger(n)||n<1||n>6)) return s;
  const g = clone(s);
  const sum = dice[0] + dice[1];
  const me = player(g, g.cur).name;
  g.rolling = false;
  g.dice = dice;
  g.lastRoll = sum;
  g.phase = 'main';
  if (sum === 7) {
    g.discards=g.players.flatMap((pl,p)=>totalCards(pl.res)>7?[{p,n:Math.floor(totalCards(pl.res)/2)}]:[]);
    g.mode=g.discards.length?'discard':'robber';
    log(g, `${me} rolled 7.`);
    toast(g, g.mode === 'discard' ? `Seven! Players with more than 7 cards return half.` : `Seven! ${me} moves the robber.`, { [g.cur]: g.mode === 'discard' ? 'Seven! Waiting for discards, then move the robber.' : 'Seven! Move the robber to a new tile.' });
    return g;
  }
  const gains = g.players.map(() => emptyRes());
  const producing = [], shortages=[];
  for (const h of geo(g).hexes) {
    if (g.numbers[h.id] !== sum || g.robber === h.id) continue;
    const r = TERRAIN_RES[g.terrain[h.id]];
    if (!r) continue;
    producing.push(h.id);
    for (const v of h.verts) {
      const t = g.settlements[v];
      if (t) gains[t.p][r] += t.city ? 2 : 1;
    }
  }
  for(const r of RES){
    const receivers=gains.flatMap((gr,i)=>gr[r]>0?[i]:[]),need=gains.reduce((sum,gr)=>sum+gr[r],0);
    if(need>g.bank[r]){
      shortages.push(RES_NAME[r]);
      if(receivers.length===1) gains[receivers[0]][r]=g.bank[r];
      else gains.forEach(gr=>{gr[r]=0;});
    }
    gains.forEach((gr,i)=>{g.players[i].res[r]+=gr[r];g.bank[r]-=gr[r];});
  }
  g.gains=gains;
  g.producing = producing;
  const describe = (gr) => RES.filter((r) => gr[r]).map((r) => `${gr[r]} ${RES_NAME[r]}`).join(', ');
  const personal = {};
  gains.forEach((gr, i) => { if (describe(gr)) personal[i] = `Rolled ${sum} — you collect ${describe(gr)}.`; });
  if (personal[g.cur] === undefined) personal[g.cur] = `Rolled ${sum} — nothing for you this time.`;
  toast(g, `${me} rolled ${sum}.`, personal);
  const all = gains.map((gr, i) => (describe(gr) ? `${player(g, i).name} +${describe(gr)}` : '')).filter(Boolean).join('; ');
  log(g, `${me} rolled ${sum}${all ? `: ${all}` : '.'}${shortages.length?` Bank shortage: ${shortages.join(', ')}.`:''}`);
  return g;
}

export function clearProducing(s) {
  return s.producing.length ? { ...s, producing: [], gains:[] } : s;
}
export function clearToast(s, id) {
  return s.toast && s.toast.id === id ? { ...s, toast: null } : s;
}

export function endTurn(s) {
  if (s.phase !== 'main' || s.winner !== null || isBlocking(s) || s.rolling) return s;
  const g = clone(s);
  if(g.playerCount>4 && !g.paired){g.cur=(g.lead+3)%g.playerCount;g.paired=true;g.phase='main';}
  else {g.lead=(g.lead+1)%g.playerCount;g.cur=g.lead;g.paired=false;g.phase='roll';}
  g.mode = null;
  g.devPlayed = false;
  g.freeRoads = 0;
  g.turn++;
  g.producing = [];
  g.gains=[];g.offer=null;checkWin(g);
  toast(g, `${player(g, g.cur).name}’s turn${g.paired?' — actions only.':' — roll the dice.'}`);
  return g;
}

export function cancelBuild(s) {
  if (isBlocking(s) || s.phase === 'setup' || !s.mode) return s;
  return { ...s, mode: null, freeRoads: 0 };
}

// Recheck payment and supply when the piece is placed: a trade may have
// changed the hand since the player selected the build button.
function canCompleteBuild(g, kind) {
  return (g.phase === 'main' || kind==='road' && g.freeRoads>0 && g.phase==='roll') && g.winner === null && !g.rolling &&
    piecesLeft(g, g.cur)[kind] > 0 &&
    (kind === 'road' && g.freeRoads > 0 || afford(g.players[g.cur].res, COST[kind]));
}

function cancelUnaffordableBuild(g) {
  const kind = g.mode;
  if (!['road', 'settlement', 'city'].includes(kind) || canCompleteBuild(g, kind)) return;
  g.mode = null;
  g.freeRoads = 0;
  tell(g, g.cur, `Trade complete. You no longer have enough resources for that ${BUILD_NAME[kind].toLowerCase()}.`);
}

export function chooseBuild(s, kind) {
  if (s.winner !== null || s.phase === 'setup' || isBlocking(s) || s.rolling) return s;
  const g = clone(s);
  const p = g.cur;
  if (g.mode === kind) {
    g.mode = null;
    g.freeRoads = 0;
    return g;
  }
  if(!['road','settlement','city'].includes(kind)) return s;
  const noun = BUILD_NAME[kind].toLowerCase();
  if (g.phase !== 'main') return tell(g, p, 'Roll the dice before you build.'), g;
  if (!afford(g.players[p].res, COST[kind])) return tell(g, p, `A ${noun} costs ${costText(COST[kind])}.`), g;
  if (piecesLeft(g, p)[kind] <= 0) return tell(g, p, `No ${kind === 'city' ? 'cities' : `${noun}s`} left in your supply.`), g;
  g.mode = kind;
  const any = kind === 'road' ? validEdges(g).length : validVertices(g).length;
  if (!any) {
    g.mode = null;
    tell(g, p, `There is no legal spot for a ${noun} yet.`);
  }
  return g;
}

export function placeAtVertex(s, vid) {
  const p = s.cur;
  if(s.winner!==null || s.rolling) return s;
  if (s.phase === 'setup') {
    if (s.setup.need !== 'settlement' || !canSettle(s, vid, p, true)) return s;
    const g = clone(s);
    placeTown(g, vid, p);
    if (g.setup.step >= g.players.length) grantOpening(g, vid, p);
    g.setup.lastV = vid;
    g.setup.need = 'road';
    g.mode = 'road';
    log(g, `${player(g, p).name} founded a settlement.`);
    updateLongest(g);
    return g;
  }
  if (!['settlement', 'city'].includes(s.mode) || !canCompleteBuild(s, s.mode)) return s;
  const g = clone(s);
  if (g.mode === 'settlement' && canSettle(g, vid, p, false)) {
    payBank(g,p,COST.settlement);
    placeTown(g, vid, p);
    log(g, `${player(g, p).name} built a settlement.`);
    updateLongest(g); // a new settlement can cut an opponent's road
  } else if (g.mode === 'city' && canCity(g, vid, p)) {
    payBank(g,p,COST.city);
    g.settlements[vid].city = true;
    log(g, `${player(g, p).name} raised a city.`);
  } else {
    return s;
  }
  g.mode = null;
  checkWin(g);
  return g;
}

export function placeAtEdge(s, eid) {
  if(s.winner!==null || s.rolling) return s;
  const p = s.cur;
  if (!canRoad(s, eid, p)) return s;
  const g = clone(s);
  if (g.phase === 'setup') {
    placeRoad(g, eid, p);
    g.setup.step++;
    if (g.setup.step >= g.setupOrder.length) {
      g.phase = 'roll';
      g.cur = g.firstPlayer;
      g.mode = null;
      g.setup = null;
      toast(g, `Openings placed. ${player(g, g.firstPlayer).name} rolls first.`);
    } else {
      g.cur = g.setupOrder[g.setup.step];
      g.setup.need = 'settlement';
      g.mode = null;
      toast(g, `${player(g, g.cur).name}: place a settlement.`);
    }
    updateLongest(g);
    return g;
  }
  if (g.mode !== 'road' || !canCompleteBuild(g, 'road')) return s;
  if (g.freeRoads > 0) g.freeRoads--;
  else payBank(g,p,COST.road);
  placeRoad(g, eid, p);
  log(g, `${player(g, p).name} built a road.`);
  updateLongest(g);
  if (!(g.freeRoads > 0 && piecesLeft(g, p).road > 0 && validEdges(g).length)) {
    g.mode = null;
    g.freeRoads = 0;
  }
  checkWin(g);
  return g;
}

export function moveRobber(s, hid, rng = Math.random) {
  if (s.winner!==null || s.mode !== 'robber' || !robberTargets(s).includes(hid)) return s;
  const g = clone(s);
  g.robber = hid;
  const n = g.numbers[hid];
  log(g, `${player(g, g.cur).name} moved the robber to ${TERRAIN_NAME[g.terrain[hid]]}${n ? ` ${n}` : ''}.`);
  const victims = [];
  for (const v of geo(g).hexes[hid].verts) {
    const t = g.settlements[v];
    if (t && t.p !== g.cur && !victims.includes(t.p) && !protectedSeat(g, t.p) && totalCards(g.players[t.p].res) > 0) victims.push(t.p);
  }
  if (victims.length === 0) {
    g.mode = null;
    toast(g, 'No one there has cards to steal.');
  } else if (victims.length === 1) {
    steal(g, victims[0], rng);
    g.mode = null;
  } else {
    g.victims = victims;
    g.mode = 'steal';
  }
  return g;
}

export function stealFrom(s, victim, rng = Math.random) {
  if (s.mode !== 'steal' || !s.victims.includes(victim)) return s;
  const g = clone(s);
  steal(g, victim, rng);
  g.mode = null;
  g.victims = [];
  return g;
}

export function buyDevCard(s) {
  if (s.winner !== null || s.phase === 'setup' || isBlocking(s) || s.rolling) return s;
  const g = clone(s);
  const p = g.cur;
  const pl = g.players[p];
  if (g.phase !== 'main') return tell(g, p, 'Roll the dice before you buy.'), g;
  if (!g.deck.length) return tell(g, p, 'The development deck is empty.'), g;
  if (!afford(pl.res, COST.dev)) return tell(g, p, `A development card costs ${costText(COST.dev)}.`), g;
  payBank(g,p,COST.dev);
  const card = g.deck.pop();
  pl.dev.push({ type: card, turn: g.turn });
  g.mode = null;
  toast(g, `${player(g, p).name} bought a development card.`, { [p]: `You drew ${DEV_NAME[card]}.` });
  log(g, `${player(g, p).name} bought a development card.`);
  checkWin(g);
  return g;
}

export function playDevCard(s, type) {
  if (!canPlayDev(s, type)) return s;
  const g = clone(s);
  const p = g.cur;
  const pl = g.players[p];
  const name = player(g, p).name;
  pl.dev.splice(pl.dev.findIndex((c) => c.type === type && c.turn < g.turn), 1);
  g.devPlayed = true;
  if (type === 'knight') {
    pl.knights++;
    updateArmy(g);
    g.mode = 'robber';
    toast(g, `${name} played a Knight.`, { [p]: 'Knight played — move the robber.' });
    log(g, `${name} played a Knight.`);
  } else if (type === 'roads') {
    g.freeRoads = Math.min(2, piecesLeft(g, p).road);
    g.mode = 'road';
    if (!g.freeRoads || !validEdges(g).length) {
      g.mode = null;
      g.freeRoads = 0;
    }
    toast(g, `${name} played Road Building.`, { [p]: 'Place up to two free roads.' });
    log(g, `${name} played Road Building.`);
  } else if (type === 'plenty') {
    g.plentyLeft = Math.min(2,totalCards(g.bank));
    g.mode = g.plentyLeft ? 'plenty' : null;
    toast(g, `${name} played Year of Plenty.`, { [p]: 'Choose two resources from the bank.' });
    log(g, `${name} played Year of Plenty.`);
  } else if (type === 'monopoly') {
    g.mode = 'monopoly';
    toast(g, `${name} played Monopoly.`, { [p]: 'Choose a resource to claim.' });
    log(g, `${name} played Monopoly.`);
  }
  checkWin(g);
  return g;
}

export function pickResource(s, r) {
  if (s.winner!==null || !RES.includes(r) || (s.mode !== 'plenty' && s.mode !== 'monopoly')) return s;
  if(s.mode==='plenty' && s.bank[r]<=0) return s;
  const g = clone(s);
  const p = g.cur;
  if (g.mode === 'plenty') {
    g.players[p].res[r]++;g.bank[r]--;
    g.plentyLeft--;
    if (g.plentyLeft <= 0 || totalCards(g.bank)===0) g.mode = null;
  } else {
    let n = 0;
    g.players.forEach((pl, i) => {
      if (i === p) return;
      n += pl.res[r];
      pl.res[r] = 0;
    });
    g.players[p].res[r] += n;
    g.mode = null;
    toast(g, `Monopoly claims ${n} ${RES_NAME[r]}.`);
    log(g, `${player(g, p).name} claimed ${n} ${RES_NAME[r]}.`);
  }
  return g;
}

export function setTrade(s, patch) {
  const trade = { ...s.trade, ...patch };
  trade.giveN = Math.max(1, Math.min(9, trade.giveN));
  trade.getN = Math.max(1, Math.min(9, trade.getN));
  return { ...s, trade };
}

export function bankTrade(s) {
  if (!bankTradeOk(s)) return s;
  const g = clone(s);
  const p = g.cur;
  const { give, get } = g.trade;
  const ratio = harborRatio(g, p, give);
  g.players[p].res[give] -= ratio;g.bank[give]+=ratio;
  g.players[p].res[get] += 1;g.bank[get]--;
  log(g, `${player(g, p).name} traded ${ratio} ${RES_NAME[give]} for 1 ${RES_NAME[get]}.`);
  cancelUnaffordableBuild(g);
  return g;
}

export function canAcceptOffer(s, q) {
  const t = s.trade;
  return (
    Number.isInteger(q) && q>=0 && q<s.players.length && !s.paired && q !== s.cur &&
    tradeOpen(s) &&
    t.give !== t.get &&
    s.players[s.cur].res[t.give] >= t.giveN &&
    s.players[q].res[t.get] >= t.getN
  );
}

export function acceptOffer(s, q) {
  if (!canAcceptOffer(s, q)) return s;
  const g = clone(s);
  const { give, get, giveN, getN } = g.trade;
  const a = g.players[g.cur].res;
  const b = g.players[q].res;
  a[give] -= giveN;
  b[give] += giveN;
  b[get] -= getN;
  a[get] += getN;
  toast(g, `${player(g, q).name} accepted your offer.`);
  log(g, `${player(g, g.cur).name} traded with ${player(g, q).name}.`);
  cancelUnaffordableBuild(g);
  return g;
}

// All resource payments go back to the finite supply.
function payBank(g,p,cost){pay(g.players[p].res,cost);for(const r of Object.keys(cost)) g.bank[r]+=cost[r];}
export function handOwner(g){return g.mode==='discard'?g.discards[0].p:g.cur;}
export const mustDiscard=(g,p)=>g.mode==='discard'&&g.discards.some(d=>d.p===p);
// Everyone who must discard on a 7 can do so at the same time, in any order.
export function discardCards(s,cards,who=s.discards?.[0]?.p){
  if(s.mode!=='discard'||s.winner!==null||!validBasket(cards))return s;
  const i=s.discards.findIndex(d=>d.p===who);
  if(i<0)return s;
  const {p,n}=s.discards[i];
  if(totalCards(cards)!==n||!afford(s.players[p].res,cards))return s;
  const g=clone(s);payBank(g,p,cards);g.discards.splice(i,1);g.mode=g.discards.length?'discard':'robber';
  log(g,`${player(g, p).name} discarded ${n} cards.`,p);return g;
}
export function updateAwards(s){const g=clone(s);updateLongest(g);checkWin(g);return g;}
export function canBuild(g,kind){
  if(!['road','settlement','city'].includes(kind)||g.phase!=='main'||g.winner!==null||g.rolling||isBlocking(g))return false;
  if(piecesLeft(g,g.cur)[kind]<=0||!afford(g.players[g.cur].res,COST[kind]))return false;
  return kind==='road'?geo(g).edges.some(e=>canRoad(g,e.id,g.cur)):geo(g).verts.some(v=>kind==='city'?canCity(g,v.id,g.cur):canSettle(g,v.id,g.cur,false));
}
const validBasket=b=>!!b&&typeof b==='object'&&RES.every(r=>Number.isInteger(b[r])&&b[r]>=0)&&Object.keys(b).every(r=>RES.includes(r));
export function validExchange(give,get){return validBasket(give)&&validBasket(get)&&totalCards(give)>0&&totalCards(get)>0&&RES.every(r=>!(give[r]&&get[r]));}
export function proposeTrade(s,give,get){
  if(!tradeOpen(s)||s.paired||!validExchange(give,get)||!afford(s.players[s.cur].res,give))return s;
  const g=clone(s);g.offer={give:clone(give),get:clone(get),responses:{}};return g;
}
export function respondTrade(s,p,accept){
  if(!s.offer||!tradeOpen(s)||s.paired||!Number.isInteger(p)||p===s.cur||!s.players[p])return s;
  if(accept&&!afford(s.players[p].res,s.offer.get))return s;
  const g=clone(s);g.offer.responses[p]=accept?'accepted':'declined';return g;
}
export function counterTrade(s,p,give,get){
  if(!s.offer||!tradeOpen(s)||s.paired||!Number.isInteger(p)||p===s.cur||!s.players[p]||!validExchange(give,get)||!afford(s.players[p].res,get))return s;
  const g=clone(s);g.offer.responses[p]={give:clone(give),get:clone(get)};return g;
}
export function confirmTrade(s,p){
  if(!s.offer||!tradeOpen(s)||s.paired||!s.players[p]||p===s.cur)return s;
  const response=s.offer.responses[p];if(response!=='accepted'&&!(response&&typeof response==='object'))return s;
  const {give,get}=response==='accepted'?s.offer:response;
  if(!validExchange(give,get)||!afford(s.players[s.cur].res,give)||!afford(s.players[p].res,get))return s;
  const g=clone(s);
  for(const r of RES){g.players[g.cur].res[r]+=get[r]-give[r];g.players[p].res[r]+=give[r]-get[r];}
  g.offer=null;cancelUnaffordableBuild(g);log(g,`${player(g, g.cur).name} traded with ${player(g, p).name}.`);return g;
}
export function withdrawTrade(s){return s.offer?{...s,offer:null}:s;}
// Used before accepting browser saves: reject incompatible or damaged states.
export function validSavedGame(g){
  if(!g||g.schema!==2||![3,4,5,6].includes(g.playerCount)||!Array.isArray(g.players)||g.players.length!==g.playerCount)return false;
  const G=geo(g),cfg=configFor(g.playerCount);
  if(!Array.isArray(g.terrain)||!Array.isArray(g.numbers)||g.terrain.length!==G.hexes.length||g.numbers?.length!==G.hexes.length||!RES.every(r=>Number.isInteger(g.bank?.[r])&&g.bank[r]>=0&&g.bank[r]+g.players.reduce((n,p)=>n+(p.res?.[r]??NaN),0)===cfg.resourceCount))return false;
  if(!Array.isArray(g.deck)||!g.deck.every(c=>DEV_TYPES.includes(c))||!Array.isArray(g.roadList)||!Array.isArray(g.townList)||!Array.isArray(g.roadLens)||g.roadLens.length!==g.playerCount||!Array.isArray(g.log)||!Array.isArray(g.dice)||g.dice.length!==2)return false;
  if(!g.terrain.every(t=>Object.keys(TERRAIN_RES).includes(t))||!g.players.every(p=>validBasket(p.res)&&Array.isArray(p.dev)&&p.dev.every(c=>DEV_TYPES.includes(c.type)&&Number.isInteger(c.turn))))return false;
  if(g.phase==='setup'&&(!g.setup||!Array.isArray(g.setupOrder)))return false;
  if(g.winPoints!==undefined&&!WIN_CHOICES.includes(g.winPoints))return false;
  return Number.isInteger(g.cur)&&!!g.players[g.cur]&&['setup','roll','main'].includes(g.phase)&&g.roadList.every(e=>!!G.edges[e]&&!!g.players[g.roads[e]])&&g.townList.every(v=>!!G.verts[v]&&!!g.players[g.settlements[v]?.p]);
}

/* ---------- helpers for online seats ---------- */
/** The turn timer ran out for these seats; their moves were finished automatically. */
export function noteTimeout(s, seats) {
  const g = clone(s);
  const names = seats.map((p) => player(g, p).name).join(' and ');
  log(g, `${names} ran out of time.`, seats[0]);
  toast(g, `${names} ran out of time.`);
  return g;
}
export const vertexValue = (g, vid) => vertexScore(g, vid); // how productive a corner is
export const hexCorners = (g, hid) => geo(g).hexes[hid]?.verts || [];
/** A spectator took over an empty seat. */
export function noteTakeover(s, p, name) {
  const g = clone(s);
  const colour = PLAYERS[g.seats?.[p]?.color ?? p].name;
  log(g, `${name} takes over the ${colour} seat.`, p);
  toast(g, `${name} takes over the ${colour} seat.`);
  return g;
}
