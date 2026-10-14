// Online client. The server owns the game; this file connects to a room,
// sends your moves, and draws whatever the server says is true.
import * as R from './rules.js';
import { getGeometry } from './geometry.js';
import { render } from './view.js';
import { createMapView } from './map-view.js';
import { createSound } from './sound.js';
import { createEffects, freshEvents, shownPoints } from './effects.js';
import { reattach } from './fx.js';
import { predict } from './predict.js';

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
let practiceRequest = false;
let soloRequest = false;
let syncNext = true; // the first update after (re)connecting is old news: no animations or sounds
let eventsSeen = 0; // newest event id the server has shown us
let serverGame = null; // the last table the server sent (a predicted move may be shown on top)
const predicted = []; // events already animated for predicted moves: { sig, at }
const signature = ({ id, ...rest }) => JSON.stringify(rest);
/** Drop events whose animation already played when the move was predicted (each match once). */
function unplayed(events) {
  const now = Date.now();
  for (let i = predicted.length - 1; i >= 0; i--) if (now - predicted[i].at > 5000) predicted.splice(i, 1);
  return events.filter((e) => {
    const i = predicted.findIndex((p) => p.sig === signature(e));
    if (i < 0) return true;
    predicted.splice(i, 1);
    return false;
  });
}
const savedName = (store.get('hearthisle-name') || '').trim();
// Opening an invite link asks for your name first (unless this browser already knows it).
let wantConnection = !!roomCode && !!savedName;
const ui = {
  panel: null,
  status: roomCode ? (savedName ? 'connecting' : 'name') : 'home',
  inviteCode: roomCode,
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
  deadline: null, // local time when the current turn timer runs out
  bank: { give: 'wheat', get: 'ore' }, // the bank trade being prepared
  history: null, // the full move list, fetched when the history panel opens
};
const sound = createSound({ muted: store.get('hearthisle-muted') === '1' });
const effects = createEffects({ sound, seat: () => mySeat(), game: () => game || preview });
globalThis.koolkatanFx = () => effects.stats; // in the browser console: are the animations keeping up?
const timers = {};

/* ---------- drawing ---------- */
const mapView = createMapView({
  table: document.getElementById('table'),
  frame: document.getElementById('frame'),
  viewport: document.getElementById('map-viewport'),
  board: document.getElementById('board'),
  zoomIn: document.getElementById('map-zoom-in'),
  zoomOut: document.getElementById('map-zoom-out'),
  reset: document.getElementById('map-reset'),
  label: document.getElementById('map-zoom-label'),
});
// Fitting the map measures the page, which is slow right after a redraw, so it
// happens only when the table is resized or a different board is shown.
let fittedKey = null;
function fitBoard(force = true) {
  const g = game || preview;
  const key = `${room?.code || 'preview'}|${room?.phase || 'home'}|${g.playerCount}`;
  if (!force && key === fittedKey) return;
  fittedKey = key;
  const geo = getGeometry(g.playerCount);
  mapView.resize(geo.width / geo.height, key);
}
function draw() {
  let g = game || preview;
  if (g.toast && g.toast.id === ui.toastHidden) g = { ...g, toast: null };
  ui.timer = timerFace();
  render(g, actions, ui, room);
  fitBoard(false);
  reattach(); // keep running card/row animations going on the redrawn elements
}
new ResizeObserver(() => fitBoard()).observe(document.getElementById('table'));

