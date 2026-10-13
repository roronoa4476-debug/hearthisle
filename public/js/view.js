// Renders the game from ONE seat's point of view (online-style): your hand,
// your buttons, everyone else's public info. Reads state, never changes it;
// clicks call actions from main.js.

import { getGeometry, pctX, pctY, pctW } from './geometry.js';
import * as R from './rules.js';
import { settlementArt, cityArt, roadArt, robberArt, playerMark } from './pieces.js';

const FACES = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const $ = (id) => document.getElementById(id);

/** Element builder using DOM APIs only (no innerHTML), so it works under a strict CSP. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
const btn = (text, onClick, props = {}) => h('button', { type: 'button', text, onClick, ...props });
const icon = (name, extra = '') => h('span', { class: `icon i-${name}${extra ? ` ${extra}` : ''}`, 'aria-hidden': 'true' });
let RESTORING = false; // true for a few seconds after a server restart
let G_NOW = null; // the game being drawn; seats carry each player's chosen name and colour
const who = (p) => R.player(G_NOW, p);
const mark = (p) => playerMark(who(p));
const name = (p) => who(p).name;
const count = (pl) => pl.cardCount ?? R.totalCards(pl.res);
const costIcons = (cost) => h('span', { class: 'cost' }, Object.entries(cost).flatMap(([r, n]) => Array.from({ length: n }, () => icon(r))));
const panelTitle = (title, extra) => h('h2', { class: 'panel-title' }, h('span', { text: title }), extra || null);

let GEO = getGeometry(4);
const at = (x, y, extra = {}) => ({ left: `${pctX(x, GEO)}%`, top: `${pctY(y, GEO)}%`, ...extra });

/* ---------- board ---------- */
const board = { key: null, tiles: [], tokens: [], roads: new Map(), towns: new Map() };

function buildBoard(g, root) {
  root.replaceChildren();
  board.roads.clear();
  board.towns.clear();
  const hexes = GEO.hexes;
  hexes.forEach((hx) => root.append(h('div', { class: 'surf', style: at(hx.x, hx.y) })));
  hexes.forEach((hx) => root.append(h('div', { class: 'shore', style: at(hx.x, hx.y) })));
  for (const hb of GEO.harbors) {
    for (const vid of hb.verts) {
      const v = GEO.verts[vid];
      const dx = v.x - hb.x;
      const dy = v.y - hb.y;
      const len = Math.hypot(dx, dy);
      const sx = hb.x + (dx / len) * 0.25;
      const sy = hb.y + (dy / len) * 0.25;
      const ex = v.x - (dx / len) * 0.12;
      const ey = v.y - (dy / len) * 0.12;
      root.append(h('div', { class: 'plank', style: at((sx + ex) / 2, (sy + ey) / 2, { width: `${pctW(Math.hypot(ex - sx, ey - sy), GEO)}%`, transform: `translate(-50%, -50%) rotate(${((Math.atan2(ey - sy, ex - sx) * 180) / Math.PI).toFixed(1)}deg)` }) }));
    }
  }
  for (const hb of GEO.harbors) {
    const any = hb.type === 'any';
    root.append(
      h('div', { class: 'harbor', style: at(hb.x, hb.y), role: 'img', 'aria-label': any ? '3 for 1 harbor, any resource' : `2 for 1 harbor, ${R.RES_NAME[hb.type]}` },
        any ? h('b', { text: '3:1' }) : icon(hb.type),
        any ? h('small', { text: 'any' }) : h('b', { text: '2:1' }),
      ),
    );
  }
  board.tiles = hexes.map((hx) => {
    const terrain = g.terrain[hx.id];
    const res = R.TERRAIN_RES[terrain];
    const n = g.numbers[hx.id];
    const tile = h('div', { class: 'tile', style: at(hx.x, hx.y), role: 'img', 'aria-label': `${R.TERRAIN_NAME[terrain]}${n ? `, number ${n}` : ''}` },
      h('div', { class: `tile-art t-${terrain}` }),
      res ? h('span', { class: `tile-badge i-${res}` }) : null,
    );
    root.append(tile);
    return tile;
  });
  board.tokens = hexes.map((hx) => {
    const n = g.numbers[hx.id];
    if (!n) return null;
    const token = h('div', { class: `token${n === 6 || n === 8 ? ' hot' : ''}`, style: at(hx.x, hx.y - 0.12), 'aria-hidden': 'true' },
      h('b', { text: n }),
      h('span', { class: 'pips' }, Array.from({ length: R.pips(n) }, () => h('i'))),
    );
    root.append(token);
    return token;
  });
  board.roadLayer = h('div', { class: 'layer' });
  board.townLayer = h('div', { class: 'layer' });
  board.robber = h('div', { class: 'robber', 'aria-hidden': 'true' }, robberArt());
  board.overlay = h('div', { class: 'layer' });
  root.append(board.roadLayer, board.townLayer, board.robber, board.overlay);
}

