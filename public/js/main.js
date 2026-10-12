// Online client. The server owns the game; this file connects to a room,
// sends your moves, and draws whatever the server says is true.
import * as R from './rules.js';
import { getGeometry } from './geometry.js';
import { render } from './view.js';

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

// A private id for this browser, so a refresh or dropped connection puts you back in your seat.
let token = store.get('hearthisle-token');
if (!/^[a-f0-9]{32}$/.test(token || '')) {
  token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  store.set('hearthisle-token', token);
}

const params = new URLSearchParams(location.search);
let roomCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;

const preview = R.createGame({ autoSetup: false, randomize: false }); // board shown behind the lobby
preview.toast = null;

let room = null;
let game = null;
let ws = null;
let retry = 0;
let wantConnection = !!roomCode;
const ui = {
  panel: null,
  status: roomCode ? 'connecting' : 'home',
  error: '',
  nameDraft: store.get('hearthisle-name') || '',
  codeDraft: '',
  copied: false,
  tradeTab: 'bank',
  give: R.emptyRes(),
  get: R.emptyRes(),
  discard: R.emptyRes(),
  counter: null,
  toastHidden: null,
};
const timers = {};

/* ---------- drawing ---------- */
function fitBoard() {
  const table = document.getElementById('table');
  const frame = document.getElementById('frame');
  const board = document.getElementById('board');
  const geo = getGeometry((game || preview).playerCount);
  const ratio = geo.width / geo.height;
  const pad = parseFloat(getComputedStyle(frame).paddingLeft) * 2;
  const w = Math.max(200, Math.min(table.clientWidth - pad - 4, (table.clientHeight - pad - 4) * ratio));
  board.style.width = `${w}px`;
  board.style.height = `${w / ratio}px`;
}
function draw() {
  let g = game || preview;
  if (g.toast && g.toast.id === ui.toastHidden) g = { ...g, toast: null };
  render(g, actions, ui, room);
  fitBoard();
}
new ResizeObserver(fitBoard).observe(document.getElementById('table'));

/* ---------- connection ---------- */
function connect() {
  wantConnection = true;
  ui.status = 'connecting';
  draw();
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    retry = 0;
    ws.send(JSON.stringify({ type: 'hello', room: roomCode, token, name: (ui.nameDraft || '').trim() || undefined }));
  });
  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'error') {
      ui.error = msg.message;
      if (msg.code === 'no-room') {
        wantConnection = false;
        roomCode = null;
        history.replaceState(null, '', '/');
      }
      ui.status = 'home';
      room = null;
      game = null;
      ws.close();
      draw();
      return;
    }
    if (msg.type !== 'room') return;
    const hadOffer = !!game?.offer;
    const oldToast = game?.toast?.id;
    room = msg.room;
    game = msg.game;
    ui.status = 'online';
    ui.error = '';
    roomCode = room.code;
    if (new URLSearchParams(location.search).get('room') !== room.code) history.replaceState(null, '', `/?room=${room.code}`);
    if (!ui.nameDraft && room.you) ui.nameDraft = room.you.name;
    if (hadOffer && !game?.offer) {
      ui.give = R.emptyRes();
      ui.get = R.emptyRes();
      ui.counter = null;
    }
    if (game?.mode !== 'discard') ui.discard = R.emptyRes();
    if (game?.toast && game.toast.id !== oldToast) {
      clearTimeout(timers.toast);
      const id = game.toast.id;
      timers.toast = setTimeout(() => { ui.toastHidden = id; draw(); }, 3200);
    }
    draw();
  });
  ws.addEventListener('close', () => {
    if (!wantConnection) return;
    ui.status = 'connecting';
    showNotice('Connection lost — reconnecting…');
    clearTimeout(timers.retry);
    timers.retry = setTimeout(connect, Math.min(8000, 600 * 2 ** retry++));
  });
}
function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function showNotice(text) {
  const n = document.getElementById('notice');
  if (n) n.textContent = text;
}
const act = (name) => (...args) => send({ type: 'action', name, args });

/* ---------- actions ---------- */
const actions = {
  ui(patch) {
    Object.assign(ui, patch);
    draw();
  },
  draft(patch) {
    // Typing shouldn't redraw on every key, except to enable buttons.
    Object.assign(ui, patch);
    draw();
  },
  createRoom() {
    store.set('hearthisle-name', ui.nameDraft.trim());
    roomCode = null;
    ui.error = '';
    connect();
  },
  joinRoom() {
    store.set('hearthisle-name', ui.nameDraft.trim());
    roomCode = ui.codeDraft.trim().toUpperCase();
    ui.error = '';
    connect();
  },
  leave() {
    wantConnection = false;
    ws?.close();
    room = null;
    game = null;
    roomCode = null;
    ui.panel = null;
    ui.status = 'home';
    history.replaceState(null, '', '/');
    draw();
  },
  saveName() {
    const name = ui.nameDraft.trim();
    if (!name) return;
    store.set('hearthisle-name', name);
    send({ type: 'setName', name });
  },
  async copyInvite() {
    const link = `${location.origin}/?room=${room?.code}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      prompt('Copy this link:', link);
    }
    ui.copied = true;
    draw();
    setTimeout(() => { ui.copied = false; draw(); }, 1800);
  },
  pickColor: (color) => send({ type: 'pickColor', color }),
  spectate: () => send({ type: 'spectate' }),
  setQuick: (quick) => send({ type: 'setOption', quick }),
  start: () => send({ type: 'start' }),
  backToLobby: (force) => {
    if (force && !confirm('End this game for everyone and go back to the lobby?')) return;
    ui.panel = null;
    send({ type: 'backToLobby', force });
  },

  roll: act('roll'),
  endTurn: act('endTurn'),
  cancelBuild: act('cancelBuild'),
  chooseBuild: act('chooseBuild'),
  placeAtVertex: act('placeAtVertex'),
  placeAtEdge: act('placeAtEdge'),
  moveRobber: act('moveRobber'),
  stealFrom: act('stealFrom'),
  buyDevCard: act('buyDevCard'),
  playDevCard: (type) => { ui.panel = null; send({ type: 'action', name: 'playDevCard', args: [type] }); },
  pickResource: act('pickResource'),
  discard: () => send({ type: 'action', name: 'discard', args: [ui.discard] }),
  setTrade: act('setTrade'),
  bankTrade: act('bankTrade'),
  propose: () => send({ type: 'action', name: 'propose', args: [ui.give, ui.get] }),
  respond: (_seat, accept) => send({ type: 'action', name: 'respond', args: [accept] }),
  confirm: act('confirm'),
  withdraw: act('withdraw'),
  counter: () => {
    send({ type: 'action', name: 'counter', args: [ui.give, ui.get] });
    ui.counter = null;
    draw();
  },
};

document.getElementById('menu').addEventListener('click', () => {
  if (room?.phase === 'game') actions.ui({ panel: ui.panel === 'menu' ? null : 'menu' });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('input')) {
    if (!room && ui.codeDraft.trim().length >= 4) actions.joinRoom();
    else if (!room && ui.nameDraft.trim()) actions.createRoom();
    else if (room) actions.saveName();
    return;
  }
  if (e.key !== 'Escape') return;
  if (ui.panel) actions.ui({ panel: null });
  else if (ui.counter !== null) actions.ui({ counter: null });
  else if (game) actions.cancelBuild();
});

if (wantConnection) connect();
else draw();