/* ---------- connection ---------- */
function connect() {
  clearTimeout(timers.retry);
  wantConnection = true;
  ui.status = 'connecting';
  draw();
  const previous = ws;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = socket;
  previous?.close();
  socket.addEventListener('open', () => {
    if (socket !== ws) return;
    syncNext = true;
    const snapshot = roomCode ? store.get(`hearthisle-snap-${roomCode}`) : null;
    socket.send(JSON.stringify({ type: 'hello', room: roomCode, token, name: (ui.nameDraft || '').trim() || undefined, practice: practiceRequest && !roomCode, solo: soloRequest && !roomCode, snapshot: snapshot || undefined }));
  });
  socket.addEventListener('message', (event) => {
    if (socket !== ws) return;
    clearTimeout(timers.alive); // the connection answered
    try {
      onMessage(event);
    } catch (err) {
      console.error(err);
    }
  });
  const onMessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'error') {
      ui.error = msg.message;
      practiceRequest = false;
      soloRequest = false;
      // A rejected join needs a new choice from the player, not a retry loop.
      wantConnection = false;
      clearTimeout(timers.retry);
      ui.inviteCode = null;
      roomCode = null;
      history.replaceState(null, '', '/');
      ui.status = 'home';
      room = null;
      game = null;
      setBusy(false);
      socket.close();
      draw();
      return;
    }
    if (msg.type === 'backup') {
      saveBackup(msg.code, msg.snapshot, msg.version);
      return;
    }
    if (msg.type === 'history') {
      ui.history = Array.isArray(msg.log) ? msg.log : [];
      draw();
      return;
    }
    if (msg.type !== 'room') return;
    retry = 0;
    ui.inviteCode = null;
    setBusy(false);
    const hadOffer = !!game?.offer;
    const oldToast = game?.toast?.id;
    const before = game; // what the screen showed (maybe a predicted move)
    const serverBefore = serverGame;
    room = msg.room;
    practiceRequest = false;
    soloRequest = false;
    game = msg.game;
    serverGame = msg.game;
    ui.deadline = Number.isFinite(room.deadlineIn) ? Date.now() + room.deadlineIn : null;
    const fresh = freshEvents(serverBefore, game, eventsSeen, { sync: syncNext });
    eventsSeen = fresh.seen;
    if (syncNext || msg.refused) predicted.length = 0; // a refused move: its guessed animations are void
    const toPlay = unplayed(fresh.play);
    const points = before && game && !syncNext && before.id === game.id ? [shownPoints(before, mySeat()), shownPoints(game, mySeat())] : null;
    syncNext = false;
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
    if (!game || !R.mustDiscard(game, room.you?.seat ?? -1)) ui.discard = R.emptyRes();
    if (game?.toast && game.toast.id !== oldToast) {
      clearTimeout(timers.toast);
      const id = game.toast.id;
      timers.toast = setTimeout(() => { ui.toastHidden = id; draw(); }, 3200);
    }
    draw();
    // after drawing, so animations land on the updated table
    effects.play(toPlay);
    if (points) effects.points(...points);
  };
  socket.addEventListener('close', () => {
    if (socket !== ws || !wantConnection) return;
    ui.status = 'connecting';
    draw(); // shows "Connection lost — reconnecting…" over the board
    clearTimeout(timers.retry);
    // a little randomness so a room's players don't all knock at the same instant after a restart
    timers.retry = setTimeout(connect, Math.min(8000, 600 * 2 ** retry++) * (0.8 + Math.random() * 0.4));
  });
}
// Render's free plan sleeps after 15 minutes without messages *from* players,
// so every open game sends a tiny keep-alive every 4 minutes.
setInterval(() => send({ type: 'ping' }), 4 * 60 * 1000);
// A phone that slept can keep a connection that looks open but is dead. When
// the page comes back, check it: no answer within a few seconds means reconnect.
function checkConnection() {
  if (!wantConnection || document.hidden) return;
  if (ws?.readyState !== WebSocket.OPEN) {
    if (ws?.readyState !== WebSocket.CONNECTING) connect();
    return;
  }
  send({ type: 'ping' });
  clearTimeout(timers.alive);
  const socket = ws;
  timers.alive = setTimeout(() => { if (socket === ws) { retry = 0; connect(); } }, 4000);
}
document.addEventListener('visibilitychange', checkConnection);
addEventListener('online', checkConnection);
addEventListener('pageshow', (event) => { if (event.persisted) checkConnection(); });