function renderBoard(g, a, me) {
  GEO = getGeometry(g.playerCount);
  const root = $('board');
  root.style.setProperty('--hex-w', `${(1.7320508 / GEO.width) * 100}%`);
  root.style.setProperty('--hex-h', `${(2 / GEO.height) * 100}%`);
  root.style.setProperty('--u', `${100 / GEO.width}cqw`);
  const key = `${g.playerCount}|${g.terrain.join()}|${g.numbers.join()}`;
  if (board.key !== key || g.roadList.length < board.roads.size || g.townList.length < board.towns.size) {
    buildBoard(g, root);
    board.key = key;
  }
  root.classList.toggle('picking', g.mode === 'robber' && me === g.cur);
  GEO.hexes.forEach((hx) => {
    board.tiles[hx.id].classList.toggle('prod', g.producing.includes(hx.id));
    board.tokens[hx.id]?.classList.toggle('blocked', g.robber === hx.id);
  });

  for (const eid of g.roadList) {
    if (board.roads.has(eid)) continue;
    const e = GEO.edges[eid];
    const p = g.roads[eid];
    const el = h('div', { class: 'road', role: 'img', 'aria-label': `${name(p)} road`, style: at(e.x, e.y, { transform: `translate(-50%, -50%) rotate(${e.angle.toFixed(1)}deg)` }) }, roadArt(who(p)));
    board.roads.set(eid, el);
    board.roadLayer.append(el);
  }
  for (const vid of g.townList) {
    const t = g.settlements[vid];
    const kind = t.city ? 'city' : 'settlement';
    let el = board.towns.get(vid);
    if (el && el.dataset.kind !== kind) {
      el.remove();
      el = null;
    }
    if (!el) {
      const v = GEO.verts[vid];
      el = h('div', { class: `piece ${kind}`, 'data-kind': kind, role: 'img', 'aria-label': `${name(t.p)} ${kind}`, style: at(v.x, v.y) }, t.city ? cityArt(who(t.p)) : settlementArt(who(t.p)));
      board.towns.set(vid, el);
      board.townLayer.append(el);
    }
  }
  const rh = GEO.hexes[g.robber];
  const pos = g.numbers[g.robber] ? at(rh.x + 0.5, rh.y + 0.42) : at(rh.x, rh.y + 0.35);
  board.robber.style.left = pos.left;
  board.robber.style.top = pos.top;

  // Only the seat whose turn it is gets clickable spots.
  const hits = [];
  if (me === g.cur) {
    const pc = who(g.cur).light ? '#8a6a3a' : who(g.cur).color;
    for (const eid of R.validEdges(g)) {
      const e = GEO.edges[eid];
      hits.push(h('button', { class: 'ehit', type: 'button', 'aria-label': 'Build a road here', style: at(e.x, e.y, { '--pc': pc, transform: `translate(-50%, -50%) rotate(${e.angle.toFixed(1)}deg)` }), onClick: () => a.placeAtEdge(eid) }));
    }
    for (const vid of R.validVertices(g)) {
      const v = GEO.verts[vid];
      hits.push(h('button', { class: 'vhit', type: 'button', 'aria-label': g.mode === 'city' ? 'Upgrade this settlement to a city' : 'Build a settlement here', style: at(v.x, v.y, { '--pc': pc }), onClick: () => a.placeAtVertex(vid) }));
    }
    for (const hid of R.robberTargets(g)) {
      const hx = GEO.hexes[hid];
      const n = g.numbers[hid];
      hits.push(h('button', { class: 'target', type: 'button', 'aria-label': `Move the robber to ${R.TERRAIN_NAME[g.terrain[hid]]}${n ? ` ${n}` : ''}`, style: at(hx.x, hx.y), onClick: () => a.moveRobber(hid) }));
    }
  }
  board.overlay.replaceChildren(...hits);
  $('notice').textContent = noticeFor(g, me);
}

// Notices are written for the acting player; other seats get a neutral version.
function noticeFor(g) {
  return g.toast?.text || '';
}

/* ---------- left column ---------- */
function renderPlayers(g, a, ui, me, room) {
  const members = room?.members || [];
  const bySeat = (p) => members.find((m) => m.seat === p);
  const rows = g.players.map((pl, p) => {
    const P = who(p);
    const member = bySeat(p);
    const visible = R.victoryPoints(g, p, false);
    const hidden = p === me ? R.victoryPoints(g, p, true) - visible : 0;
    const away = member && !member.connected;
    const empty = !!room?.vacant?.includes(p);
    const amHost = !!room?.you?.host;
    const awards = [g.longest === p && h('span', { class: 'award', text: `Longest Road · ${g.roadLens[p]}` }), g.army === p && h('span', { class: 'award', text: `Largest Army · ${pl.knights}` })].filter(Boolean);
    return h('div', {
      class: `player${g.cur === p ? ' current' : ''}${away ? ' away' : ''}`,
      style: { '--pc': P.light ? P.edge : P.color },
      role: 'listitem',
      'aria-label': `${P.name}: ${visible} points, ${count(pl)} resource cards, ${pl.dev.length} development cards${g.cur === p ? ', playing now' : ''}${p === me ? ', you' : ''}${away ? ', disconnected' : ''}`,
    },
      playerMark(P),
      h('span', { class: 'player-name', title: member?.host ? `${P.name} is hosting this room` : null }, h('span', { text: P.name }), p === me ? h('span', { class: 'tag you', text: 'You' }) : null, member?.bot ? h('span', { class: 'tag bot', text: 'Bot', title: 'A computer player' }) : null, away ? h('span', { class: 'tag away', text: 'Away' }) : null, empty ? h('span', { class: 'tag away', text: 'Autopilot', title: 'This player was removed. Their turns are played automatically.' }) : null),
      h('span', { class: 'vp', title: hidden ? `${visible} visible + ${hidden} hidden` : 'Victory points' }, h('b', { text: visible + hidden }), h('small', { text: 'VP' })),
      h('span', { class: 'player-stats' },
        h('span', { class: 'stat', title: 'Resource cards' }, h('i', { class: 'card-glyph' }), String(count(pl))),
        h('span', { class: 'stat', title: 'Unplayed development cards (types hidden)' }, icon('dev-back'), String(pl.dev.length)),
        h('span', { class: 'stat', title: 'Knights played' }, icon('knight'), String(pl.knights)),
        h('span', { class: 'stat', title: 'Longest road' }, icon('roads'), String(g.roadLens[p])),
      ),
      awards.length ? h('span', { class: 'awards' }, awards) : null,
      amHost && away && !member.host ? btn('Remove', () => a.remove(member.id, P.name, true), { class: 'seat-btn danger', 'aria-label': `Remove ${P.name} from the game` }) : null,
      empty && !room?.practice && me === null && g.winner === null ? btn('Take seat', () => a.takeSeat(p, P.name), { class: 'seat-btn', 'aria-label': `Take over ${P.name}’s seat` }) : null,
    );
  });
  const watchers = members.filter((m) => m.role === 'spectator' || m.seat < 0 && room?.phase === 'game');
  $('players').replaceChildren(
    panelTitle(room?.practice ? 'Practice' : 'Players', room ? h('small', { text: `Room ${room.code}` }) : null),
    h('div', { class: 'player-list', role: 'list' }, ...rows),
    ...(watchers.length ? [h('p', { class: 'watchers' }, h('span', { class: 'eye', 'aria-hidden': 'true' }), `Watching: ${watchers.map((m) => m.name + (m.connected ? '' : ' (away)')).join(', ')}`)] : []),
  );
}

