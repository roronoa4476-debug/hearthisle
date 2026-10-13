// Table animations: cards flying between the board, hands, players and the
// bank, plus small pops, ticks and banners. Purely visual and flat (2D):
// everything is drawn in a fixed overlay above the table, so the game's own
// elements are never moved. People who ask for reduced motion get nothing.

import { DEV_TYPES } from './rules.js';

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quietly = (promise) => promise.catch(() => {}); // a cancelled animation is not an error

/** The overlay animations are drawn in: 'fx' above the table, 'fx-top' above dialogs too. */
function layer(id = 'fx') {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'fx-layer';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
  }
  return el;
}

/** Centre on screen of an element, a function that finds one, a rect, or an {x, y} point. */
export function centre(target) {
  if (typeof target === 'function') target = target();
  if (!target) return null;
  if ('x' in target && 'y' in target && !('getBoundingClientRect' in target) && !('width' in target)) return target;
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A small card: a resource (`wood`, `ore`…), a development type, or 'back' for a hidden card. */
/** Show a card as a resource, a development card type, or 'back' (face down). */
function face(el, kind) {
  const back = kind === 'back';
  el.className = `fx-card mini-card ${back || DEV_TYPES.includes(kind) ? 'dev' : `r-${kind}`}`;
  el.firstChild.className = `icon i-${back ? 'dev-back' : kind}`;
}
function cardEl(kind) {
  const el = document.createElement('span');
  el.append(document.createElement('span'));
  face(el, kind);
  return el;
}

/**
 * Fly one card from `from` to `to` along a gentle arc.
 * `reveal`: the card starts face down and flips (flat) to this resource half-way.
 */
export async function flyCard(kind, from, to, { delay = 0, duration = 560, lift = 60, reveal = null } = {}) {
  const a = centre(from);
  const b = centre(to);
  if (!a || !b || reduced()) return;
  if (delay) await wait(delay);
  const el = cardEl(reveal ? 'back' : kind);
  layer().append(el);
  const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift };
  const at = (p, s = 1) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
  const flight = el.animate([
    { transform: at(a, 0.6), opacity: 0 },
    { transform: at(a, 1), opacity: 1, offset: 0.12 },
    { transform: at(mid, 1.12), opacity: 1, offset: 0.5 },
    { transform: at(b, 0.85), opacity: 1, offset: 0.92 },
    { transform: at(b, 0.7), opacity: 0 },
  ], { duration, easing: 'cubic-bezier(.35,.1,.25,1)', fill: 'forwards' });
  if (reveal) {
    // a flat "flip": squash to a line, swap the face, open again
    await wait(duration * 0.38);
    await quietly(el.animate([{ scale: '1 1' }, { scale: '0 1' }], { duration: 90, fill: 'forwards' }).finished);
    face(el, reveal);
    el.animate([{ scale: '0 1' }, { scale: '1 1' }], { duration: 90, fill: 'forwards' });
  }
  await quietly(flight.finished);
  el.remove();
}

/** Expand {wood: 2, ore: 1} into ['wood', 'wood', 'ore']. */
export const cardsOf = (basket) => Object.entries(basket).flatMap(([r, n]) => Array(Math.max(0, n)).fill(r));

// Reactions run on real game elements, which are rebuilt on every redraw.
// Each running one is remembered with a way to find its element again, and
// reattach() (called after each redraw) continues it on the new element at
// the same point, so it always plays exactly once, start to finish.
const active = new Set();
function onElement(locate, frames, options) {
  const el = typeof locate === 'function' ? locate() : locate;
  if (!el || reduced()) return Promise.resolve();
  const entry = { locate: typeof locate === 'function' ? locate : () => null, el, frames, options, start: performance.now() };
  entry.anim = el.animate(frames, options);
  active.add(entry);
  return new Promise((resolve) => setTimeout(() => { active.delete(entry); resolve(); }, options.duration));
}
export function reattach() {
  const now = performance.now();
  for (const entry of active) {
    const el = entry.locate();
    if (!el || el === entry.el || !el.isConnected) continue;
    entry.el = el;
    entry.anim = el.animate(entry.frames, entry.options);
    entry.anim.currentTime = Math.min(now - entry.start, entry.options.duration);
  }
}

/** A quick reaction on an element (or a function that finds it): 'gain' (bump + green glow), 'lose' (dip + red), 'pop', 'nudge', 'tick'. */
export function react(target, kind = 'pop') {
  const frames = {
    gain: [{ transform: 'none', filter: 'none' }, { transform: 'translateY(-7px) scale(1.06)', filter: 'drop-shadow(0 0 6px rgba(47,164,94,.9))', offset: 0.35 }, { transform: 'none', filter: 'none' }],
    lose: [{ transform: 'none', filter: 'none' }, { transform: 'translateY(4px) scale(.95)', filter: 'drop-shadow(0 0 6px rgba(200,55,43,.9))', offset: 0.35 }, { transform: 'none', filter: 'none' }],
    pop: [{ transform: 'none' }, { transform: 'scale(1.22)', offset: 0.4 }, { transform: 'none' }],
    tick: [{ transform: 'none' }, { transform: 'scale(1.12)', offset: 0.5 }, { transform: 'none' }],
    nudge: [{ transform: 'none' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }],
  }[kind];
  return onElement(target, frames, { duration: kind === 'nudge' ? 420 : 380, easing: 'ease-out' });
}