function send(msg) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}
// One move at a time: after sending a move, ignore extra clicks until the
// server answers (stops an accidental double-click trading twice).
function setBusy(on) {
  clearTimeout(timers.busy);
  document.body.classList.toggle('busy', on);
  if (on) timers.busy = setTimeout(() => setBusy(false), 900);
}
function sendAction(name, args) {
  if (document.body.classList.contains('busy')) return;
  // offline: don't pretend the move happened
  if (!send({ type: 'action', name, args })) return checkConnection();
  setBusy(true);
  // show your own move at once when its result is certain; the server's update follows
  const guess = predict(game, mySeat(), name, args);
  if (guess) showPredicted(guess);
}
function showPredicted(guess) {
  const before = game;
  const newest = Math.max(0, ...(before.events || []).map((e) => e.id));
  const events = (guess.events || []).filter((e) => e.id > newest);
  game = guess;
  predicted.push(...events.map((e) => ({ sig: signature(e), at: Date.now() })));
  draw();
  effects.play(events);
  effects.points(shownPoints(before, mySeat()), shownPoints(game, mySeat()));
}
const act = (name) => (...args) => sendAction(name, args);

// Keep only this room's backup, and never replace a newer backup with an
// older one (e.g. while the server is still restoring from someone else's).
let backupRoom = null;
function saveBackup(code, snapshot, version) {
  if (typeof code !== 'string' || typeof snapshot !== 'string') return;
  if (backupRoom !== code) {
    backupRoom = code;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('hearthisle-snap-') && key !== `hearthisle-snap-${code}` && key !== `hearthisle-snapv-${code}`) localStorage.removeItem(key);
      }
    } catch {}
  }
  const stored = Number(store.get(`hearthisle-snapv-${code}`) || -1);
  if (Number.isInteger(version) && version < stored) return;
  store.set(`hearthisle-snap-${code}`, snapshot);
  store.set(`hearthisle-snapv-${code}`, String(version ?? 0));
}

const mySeat = () => (room?.you && room.you.seat >= 0 ? room.you.seat : null);

/* ---------- turn timer ---------- */
// Seats the timer is waiting on (the player whose turn it is, or everyone discarding).
function timerSeats() {
  if (!game || game.winner !== null) return [];
  return game.mode === 'discard' ? game.discards.map((d) => d.p) : [game.cur];
}
/** What the turn timer shows now: { text, urgent, left }, or null when there's no timer. */
function timerFace() {
  if (!ui.deadline || !game) return null;
  const left = Math.max(0, Math.ceil((ui.deadline - Date.now()) / 1000));
  return { text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, urgent: left <= 10, left };
}
// Between updates only the timer itself changes, so it is updated directly,
// and only when the shown second changes.
let lastTick = null;
function paintTimer() {
  const face = timerFace();
  const el = document.getElementById('turn-timer');
  if (el && (face?.text ?? '') !== (ui.timer?.text ?? '')) {
    el.hidden = !face;
    el.textContent = face?.text ?? '';
    el.classList.toggle('urgent', !!face?.urgent);
  }
  ui.timer = face;
  const left = face?.left ?? null;
  if (left <= 10 && left > 0 && left !== lastTick && timerSeats().includes(mySeat())) sound.play('tick');
  lastTick = left;
}
setInterval(paintTimer, 250);