function renderBank(g) {
  const low = (n) => n <= 3;
  $('bank').replaceChildren(
    panelTitle('Bank', h('small', { text: 'cards left' })),
    h('div', { class: 'bank-row' },
      ...R.RES.map((r) => h('div', { class: `stack${low(g.bank[r]) ? ' low' : ''}`, 'data-res': r, title: `${g.bank[r]} ${R.RES_NAME[r]} in the bank` }, h('span', { class: `mini-card r-${r}` }, icon(r)), h('b', { text: g.bank[r] }))),
      h('div', { class: 'stack', 'data-res': 'dev', title: `${g.deck.length} development cards left in the face-down deck`, 'aria-label': `Development deck: ${g.deck.length} cards left, types hidden` }, h('span', { class: 'mini-card dev' }, icon('dev-back')), h('b', { text: g.deck.length })),
    ),
  );
}

function renderLog(g) {
  $('log').replaceChildren(
    panelTitle('Recent moves'),
    h('ol', {}, ...g.log.slice(0, 14).map((e) => h('li', {}, h('i', { style: { 'background-color': e.color } }), h('span', { text: e.text })))),
  );
}

/* ---------- right column ---------- */
function waitingText(g, me) {
  if (g.winner !== null) return R.prompt(g);
  if (g.mode === 'discard') {
    const mine = g.discards.find((d) => d.p === me);
    if (mine) return `Choose ${mine.n} cards to return to the bank.`;
    return `Waiting for ${g.discards.map((d) => name(d.p)).join(' and ')} to discard.`;
  }
  if (g.offer && me !== g.cur) return `${name(g.cur)} is offering a trade — answer it in the trade panel.`;
  return `Waiting for ${name(g.cur)}…`;
}

function renderTurn(g, a, me) {
  const P = who(g.cur);
  const mine = me === g.cur && g.mode !== 'discard';
  const blocking = R.isBlocking(g);
  const sub = g.phase === 'setup' ? 'Opening placements' : g.playerCount > 4 ? `Turn ${g.turn} · ${g.paired ? 'Player 2 · actions, no roll' : 'Player 1 · roll + actions'}` : `Turn ${g.turn}`;
  const rollPhase = g.phase === 'roll' || g.phase === 'setup';
  const mainBtn = g.phase === 'roll'
    ? btn('Roll dice', a.roll, { class: 'btn', disabled: !mine || g.rolling || blocking || g.winner !== null })
    : btn(g.paired ? 'Finish turn' : 'End turn', a.endTurn, { class: 'btn red', disabled: !mine || g.phase !== 'main' || g.rolling || blocking || g.winner !== null });
  const extra = [];
  if (mine && g.mode === 'steal') extra.push(h('div', { class: 'choice-row' }, ...g.victims.map((q) => btn(`Take from ${name(q)}`, () => a.stealFrom(q), { class: 'btn small wood' }))));
  if (mine && !blocking && g.phase === 'main' && ['road', 'settlement', 'city'].includes(g.mode)) extra.push(btn('Cancel building (Esc)', a.cancelBuild, { class: 'linkish' }));
  $('turn').replaceChildren(
    h('div', { class: 'turn-head' }, playerMark(P), h('div', { class: 'turn-title' }, h('div', { class: 'turn-name', text: g.cur === me ? 'Your turn' : `${P.name}’s turn` }), h('div', { class: 'turn-sub', text: sub })), h('span', { id: 'turn-timer', class: 'timer', role: 'timer', 'aria-label': 'Time left this turn', hidden: true })),
    h('p', { class: `prompt well${mine && !RESTORING ? ' mine' : ''}`, text: RESTORING ? 'The server restarted. Restoring the game while everyone reconnects…' : mine ? R.prompt(g) : waitingText(g, me) }),
    h('div', { class: 'turn-row' },
      h('div', { class: `dice${g.rolling ? ' rolling' : ''}`, role: 'img', 'aria-label': `Dice show ${g.dice[0]} and ${g.dice[1]}` }, ...g.dice.map((n, i) => h('span', { class: `die${i ? ' red' : ''}` }, ...Array.from({ length: 9 }, (_, k) => h('i', { class: FACES[n].includes(k) ? 'on' : '' }))))),
      rollPhase && g.phase === 'setup' ? h('span', { class: 'muted', text: 'Place on the board' }) : mainBtn,
    ),
    ...extra,
  );
}

const describe = (b) => R.RES.filter((r) => b[r]).flatMap((r) => [h('b', { text: b[r] }), icon(r)]);