/** A small floating "+2" / "−1" chip that rises from an element and fades. */
export function chip(target, text, good = true) {
  const c = centre(target);
  if (!c || reduced()) return Promise.resolve();
  const el = document.createElement('span');
  el.className = `fx-chip ${good ? 'good' : 'bad'}`;
  el.textContent = text;
  layer().append(el);
  const at = (dy, s) => `translate(${c.x}px, ${c.y + dy}px) translate(-50%, -50%) scale(${s})`;
  return el.animate([
    { transform: at(4, 0.6), opacity: 0 },
    { transform: at(-10, 1), opacity: 1, offset: 0.25 },
    { transform: at(-26, 1), opacity: 1, offset: 0.75 },
    { transform: at(-34, 0.95), opacity: 0 },
  ], { duration: 1100, easing: 'ease-out' }).finished.catch(() => {}).then(() => el.remove());
}

/** A soft glow sweeping across an element (e.g. the player whose turn it is). */
export function glow(target, colour = '#1f6fe0') {
  return onElement(target, [
    { boxShadow: `0 0 0 0 ${colour}00` },
    { boxShadow: `0 0 0 4px ${colour}aa, 0 0 18px 4px ${colour}66`, offset: 0.3 },
    { boxShadow: `0 0 0 0 ${colour}00` },
  ], { duration: 900, easing: 'ease-out' });
}

/** A banner across the middle of an element, e.g. "Your turn". */
export async function banner(text, over, { tone = 'turn' } = {}) {
  const c = centre(over);
  if (!c || reduced()) return;
  const el = document.createElement('div');
  el.className = `fx-banner ${tone}`;
  el.textContent = text;
  layer().append(el);
  const at = (dx, s) => `translate(${c.x + dx}px, ${c.y}px) translate(-50%, -50%) scale(${s})`;
  await quietly(el.animate([
    { transform: at(-40, 0.9), opacity: 0 },
    { transform: at(0, 1), opacity: 1, offset: 0.18 },
    { transform: at(0, 1), opacity: 1, offset: 0.78 },
    { transform: at(40, 0.96), opacity: 0 },
  ], { duration: 1500, easing: 'ease-out' }).finished);
  el.remove();
}

/** An award badge (e.g. "Longest Road") travelling from one player to another. */
export async function badge(text, from, to, { duration = 750 } = {}) {
  const a = centre(from);
  const b = centre(to);
  if (!a || !b || reduced()) return;
  const el = document.createElement('span');
  el.className = 'award fx-badge';
  el.textContent = text;
  layer().append(el);
  const mid = { x: (a.x + b.x) / 2 + 40, y: (a.y + b.y) / 2 };
  const at = (p, s) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
  await quietly(el.animate([
    { transform: at(a, 0.8), opacity: 0 },
    { transform: at(a, 1.1), opacity: 1, offset: 0.15 },
    { transform: at(mid, 1.2), opacity: 1, offset: 0.55 },
    { transform: at(b, 1), opacity: 1, offset: 0.9 },
    { transform: at(b, 0.9), opacity: 0 },
  ], { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished);
  el.remove();
}

/** Flat confetti falling over an area, behind dialogs. */
export function confetti(over = document.body, colours = ['#e0362c', '#1f6fe0', '#f5891c', '#2fa84a', '#8e44cf', '#f0b21b']) {
  if (reduced()) return Promise.resolve();
  const r = (over || document.body).getBoundingClientRect();
  const host = layer('fx-top'); // above dialogs, so it stays bright
  const pieces = [];
  for (let i = 0; i < 110; i++) {
    const el = document.createElement('i');
    el.className = 'fx-confetti';
    el.style.setProperty('background', colours[i % colours.length]);
    host.append(el);
    const x = r.left + Math.random() * r.width;
    const drift = (Math.random() - 0.5) * 160;
    const spin = (Math.random() - 0.5) * 720;
    const fall = r.height * (0.7 + Math.random() * 0.4);
    pieces.push(el.animate([
      { transform: `translate(${x}px, ${r.top - 20}px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${x + drift}px, ${r.top + fall}px) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 1800 + Math.random() * 1400, delay: Math.random() * 500, easing: 'cubic-bezier(.2,.6,.4,1)' }).finished.catch(() => {}).then(() => el.remove()));
  }
  return Promise.all(pieces);
}

/** Hop an element on the spot (its own positioning transform is untouched). */
export function hop(target) {
  return onElement(target, [
    { translate: '0 0', scale: '1' },
    { translate: '0 -22%', scale: '1.08', offset: 0.35 },
    { translate: '0 0', scale: '.96', offset: 0.7 },
    { translate: '0 0', scale: '1' },
  ], { duration: 520, easing: 'ease-out' });
}

/** A coloured flash over an element (e.g. red on the dice for a 7). */
export function flash(target, colour = 'rgba(200,55,43,.55)') {
  return onElement(target, [{ filter: 'none' }, { filter: `drop-shadow(0 0 10px ${colour}) brightness(1.05)`, offset: 0.3 }, { filter: 'none' }], { duration: 700 });
}