/* ---------- actions ---------- */
const actions = {
  ui(patch) {
    Object.assign(ui, patch);
    if (ui.panel !== 'history') ui.history = null; // fetched again next time it opens
    draw();
  },
  draft(patch) {
    // Typing redraws so buttons that need a name or code turn on; the text box itself is kept as it is.
    Object.assign(ui, patch);
    draw();
  },
  playSolo() {
    if (ui.nameDraft.trim().toLowerCase() === '/test') return actions.createRoom();
    soloRequest = true;
    practiceRequest = false;
    store.set('hearthisle-name', ui.nameDraft.trim());
    roomCode = null;
    ui.inviteCode = null;
    ui.error = '';
    connect();
  },
  createRoom() {
    soloRequest = false;
    practiceRequest = ui.nameDraft.trim().toLowerCase() === '/test';
    if (practiceRequest) ui.nameDraft = (store.get('hearthisle-name') || '').trim() || 'Tester';
    store.set('hearthisle-name', ui.nameDraft.trim());
    roomCode = null;
    ui.inviteCode = null;
    ui.error = '';
    connect();
  },
  joinRoom() {
    if (ui.nameDraft.trim().toLowerCase() === '/test') return actions.createRoom();
    store.set('hearthisle-name', ui.nameDraft.trim());
    soloRequest = false;
    roomCode = ui.inviteCode || ui.codeDraft.trim().toUpperCase();
    ui.inviteCode = null;
    ui.error = '';
    connect();
  },
  leave() {
    wantConnection = false;
    clearTimeout(timers.retry);
    const previous = ws;
    ws = null;
    previous?.close();
    room = null;
    game = null;
    roomCode = null;
    ui.inviteCode = null;
    ui.panel = null;
    ui.status = 'home';
    history.replaceState(null, '', '/');
    draw();
  },
  saveName() {
    const name = ui.nameDraft.trim();
    if (name.toLowerCase() === '/test') return actions.createRoom();
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
  remove: (id, who, midGame) => {
    const question = midGame
      ? `Remove ${who} from the game?\n\nTheir turns will be played automatically (roll, then end turn) so the game can go on. Their pieces stay on the board, and a spectator can take over their seat.`
      : `Remove ${who} from this room?`;
    if (confirm(question)) send({ type: 'remove', id });
  },
  takeSeat: (seat, who) => {
    if (confirm(`Take over ${who}’s seat? You’ll play their cards and pieces from now on.`)) send({ type: 'takeSeat', seat });
  },
  spectate: () => send({ type: 'spectate' }),
  setQuick: (quick) => send({ type: 'setOption', quick }),
  setOption: (patch) => send({ type: 'setOption', ...patch }),
  addBot: () => send({ type: 'addBot' }),
  start: () => send({ type: 'start' }),
  rematch: () => send({ type: 'rematch' }),
  toggleSound() {
    sound.setMuted(!sound.muted);
    store.set('hearthisle-muted', sound.muted ? '1' : '0');
    paintSoundButton();
    if (!sound.muted) sound.play('turn');
  },
  practiceRefill: () => send({ type: 'practiceRefill' }),
  practiceReset: () => { ui.panel = null; send({ type: 'practiceReset' }); },
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
  playDevCard: (type) => { ui.panel = null; sendAction('playDevCard', [type]); },
  pickResource: act('pickResource'),
  discard: () => sendAction('discard', [ui.discard]),
  pickBankTrade: (patch) => { Object.assign(ui.bank, patch); draw(); }, // a local choice: no round trip
  bankTrade: () => sendAction('bankTrade', [ui.bank.give, ui.bank.get]),
  showHistory: () => { ui.history = null; ui.panel = 'history'; send({ type: 'history' }); draw(); },
  propose: () => sendAction('propose', [ui.give, ui.get]),
  respond: (_seat, accept) => sendAction('respond', [accept]),
  confirm: act('confirm'),
  withdraw: act('withdraw'),
  counter: () => {
    sendAction('counter', [ui.give, ui.get]);
    ui.counter = null;
    draw();
  },
};

function paintSoundButton() {
  const b = document.getElementById('sound');
  if (!b) return;
  b.setAttribute?.('aria-pressed', String(!sound.muted));
  b.setAttribute?.('aria-label', sound.muted ? 'Turn sound on' : 'Turn sound off');
  b.setAttribute?.('title', sound.muted ? 'Sound is off' : 'Sound is on');
  b.classList.toggle('off', sound.muted);
}
document.getElementById('sound')?.addEventListener('click', actions.toggleSound);
paintSoundButton();

document.getElementById('menu').addEventListener('click', () => {
  if (room?.phase === 'game') actions.ui({ panel: ui.panel === 'menu' ? null : 'menu' });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('input')) {
    if (!room && ui.inviteCode && ui.nameDraft.trim()) actions.joinRoom();
    else if (!room && ui.codeDraft.trim().length >= 4) actions.joinRoom();
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