function basketChips(basket, onStep, limit, purpose = 'request') {
  const supply = R.configFor(G_NOW.playerCount).resourceCount;
  return h('div', { class: 'chips' },
    ...R.RES.map((r) => h('div', { class: 'chip counter' },
      icon(r),
      h('span', { class: `n${basket[r] ? '' : ' zero'}`, text: basket[r] }),
      h('span', { class: 'step' },
        h('button', { type: 'button', text: '−', 'aria-label': `Fewer ${R.RES_NAME[r]} to ${purpose}`, disabled: !basket[r], onClick: () => onStep(r, -1) }),
        h('button', { type: 'button', text: '+', 'aria-label': `More ${R.RES_NAME[r]} to ${purpose}`, disabled: basket[r] >= (limit ? limit[r] : supply), onClick: () => onStep(r, 1) }),
      ),
    )),
  );
}

function renderTrade(g, a, ui, me) {
  const mine = me === g.cur;
  const playersTab = ui.tradeTab === 'players' && !g.paired;
  const open = R.tradeOpen(g);
  const content = [
    panelTitle('Trade', h('small', { text: mine ? (open ? 'your turn' : 'after rolling') : `${name(g.cur)}’s turn` })),
    h('div', { class: 'tabs', role: 'tablist' },
      btn('Bank & harbors', () => a.ui({ tradeTab: 'bank' }), { class: `tab${playersTab ? '' : ' active'}`, role: 'tab', 'aria-selected': String(!playersTab) }),
      btn(g.offer && !mine ? 'Players •' : 'Players', () => a.ui({ tradeTab: 'players' }), { class: `tab${playersTab ? ' active' : ''}`, role: 'tab', 'aria-selected': String(playersTab), disabled: g.paired }),
    ),
  ];
  if (!playersTab) {
    const t = ui.bank;
    const ratio = R.harborRatio(g, me ?? g.cur, t.give);
    content.push(
      h('div', { class: 'row-label' }, h('span', { text: 'You give' }), h('span', { text: 'rate' })),
      h('div', { class: 'chips' }, ...R.RES.map((r) => h('button', { type: 'button', class: `chip${t.give === r ? ' active' : ''}`, 'aria-pressed': String(t.give === r), 'aria-label': `Give ${R.RES_NAME[r]} at ${R.harborRatio(g, me ?? g.cur, r)} for 1`, disabled: !mine, onClick: () => a.pickBankTrade({ give: r }) }, icon(r), h('span', { text: `${R.harborRatio(g, me ?? g.cur, r)}:1` })))),
      h('div', { class: 'row-label' }, h('span', { text: 'You get' }), h('span', { text: 'in bank' })),
      h('div', { class: 'chips' }, ...R.RES.map((r) => h('button', { type: 'button', class: `chip${t.get === r ? ' active' : ''}`, 'aria-pressed': String(t.get === r), 'aria-label': `Get ${R.RES_NAME[r]}, ${g.bank[r]} in the bank`, disabled: !mine, onClick: () => a.pickBankTrade({ get: r }) }, icon(r), h('span', { text: g.bank[r] })))),
      h('div', { class: 'summary' },
        h('p', { text: t.give === t.get ? 'Pick two different resources.' : `${ratio} ${R.RES_NAME[t.give]} → 1 ${R.RES_NAME[t.get]}` }),
        btn('Trade', a.bankTrade, { class: 'btn small', disabled: !mine || !R.bankTradeOk(g, t) }),
      ),
    );
  } else if (g.offer) {
    const o = g.offer;
    if (mine) {
      content.push(h('div', { class: 'offer well' },
        h('div', { class: 'offer-line' }, h('span', { text: 'You give' }), ...describe(o.give), h('span', { class: 'arrow', text: '→' }), h('span', { text: 'get' }), ...describe(o.get)),
        h('div', { class: 'responses' }, ...g.players.flatMap((_, p) => {
          if (p === g.cur) return [];
          const r = o.responses[p];
          const counter = r && typeof r === 'object';
          const state = counter ? h('span', { class: 'state ok' }, 'Counter: ', ...describe(r.give), ' → ', ...describe(r.get)) : h('span', { class: `state${r === 'accepted' ? ' ok' : r === 'declined' ? ' no' : ''}`, text: r === 'accepted' ? 'Accepted' : r === 'declined' ? 'Declined' : 'Thinking…' });
          return [h('div', { class: 'response' }, mark(p), h('span', { class: 'who', text: name(p) }), state, r === 'accepted' || counter ? btn('Trade', () => a.confirm(p), { class: 'btn small' }) : null)];
        })),
        btn('Withdraw offer', a.withdraw, { class: 'linkish' }),
      ));
    } else if (me === null) {
      content.push(h('div', { class: 'offer well' }, h('div', { class: 'offer-line' }, mark(g.cur), h('b', { text: `${name(g.cur)} offers` })), h('div', { class: 'offer-line' }, h('span', { text: 'Gives' }), ...describe(o.give), h('span', { class: 'arrow', text: '→' }), h('span', { text: 'wants' }), ...describe(o.get))));
    } else if (ui.counter === me) {
      content.push(
        h('div', { class: 'row-label' }, h('span', { text: `You give ${name(g.cur)}` })),
        basketChips(ui.get, (r, d) => a.ui({ get: { ...ui.get, [r]: Math.max(0, ui.get[r] + d) } }), g.players[me].res, 'give'),
        h('div', { class: 'row-label' }, h('span', { text: 'You get' })),
        basketChips(ui.give, (r, d) => a.ui({ give: { ...ui.give, [r]: Math.max(0, ui.give[r] + d) } })),
        h('div', { class: 'summary' }, btn('Cancel', () => a.ui({ counter: null }), { class: 'linkish' }), btn('Send counter', () => a.counter(me), { class: 'btn small', disabled: !R.validExchange(ui.give, ui.get) || !R.afford(g.players[me].res, ui.get) })),
      );
    } else {
      const r = o.responses[me];
      content.push(h('div', { class: 'offer well' },
        h('div', { class: 'offer-line' }, mark(g.cur), h('b', { text: `${name(g.cur)} offers` })),
        h('div', { class: 'offer-line' }, h('span', { text: 'You get' }), ...describe(o.give)),
        h('div', { class: 'offer-line' }, h('span', { text: 'You give' }), ...describe(o.get)),
        r ? h('p', { class: 'muted', text: r === 'accepted' ? 'You accepted. Waiting for them to confirm.' : r === 'declined' ? 'You declined.' : 'You sent a counteroffer.' }) : null,
        h('div', { class: 'choice-row' },
          btn('Accept', () => a.respond(me, true), { class: 'btn small', disabled: !R.afford(g.players[me].res, o.get) }),
          btn('Decline', () => a.respond(me, false), { class: 'btn small red' }),
          btn('Counter', () => a.ui({ counter: me, give: { ...o.give }, get: { ...o.get } }), { class: 'btn small wood' }),
        ),
      ));
    }
  } else if (mine && open) {
    content.push(
      h('div', { class: 'row-label' }, h('span', { text: 'You give' })),
      basketChips(ui.give, (r, d) => a.ui({ give: { ...ui.give, [r]: Math.max(0, ui.give[r] + d) } }), g.players[me].res, 'give'),
      h('div', { class: 'row-label' }, h('span', { text: 'You want' })),
      basketChips(ui.get, (r, d) => a.ui({ get: { ...ui.get, [r]: Math.max(0, ui.get[r] + d) } })),
      h('div', { class: 'summary' }, h('p', { class: 'muted', text: 'Everyone sees your offer.' }), btn('Offer', a.propose, { class: 'btn small', disabled: !R.validExchange(ui.give, ui.get) || !R.afford(g.players[me].res, ui.give) })),
    );
  } else {
    content.push(h('p', { class: 'muted well', style: { padding: '10px' }, text: mine ? 'Roll the dice first, then you can offer trades.' : `When ${name(g.cur)} offers a trade, it appears here for you to accept, decline or counter.` }));
  }
  $('trade').replaceChildren(...content);
}

