// Wires rules to the page. Holds the game state and this screen's seat.
// Online play will later replace the local state with the server's copy;
// the view already draws everything from one seat's point of view.
import * as R from './rules.js';
import { getGeometry } from './geometry.js';
import { render } from './view.js';

const SAVE = 'hearthisle-v2';
let saved = null;
try {
  const candidate = JSON.parse(localStorage.getItem(SAVE));
  if (R.validSavedGame(candidate)) saved = { ...candidate, rolling: false, producing: [], gains: [] };
} catch {}

let state = saved || R.createGame({ autoSetup: true, playerCount: 4, chooseFirst: true });
const ui = {
  panel: saved ? null : 'new',
  count: state.playerCount,
  quick: false,
  tradeTab: 'bank',
  give: R.emptyRes(),
  get: R.emptyRes(),
  discard: R.emptyRes(),
  counter: null,
  follow: true, // local testing: the seat follows whoever must act
  viewer: 0,
  seat: 0,
};
const timers = {};

function actingSeat(g) {
  return g.mode === 'discard' && g.discards.length ? g.discards[0].p : g.cur;
}
function resolveSeat() {
  const next = ui.follow ? actingSeat(state) : Math.min(ui.viewer, state.playerCount - 1);
  if (next !== ui.seat) {
    ui.seat = next;
    ui.give = R.emptyRes();
    ui.get = R.emptyRes();
    ui.discard = R.emptyRes();
    ui.counter = null;
  }
}

function fitBoard() {
  const table = document.getElementById('table');
  const frame = document.getElementById('frame');
  const board = document.getElementById('board');
  const geo = getGeometry(state.playerCount);
  const ratio = geo.width / geo.height;
  const pad = parseFloat(getComputedStyle(frame).paddingLeft) * 2;
  const w = Math.max(200, Math.min(table.clientWidth - pad - 4, (table.clientHeight - pad - 4) * ratio));
  board.style.width = `${w}px`;
  board.style.height = `${w / ratio}px`;
}

function draw() {
  resolveSeat();
  render(state, actions, ui);
  fitBoard();
}
new ResizeObserver(fitBoard).observe(document.getElementById('table'));

function apply(next) {
  if (next === state) return;
  const oldToast = state.toast?.id;
  const hadOffer = !!state.offer;
  state = next;
  if (hadOffer && !state.offer) {
    ui.give = R.emptyRes();
    ui.get = R.emptyRes();
    ui.counter = null;
  }
  try {
    localStorage.setItem(SAVE, JSON.stringify({ ...state, rolling: false, producing: [], gains: [] }));
  } catch {}
  draw();
  if (state.toast?.id !== oldToast) {
    clearTimeout(timers.toast);
    if (state.toast) {
      const id = state.toast.id;
      timers.toast = setTimeout(() => apply(R.clearToast(state, id)), 3200);
    }
  }
}
const bind = (fn) => (...args) => apply(fn(state, ...args));

const actions = {
  ui(patch) {
    Object.assign(ui, patch);
    draw();
  },
  viewAs(p) {
    ui.follow = false;
    ui.viewer = p;
    draw();
  },
  toggleFollow() {
    ui.follow = !ui.follow;
    ui.viewer = ui.seat;
    draw();
  },
  newGame() {
    Object.values(timers).forEach(clearTimeout);
    ui.panel = null;
    ui.follow = true;
    apply(R.createGame({ playerCount: ui.count, autoSetup: ui.quick, chooseFirst: true }));
  },
  roll() {
    const next = R.startRoll(state);
    if (next === state) return;
    apply(next);
    timers.roll = setTimeout(() => {
      apply(R.resolveRoll(state, state.dice));
      timers.produce = setTimeout(() => apply(R.clearProducing(state)), 2200);
    }, 550);
  },
  endTurn: bind(R.endTurn),
  cancelBuild: bind(R.cancelBuild),
  chooseBuild: bind(R.chooseBuild),
  placeAtVertex: bind(R.placeAtVertex),
  placeAtEdge: bind(R.placeAtEdge),
  moveRobber: bind(R.moveRobber),
  stealFrom: bind(R.stealFrom),
  buyDevCard: bind(R.buyDevCard),
  playDevCard: bind(R.playDevCard),
  pickResource: bind(R.pickResource),
  discard() {
    const next = R.discardCards(state, ui.discard);
    ui.discard = R.emptyRes();
    apply(next);
    draw();
  },
  setTrade: bind(R.setTrade),
  bankTrade: bind(R.bankTrade),
  propose: () => apply(R.proposeTrade(state, ui.give, ui.get)),
  respond: bind(R.respondTrade),
  confirm: bind(R.confirmTrade),
  withdraw: bind(R.withdrawTrade),
  counter(p) {
    const next = R.counterTrade(state, p, ui.give, ui.get);
    ui.counter = null;
    apply(next);
    draw();
  },
};

document.getElementById('menu').addEventListener('click', () => actions.ui({ panel: ui.panel === 'menu' ? null : 'menu' }));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.panel && ui.panel !== 'new') actions.ui({ panel: null });
  else if (ui.counter !== null) actions.ui({ counter: null });
  else apply(R.cancelBuild(state));
});
draw();
