// Plays the table animations and sounds for game events (see emit() in
// rules.js). Events come from the server already filtered for this seat, so
// nothing here can reveal a hidden card. Each event plays once, in order.
import * as R from './rules.js';
import * as fx from './fx.js';

const MAX_BATCH = 14; // after a long gap (e.g. many autopilot moves) skip to the end

/**
 * Which events in `next` should play. `sync` is true for the first update after
 * (re)connecting: everything there is old news. A new game (different id) plays
 * from its start; a game restored from an older backup skips ahead.
 */
export function freshEvents(prev, next, seen, { sync = false } = {}) {
  if (!next) return { play: [], seen };
  const events = next.events || [];
  const newest = events.length ? events[events.length - 1].id : 0;
  if (sync) return { play: [], seen: newest };
  const newGame = !prev || prev.id !== next.id; // just started from the lobby, or a rematch
  if (!newGame && next.serial < prev.serial) return { play: [], seen: newest }; // restored from an older backup
  const from = newGame ? 0 : seen;
  let play = events.filter((e) => e.id > from);
  if (play.length > MAX_BATCH) play = keepLast(play);
  return { play, seen: Math.max(from, newest) };
}

/** Points each seat shows (yours include your hidden point cards). */
export function shownPoints(g, me) {
  return g.players.map((_, p) => R.victoryPoints(g, p, p === me));
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sign = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
// Keep a long backlog short: the latest turn and win still play, in order.
const keepLast = (events) => {
  const last = (type) => events.filter((e) => e.type === type).slice(-1);
  return [...last('turn'), ...last('win')].sort((a, b) => a.id - b.id);
};

export function createEffects({ sound, seat, game }) {
  const queue = [];
  let running = false;
  // how well the animations keep up with the game (for checking in a browser: koolkatanFx())
  const stats = { played: {}, waitedMax: 0, queueMax: 0, recent: [] };

  /* where things are on screen */
  const at = {
    tile: (hid) => $$('#board .tile')[hid],
    card: (r) => $(`#hand .rcard.r-${r}`),
    row: (p) => $$('#players .player')[p],
    count: (p) => at.row(p)?.querySelector('.stat'),
    vp: (p) => at.row(p)?.querySelector('.vp'),
    bank: (r) => $(`#bank .stack[data-res="${r}"]`), // a resource, or 'dev' for the deck
    devs: () => $('#devs .dev-list') || $('#devs'),
    devCard: (type) => $(`#devs .dev-card[data-dev="${type}"]`),
    dice: () => $('#turn .dice'),
    robber: () => $('#board .robber'),
    trade: () => $('#trade'),
    table: () => $('#table'),
  };
  const mine = (p) => p !== null && p === seat();
  // Keep up with the game: an event holds the queue only for its main motion
  // (tails like chips, glows and banners finish alongside the next one), and
  // when events pile up (fast bots, autopilot) the flights speed up.
  const pace = () => (queue.length >= 3 ? 0.45 : queue.length >= 1 ? 0.75 : 1);
  const fly = (kind, from, to, options = {}) => {
    const k = pace();
    return fx.flyCard(kind, from, to, { ...options, duration: (options.duration || 560) * k, delay: (options.delay || 0) * k });
  };
  const stagger = (count) => Math.min(90, 450 / Math.max(1, count));
  // a player's cards: your own hand card for that resource, or their row
  const hand = (p, r) => (mine(p) ? at.card(r) || at.row(p) : at.row(p));
  const colour = (p) => { const P = R.player(game(), p); return P.light ? P.edge : P.color; };

  /* reactions once cards land */
  function landed(changes) {
    // changes: [{p, res, n}] for players; [{bank: res, n}] for the bank
    const handDiff = {};
    const rows = {};
    const bank = {};
    for (const c of changes) {
      if (c.bank) bank[c.bank] = (bank[c.bank] || 0) + c.n;
      else if (mine(c.p)) handDiff[c.res] = (handDiff[c.res] || 0) + c.n;
      else rows[c.p] = (rows[c.p] || 0) + c.n;
    }
    // reactions finish on their own while the queue moves on
    for (const [r, n] of Object.entries(handDiff)) if (n) { fx.react(() => at.card(r), n > 0 ? 'gain' : 'lose'); fx.chip(() => at.card(r), sign(n), n > 0); }
    for (const [p, n] of Object.entries(rows)) if (n) { fx.react(() => at.count(+p), 'tick'); fx.chip(() => at.count(+p), sign(n), n > 0); }
    for (const [r, n] of Object.entries(bank)) if (n) { fx.react(() => at.bank(r), 'tick'); fx.chip(() => at.bank(r), sign(n), n > 0); }
  }

  /** Fly a basket of face-up cards from a player to the bank (paying, discarding). */
  async function toBank(p, basket, options = {}) {
    const cards = fx.cardsOf(basket || {});
    if (!cards.length) return;
    await Promise.all(cards.map((r, i) => fly(r, hand(p, r), at.bank(r), { delay: i * stagger(cards.length), ...options })));
    landed([...cards.map((res) => ({ p, res, n: -1 })), ...cards.map((r) => ({ bank: r, n: 1 }))]);
  }

  const handlers = {
    roll() { sound.play('dice'); },

    async produce(e) {
      let i = 0;
      const count = e.flows.reduce((s, f) => s + f.n, 0);
      const flights = [];
      for (const f of e.flows) for (let k = 0; k < f.n; k++) flights.push(fly(f.res, at.tile(f.hex), hand(f.p, f.res), { delay: i++ * stagger(count) }));
      await Promise.all(flights);
      const gained = e.flows.filter((f) => mine(f.p)).reduce((s, f) => s + f.n, 0);
      if (gained) sound.play('gain', gained);
      landed([...e.flows.map((f) => ({ p: f.p, res: f.res, n: f.n })), ...e.flows.map((f) => ({ bank: f.res, n: -f.n }))]);
    },

    async build(e) {
      sound.play(e.kind === 'city' ? 'city' : e.kind === 'road' ? 'road' : 'build');
      await toBank(e.p, e.cost);
    },

    async buyDev(e) {
      sound.play('card');
      // pay, and meanwhile a face-down card leaves the deck; the buyer sees it flip to what they drew
      await Promise.all([
        toBank(e.p, e.cost),
        fly('back', at.bank('dev'), mine(e.p) ? at.devs() : at.row(e.p), { reveal: mine(e.p) && e.card ? e.card : null, duration: 820, delay: 200, lift: 30 }),
      ]);
      if (mine(e.p) && e.card) fx.react(() => at.devCard(e.card), 'gain');
      else fx.react(() => at.row(e.p), 'tick');
    },

    async playDev(e) {
      const from = mine(e.p) ? at.devs() : at.row(e.p);
      const c = fx.centre(from);
      if (c) await fly(e.card, from, { x: c.x, y: c.y - 70 }, { duration: 650, lift: 10 });
    },

    async robber(e) {
      sound.play('robber');
      await fx.wait(300); // let the robber finish its 0.3 s slide to the new tile (main.css .robber)
      fx.hop(at.robber);
    },

    async seven() {
      fx.flash(at.dice);
      fx.banner('Seven!', at.table(), { tone: 'danger' });
      await fx.wait(400);
    },

    async steal(e) {
      const known = e.res;
      if (mine(e.to) && known) await fly('back', at.row(e.from), at.card(known), { reveal: known, duration: 800 });
      else if (mine(e.from) && known) await fly(known, at.card(known), at.row(e.to), { duration: 800 });
      else await fly('back', at.row(e.from), at.row(e.to), { duration: 800 });
      landed([{ p: e.from, res: known, n: -1 }, { p: e.to, res: known, n: 1 }].filter((c) => !mine(c.p) || known));
    },

    async plenty(e) {
      await fly(e.res, at.bank(e.res), hand(e.p, e.res));
      landed([{ p: e.p, res: e.res, n: 1 }, { bank: e.res, n: -1 }]);
    },

    async monopoly(e) {
      let i = 0;
      const flights = [];
      const got = e.takes.reduce((s, n) => s + n, 0);
      e.takes.forEach((n, q) => { for (let k = 0; k < n; k++) flights.push(fly(e.res, hand(q, e.res), hand(e.p, e.res), { delay: i++ * stagger(got) })); });
      await Promise.all(flights);
      landed([...e.takes.map((n, q) => ({ p: q, res: e.res, n: -n })).filter((c) => c.n), ...(got ? [{ p: e.p, res: e.res, n: got }] : [])]);
    },

    async bank(e) {
      sound.play('trade');
      const give = fx.cardsOf(e.give);
      const get = fx.cardsOf(e.get);
      await Promise.all([
        ...give.map((r, i) => fly(r, hand(e.p, r), at.bank(r), { delay: i * stagger(give.length) })),
        ...get.map((r, i) => fly(r, at.bank(r), hand(e.p, r), { delay: 300 + i * 70 })),
      ]);
      landed([...give.map((res) => ({ p: e.p, res, n: -1 })), ...get.map((res) => ({ p: e.p, res, n: 1 })), ...give.map((r) => ({ bank: r, n: 1 })), ...get.map((r) => ({ bank: r, n: -1 }))]);
    },

    async trade(e) {
      sound.play('trade');
      const a = fx.cardsOf(e.aGives);
      const b = fx.cardsOf(e.bGives);
      await Promise.all([
        ...a.map((r, i) => fly(r, hand(e.a, r), hand(e.b, r), { delay: i * stagger(a.length) })),
        ...b.map((r, i) => fly(r, hand(e.b, r), hand(e.a, r), { delay: 60 + i * stagger(b.length) })),
      ]);
      landed([...a.map((res) => ({ p: e.a, res, n: -1 })), ...a.map((res) => ({ p: e.b, res, n: 1 })), ...b.map((res) => ({ p: e.b, res, n: -1 })), ...b.map((res) => ({ p: e.a, res, n: 1 }))]);
    },

    offer(e) {
      if (seat() === null || mine(e.p)) return;
      sound.play('offer');
      fx.react(at.trade, 'nudge');
      fx.glow(at.trade, '#1f6fe0');
    },

    async discard(e) {
      await toBank(e.p, e.cards, { lift: 20 });
    },

    async award(e) {
      const name = e.kind === 'longest' ? 'Longest Road' : 'Largest Army';
      if (e.to === null) return;
      if (e.from !== null) await fx.badge(name, at.row(e.from), at.row(e.to), { duration: 750 * pace() });
      fx.react(() => at.row(e.to)?.querySelector('.award'), 'pop');
    },

    async turn(e) {
      fx.glow(() => at.row(e.p), colour(e.p));
      if (mine(e.p)) {
        sound.play('turn');
        fx.banner('Your turn', at.table());
      }
      await fx.wait(250);
    },

    win() {
      sound.play('win');
      fx.confetti();
    },

    timeout() { sound.play('timeout'); },
  };

  async function run() {
    if (running) return;
    running = true;
    while (queue.length) {
      const e = queue.shift();
      stats.played[e.type] = (stats.played[e.type] || 0) + 1;
      stats.recent.push(`${e.id}:${e.type}`);
      if (stats.recent.length > 300) stats.recent.shift();
      stats.waitedMax = Math.max(stats.waitedMax, performance.now() - e.queuedAt);
      try {
        await handlers[e.type]?.(e);
      } catch (err) {
        console.error('animation failed', err);
      }
    }
    running = false;
  }

  return {
    /** Queue events to play in order. */
    play(events) {
      if (!events.length) return;
      queue.push(...events.map((e) => ({ ...e, queuedAt: performance.now() })));
      stats.queueMax = Math.max(stats.queueMax, queue.length);
      if (queue.length > MAX_BATCH) queue.splice(0, queue.length, ...keepLast(queue));
      run();
    },
    /** Pop the points coin of anyone whose shown points went up. */
    points(before, after) {
      after.forEach((n, p) => {
        const d = n - (before[p] ?? n);
        if (d > 0) { fx.react(() => at.vp(p), 'pop'); fx.chip(() => at.vp(p), sign(d)); }
      });
    },
    stats,
  };
}