function renderDevs(g, a, ui, me) {
  if (me === null) {
    $('devs').replaceChildren(panelTitle('Development cards', h('small', { text: `${g.deck.length} in deck` })), h('p', { class: 'muted', text: 'You are watching this game. Players’ cards stay hidden.' }));
    return;
  }
  const pl = g.players[me];
  const mine = me === g.cur;
  const owned = R.DEV_TYPES.filter((type) => pl.dev.some((c) => c.type === type));
  const cards = owned.map((type) => {
    const list = pl.dev.filter((c) => c.type === type);
    const playable = mine && R.canPlayDev(g, type);
    const note = type === 'vp' ? 'Hidden point' : !mine ? 'On your turn' : list.every((c) => c.turn >= g.turn) ? 'Next turn' : g.devPlayed ? 'One per turn' : 'Not now';
    return h('article', { class: `dev-card${type === 'vp' ? ' dev-vp' : ''}`, 'data-dev': type, 'aria-label': R.DEV_NAME[type] },
      h('div', { class: 'dev-art' }, icon(type)),
      h('div', { class: 'dev-copy' },
        h('h3', { class: 'dev-name' }, R.DEV_NAME[type], h('span', { class: 'dev-count', text: `×${list.length}`, 'aria-label': `${list.length} ${list.length === 1 ? 'card' : 'cards'}` })),
        h('p', { class: 'dev-description', text: R.DEV_TEXT[type] }),
      ),
      h('div', { class: 'dev-action' }, playable ? btn('Play', () => a.playDevCard(type), { class: 'btn small', 'aria-label': `Play ${R.DEV_NAME[type]}` }) : h('small', { text: note })),
    );
  });
  const canBuy = mine && R.tradeOpen(g) && g.deck.length > 0 && R.afford(pl.res, R.COST.dev);
  $('devs').replaceChildren(
    panelTitle('Development cards', h('small', { text: `${g.deck.length} in deck` })),
    h('div', { class: 'buy' }, btn('Buy a card', a.buyDevCard, { class: 'btn small wood', disabled: !canBuy, title: `Costs ${R.costText(R.COST.dev)}` }), costIcons(R.COST.dev)),
    cards.length ? h('div', { class: 'dev-list' }, cards) : h('p', { class: 'muted', text: 'No development cards yet. Buy one to draw a random card.' }),
  );
}

/* ---------- dock ---------- */
function renderDock(g, a, me) {
  if (me === null) {
    $('hand').replaceChildren(h('div', { class: 'spectating' }, h('span', { class: 'eye big', 'aria-hidden': 'true' }), h('div', {}, h('b', { text: 'You’re watching' }), h('p', { class: 'muted', text: 'You can see the board, trades and everyone’s public info. Hands stay hidden.' }))));
    $('builds').replaceChildren();
    return;
  }
  const P = who(me);
  const pl = g.players[me];
  const mine = me === g.cur;
  const picking = mine && (g.mode === 'plenty' || g.mode === 'monopoly');
  $('hand').replaceChildren(
    h('div', { class: 'hand-head' }, playerMark(P), h('span', { text: picking ? (g.mode === 'plenty' ? `Pick ${g.plentyLeft} from the bank` : 'Pick a resource to claim') : 'Your hand' }), h('small', { text: `${count(pl)} cards` })),
    h('div', { class: 'cards' },
      ...R.RES.map((r) => {
        const n = pl.res[r];
        const pickable = picking && !(g.mode === 'plenty' && g.bank[r] <= 0);
        return h('button', {
          type: 'button',
          class: `rcard r-${r}${n || picking ? '' : ' zero'}${pickable ? ' pick' : ''}`,
          disabled: !pickable,
          'aria-label': pickable ? `Choose ${R.RES_NAME[r]}` : `${n} ${R.RES_NAME[r]}`,
          onClick: () => a.pickResource(r),
        },
          h('span', { class: 'rcard-top' }, icon(r)),
          h('span', { class: 'rcard-name', text: R.RES_NAME[r] }),
          h('span', { class: 'rcard-n', text: n }),
        );
      }),
    ),
  );
  const left = R.piecesLeft(g, me);
  const art = { road: roadArt, settlement: settlementArt, city: cityArt };
  $('builds').replaceChildren(
    ...['road', 'settlement', 'city'].map((kind) =>
      h('button', {
        type: 'button',
        class: `build${g.mode === kind && mine ? ' selected' : ''}`,
        disabled: !mine || (!R.canBuild(g, kind) && g.mode !== kind),
        'aria-pressed': String(g.mode === kind && mine),
        'aria-label': `Build a ${kind}: costs ${R.costText(R.COST[kind])}, ${left[kind]} left`,
        onClick: () => a.chooseBuild(kind),
      },
        h('span', { class: `build-art ${kind}` }, art[kind](P)),
        h('b', { text: R.BUILD_NAME[kind] }),
        costIcons(R.COST[kind]),
        h('small', { text: `${left[kind]} left` }),
      ),
    ),
  );
}

/* ---------- dialogs ---------- */
function modal(title, content, a, closable = true) {
  return h('div', { class: 'shade' },
    h('section', { class: 'modal oak', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', { text: title }), closable ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '×', onClick: () => a.ui({ panel: null }) }) : null),
      ...content,
    ),
  );
}

const inviteLink = (room) => `${location.origin}/?room=${room.code}`;

function nameField(ui, a, label = 'Your name') {
  return h('label', { class: 'field' },
    h('span', { text: label }),
    h('input', { type: 'text', maxlength: '20', autocomplete: 'nickname', 'aria-label': label, value: ui.nameDraft ?? '', placeholder: 'e.g. Nightmare', onInput: (e) => a.draft({ nameDraft: e.target.value }) }),
  );
}

function homeModal(a, ui) {
  return modal('Play with friends', [
    h('p', { text: 'Make a room, then send the link to your friends. Everyone plays from their own computer.' }),
    nameField(ui, a),
    btn('Create a room', a.createRoom, { class: 'btn wide', disabled: !(ui.nameDraft || '').trim() }),
    btn('Play solo against bots', a.playSolo, { class: 'btn wood wide', disabled: !(ui.nameDraft || '').trim() }),
    h('div', { class: 'divider-text' }, h('span', { text: 'or join one' })),
    h('div', { class: 'join-row' },
      h('input', { type: 'text', maxlength: '6', 'aria-label': 'Room code', placeholder: 'Room code', value: ui.codeDraft ?? '', autocapitalize: 'characters', onInput: (e) => a.draft({ codeDraft: e.target.value.toUpperCase() }) }),
      btn('Join', a.joinRoom, { class: 'btn wood', disabled: !(ui.nameDraft || '').trim() || (ui.codeDraft || '').trim().length < 4 }),
    ),
    ui.error ? h('p', { class: 'error', text: ui.error }) : null,
  ], a, false);
}

function lobbyModal(a, ui, room) {
  const you = room.you;
  const seatedCount = room.members.filter((m) => m.role === 'player').length;
  const watching = room.members.filter((m) => m.role === 'spectator');
  const host = room.members.find((m) => m.host);
  const colorButtons = R.PLAYERS.map((P, c) => {
    const owner = room.members.find((m) => m.role === 'player' && m.color === c);
    const mine = owner && owner.id === you.id;
    const person = owner && !mine && !owner.bot; // a bot's colour can still be picked; the bot moves
    return h('button', {
      type: 'button',
      class: `color-pick${mine ? ' mine' : ''}${person ? ' taken' : ''}${owner?.bot ? ' bot' : ''}`,
      style: { '--pc': P.light ? P.edge : P.color },
      disabled: person,
      'aria-pressed': String(!!mine),
      'aria-label': owner ? (mine ? `${P.name}: your colour` : owner.bot ? `Play as ${P.name} (${owner.name} the bot moves to another colour)` : `${P.name}: taken by ${owner.name}`) : `Play as ${P.name}`,
      onClick: () => a.pickColor(c),
    },
      playerMark(P, 30),
      h('span', { class: 'color-name', text: P.name }),
      h('small', { text: owner ? (mine ? 'You' : owner.bot ? `${owner.name} · bot` : owner.name) : 'Free' }),
    );
  });
  return modal(`Room ${room.code}`, [
    h('div', { class: 'invite well' },
      h('div', {}, h('small', { text: 'Invite friends with this link' }), h('b', { class: 'invite-link', text: inviteLink(room) })),
      btn(ui.copied ? 'Copied!' : 'Copy link', a.copyInvite, { class: 'btn small wood' }),
    ),
    h('div', { class: 'name-row' }, nameField(ui, a), btn('Save', a.saveName, { class: 'btn small wood', disabled: !(ui.nameDraft || '').trim() || ui.nameDraft.trim() === you.name })),
    h('div', { class: 'section-head' },
      h('h3', { text: 'Pick your colour' }),
      you.host ? btn('+ Add a bot', a.addBot, { class: 'btn small wood', disabled: seatedCount >= 6, title: 'Add a computer player on a free colour' }) : null,
    ),
    h('div', { class: 'color-grid' }, ...colorButtons),
    h('div', { class: 'spectate-row' },
      btn(you.role === 'spectator' ? 'You’re watching' : 'Just watch (spectate)', a.spectate, { class: `option${you.role === 'spectator' ? ' active' : ''}`, 'aria-pressed': String(you.role === 'spectator') }),
      watching.length ? h('small', { text: `Watching: ${watching.map((m) => m.name).join(', ')}` }) : null,
    ),
    you.host && room.members.length > 1
      ? h('div', { class: 'people' },
          h('small', { text: 'In the room' }),
          ...room.members.filter((m) => m.id !== you.id).map((m) =>
            h('span', { class: `person${m.connected ? '' : ' away'}` }, m.name, btn('×', () => a.remove(m.id, m.name), { class: 'remove', 'aria-label': `Remove ${m.name} from the room`, title: `Remove ${m.name}` })),
          ),
        )
      : null,
    you.host
      ? h('div', { class: 'host-box' },
          h('h3', { text: 'Opening settlements' }),
          h('div', { class: 'option-grid two' },
            btn('Place them yourselves', () => a.setQuick(false), { class: `option${room.options.quick ? '' : ' active'}` }),
            btn('Quick start', () => a.setQuick(true), { class: `option${room.options.quick ? ' active' : ''}` }),
          ),
          gameOptions(a, room.options),
          btn(seatedCount < 3 ? `Need ${3 - seatedCount} more player${3 - seatedCount > 1 ? 's' : ''}` : `Start game · ${seatedCount} players`, a.start, { class: 'btn wide', disabled: seatedCount < 3 || seatedCount > 6 }),
        )
      : h('div', {},
          h('p', { class: 'muted center', text: `${seatedCount} of 6 seats taken. Waiting for ${host ? host.name : 'the host'} to start…` }),
          h('p', { class: 'muted center', text: optionSummary(room.options) }),
        ),
  ], a, false);
}

const TIMER_LABEL = { 0: 'Off', 60: '1 min', 90: '1½ min', 120: '2 min' };
function optionSummary(o) {
  return [`${o.winPoints || 10} points to win`, o.balanced ? 'balanced map' : 'random map', o.friendlyRobber ? 'friendly robber' : null, o.turnTimer ? `${TIMER_LABEL[o.turnTimer]} turns` : null].filter(Boolean).join(' · ');
}

/** Host-only rule choices, shown as rows of segmented buttons. */
function gameOptions(a, o) {
  const row = (label, hint, choices, key) => h('div', { class: 'opt-row' },
    h('div', { class: 'opt-label' }, h('b', { text: label }), hint ? h('small', { text: hint }) : null),
    h('div', { class: 'seg', role: 'group', 'aria-label': label },
      ...choices.map(([value, text]) => btn(text, () => a.setOption({ [key]: value }), { class: `seg-btn${o[key] === value ? ' active' : ''}`, 'aria-pressed': String(o[key] === value), 'aria-label': `${label}: ${text}` })),
    ),
  );
  return h('div', { class: 'opt-list' },
    h('h3', { text: 'Game options' }),
    row('Points to win', null, R.WIN_CHOICES.map((n) => [n, String(n)]), 'winPoints'),
    row('Map', 'Balanced spreads out the 6s, 8s and terrain', [[false, 'Random'], [true, 'Balanced']], 'balanced'),
    row('Friendly robber', 'Can’t rob players with 2 points or fewer', [[false, 'Off'], [true, 'On']], 'friendlyRobber'),
    row('Turn timer', 'When time runs out, the turn ends', Object.entries(TIMER_LABEL).map(([k, v]) => [Number(k), v]), 'turnTimer'),
  );
}

function renderModal(g, a, ui, me, room) {
  let el = null;
  if (!room && ui.status === 'name' && ui.inviteCode) {
    el = modal(`Join room ${ui.inviteCode}`, [
      h('p', { text: 'You’ve been invited to a game of Koolkatan. What should the others call you?' }),
      nameField(ui, a),
      btn('Join the game', a.joinRoom, { class: 'btn wide', disabled: !(ui.nameDraft || '').trim() }),
    ], a, false);
  } else if (!room) {
    el = ui.status === 'connecting' ? modal('Connecting…', [h('p', { class: 'muted', text: 'Waking up the table. On a free server this can take up to a minute.' })], a, false) : homeModal(a, ui);
  } else if (room.phase === 'lobby') {
    el = lobbyModal(a, ui, room);
  } else if (g.winner !== null) {
    el = modal(g.winner === me ? 'You win!' : `${name(g.winner)} wins!`, [
      h('div', { class: 'winner-art' }, mark(g.winner)),
      h('p', { text: `${R.victoryPoints(g, g.winner, true)} victory points, including ${g.players[g.winner].dev.filter((c) => c.type === 'vp').length} hidden point cards.` }),
      room.practice
        ? (room.you?.host ? btn('New practice island', a.practiceReset, { class: 'btn wide' }) : null)
        : room.you?.host
          ? h('div', { class: 'winner-actions' },
              btn('Rematch · same players', a.rematch, { class: 'btn wide' }),
              btn('Back to the lobby', () => a.backToLobby(false), { class: 'btn wood wide' }),
            )
          : h('p', { class: 'muted center', text: 'Waiting for the host to start a rematch or go back to the lobby.' }),
    ], a, false);
  } else if (me !== null && R.mustDiscard(g, me)) {
    const need = g.discards.find((d) => d.p === me).n;
    el = modal('Return cards to the bank', [
      h('p', { text: `A 7 was rolled and you hold more than 7 cards. Choose exactly ${need} to return.` }),
      basketChips(ui.discard, (r, d) => a.ui({ discard: { ...ui.discard, [r]: Math.max(0, ui.discard[r] + d) } }), g.players[me].res, 'discard'),
      h('p', { class: 'muted', text: `Selected ${R.totalCards(ui.discard)} of ${need}` }),
      btn('Return these cards', a.discard, { class: 'btn wide', disabled: R.totalCards(ui.discard) !== need }),
    ], a, false);
  } else if (ui.panel === 'menu') {
    el = modal('Menu', [
      h('div', { class: 'invite well' }, h('div', {}, h('small', { text: `Room ${room.code}` }), h('b', { class: 'invite-link', text: inviteLink(room) })), btn(ui.copied ? 'Copied!' : 'Copy link', a.copyInvite, { class: 'btn small wood' })),
      btn('How to play', () => a.ui({ panel: 'help' }), { class: 'btn wood wide' }),
      btn('Full move history', a.showHistory, { class: 'btn wood wide' }),
      ...(room.practice ? [h('p', { text: 'Solo practice: the two opponents pass automatically. Normal building, dice and card rules still apply. Refill sets your resources to 12 of each and theirs to 3 of each.' }),
        ...(room.you?.host ? [btn('Refill practice resources', a.practiceRefill, { class: 'btn wood wide', disabled: !R.tradeOpen(g) || !!g.offer }), btn('New practice island', a.practiceReset, { class: 'btn wood wide' })] : []),
      ] : []),
      room.you?.host && !room.practice ? btn('End this game and return to the lobby', () => a.backToLobby(true), { class: 'btn red wide' }) : null,
      btn('Leave the room', a.leave, { class: 'linkish' }),
    ], a);
  } else if (ui.panel === 'help') {
    el = modal('How to play', [
      h('p', { text: '1. Each player places two settlements and two roads. Your second settlement gives you starting resources.' }),
      h('p', { text: '2. On your turn, roll the dice. Every tile with that number pays its neighbours: 1 card per settlement, 2 per city. The robber blocks its tile.' }),
      h('p', { text: '3. Spend cards to build (costs are under each build button), trade with the bank or other players, and buy development cards.' }),
      h('p', { text: '4. On a 7, anyone with more than 7 cards returns half. Then move the robber and take a card from a neighbour.' }),
      h('p', { text: `5. First to ${R.winTarget(g)} victory points on their own turn wins. Longest Road and Largest Army are worth 2 each.` }),
      g.friendlyRobber ? h('p', { text: 'Friendly robber is on: the robber can’t be placed next to, or steal from, a player with 2 points or fewer.' }) : null,
      ...(g.playerCount > 4 ? [
        h('p', { text: '5–6 players use paired turns. Player 1 rolls, resolves production or a 7, then builds, trades and may play one development card.' }),
        h('p', { text: 'Player 2 is the third player clockwise from Player 1. After Player 1 finishes, Player 2 takes an action phase without rolling: build, trade with the bank or harbors, and play one development card. Player 2 cannot trade with other players.' }),
        h('p', { text: 'Then Player 1 moves one seat clockwise and their paired Player 2 moves with them. Development cards bought as Player 1 may be played on your later turn as Player 2, and vice versa. Either player wins immediately upon reaching the target points during their turn.' }),
      ] : []),
    ], a);
  } else if (ui.panel === 'history') {
    // recent moves show at once; the full list fills in when it arrives (newer moves on top)
    const list = ui.history ? [...g.log.filter((e) => e.id > (ui.history[0]?.id ?? -1)), ...ui.history] : g.log;
    el = modal('Move history', [
      h('ol', { class: 'history' }, ...list.map((e) => h('li', { text: e.text }))),
      !ui.history && (g.logCount || 0) > g.log.length ? h('p', { class: 'muted', text: 'Loading earlier moves…' }) : null,
    ], a);
  }
  // Redrawing replaces the dialog, so keep its scroll position when it is the same dialog.
  const root = $('modal-root');
  const old = root.firstElementChild;
  const same = el && old && old.querySelector?.('[role=dialog]')?.getAttribute('aria-label') === el.querySelector?.('[role=dialog]')?.getAttribute('aria-label');
  const scroll = same ? [old.scrollTop, old.querySelector('.modal')?.scrollTop] : null;
  root.replaceChildren(...(el ? [el] : []));
  if (scroll) {
    el.scrollTop = scroll[0];
    const box = el.querySelector('.modal');
    if (box) box.scrollTop = scroll[1];
  }
  // The header (sound and menu buttons) stays usable while a dialog is open.
  for (const id of ['players', 'bank', 'log', 'right', 'table', 'dock']) $(id).inert = !!el;
}

export function render(g, a, ui, room) {
  G_NOW = g;
  RESTORING = !!room?.restoring;
  const me = room?.you && room.you.seat >= 0 ? room.you.seat : null;
  const active = document.activeElement;
  const focused = active?.getAttribute('aria-label');
  const caret = active?.tagName === 'INPUT' ? active.selectionStart : null;
  renderBoard(g, a, me);
  renderPlayers(g, a, ui, me, room);
  renderBank(g);
  renderLog(g);
  renderTurn(g, a, me);
  renderTrade(g, a, ui, me);
  renderDevs(g, a, ui, me);
  renderDock(g, a, me);
  renderModal(g, a, ui, me, room);
  if (focused) {
    const target = [...document.querySelectorAll('button[aria-label], input[aria-label]')].find((e) => e.getAttribute('aria-label') === focused && !e.disabled);
    target?.focus({ preventScroll: true });
    if (target && caret !== null) target.setSelectionRange(caret, caret);
  }
  const dialog = document.querySelector('[role=dialog]');
  if (dialog && !dialog.contains(document.activeElement)) dialog.querySelector('input, button:not(:disabled)')?.focus({ preventScroll: true });
}
