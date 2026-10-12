import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as R from '../public/js/rules.js';
import { getGeometry } from '../public/js/geometry.js';

// Exercise the real development hand, including its buttons, without a browser.
const source = readFileSync(new URL('../public/js/view.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.style = { setProperty() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { this.events[k] = f; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children.map(c => c instanceof Element ? c : String(c)); }
}
function descendants(node) {
  return [node, ...(node.children || []).flatMap(c => c instanceof Element ? descendants(c) : [])];
}
function hand(types = R.DEV_TYPES) {
  const g = R.createGame({ playerCount: 3, randomize: false });
  Object.assign(g, { phase: 'main', turn: 5 });
  g.players[0].dev = types.map(type => ({ type, turn: 0 }));
  const root = new Element('section'), ui = { devPage: 0 }, played = [];
  const context = { R, getGeometry, Node: Element, document: { createElement: tag => new Element(tag), getElementById: () => root } };
  runInNewContext(source, context);
  const actions = { ui(patch) { Object.assign(ui, patch); draw(); }, playDevCard(type) { played.push(type); }, buyDevCard() {} };
  let seat = 0;
  function draw() { context.renderDevs(g, actions, ui, seat); }
  draw();
  return { g, ui, played, root, draw, watch() { seat = null; draw(); }, nodes: () => descendants(root), button(label) { return descendants(root).find(e => e.tag === 'button' && e.attrs['aria-label'] === label); }, cards: () => descendants(root).filter(e => e.tag === 'article') };
}

test('development pages expose every held type with its art and visible description', () => {
  const h = hand(), seen = new Set();
  for (let page = 0; page < 3; page++) {
    assert.ok(h.cards().length >= 1 && h.cards().length <= 2);
    for (const card of h.cards()) {
      seen.add(card.attrs['aria-label']);
      const nodes = descendants(card), type = R.DEV_TYPES.find(t => R.DEV_NAME[t] === card.attrs['aria-label']);
      assert.ok(nodes.some(n => n.className?.includes(`i-${type}`)));
      assert.ok(nodes.some(n => n.tag === 'p' && n.textContent === R.DEV_TEXT[type]));
    }
    h.button('Next development cards').events.click();
  }
  assert.deepEqual([...seen], R.DEV_TYPES.map(t => R.DEV_NAME[t]));
  assert.equal(h.ui.devPage, 0);
});

test('development paging clamps after spending cards and groups duplicate copies', () => {
  const h = hand(['knight', 'knight', 'roads', 'plenty', 'monopoly', 'vp']);
  assert.ok(h.nodes().some(n => n.attrs['aria-label'] === '2 cards'));
  h.ui.devPage = 2;
  h.g.players[0].dev = [{ type: 'knight', turn: 0 }];
  h.draw();
  assert.equal(h.cards().length, 1);
  assert.equal(h.cards()[0].attrs['aria-label'], 'Knight');
  assert.equal(h.button('Next development cards'), undefined);
  assert.ok(!h.root.children.includes('null'));
});

test('Play dispatches the displayed type and never plays hidden victory points', () => {
  const h = hand(['monopoly', 'vp']);
  h.button('Play Monopoly').events.click();
  assert.deepEqual(h.played, ['monopoly']);
  assert.equal(h.button('Play Victory Point'), undefined);
  assert.ok(h.nodes().some(n => n.textContent === 'Hidden point'));
});

test('new cards, other turns and one-card-per-turn restrictions still block Play', () => {
  const h = hand(['knight']);
  h.g.players[0].dev[0].turn = h.g.turn;
  h.draw();
  assert.equal(h.button('Play Knight'), undefined);
  assert.ok(h.nodes().some(n => n.textContent === 'Next turn'));
  h.g.players[0].dev[0].turn = 0;
  h.g.cur = 1;
  h.draw();
  assert.equal(h.button('Play Knight'), undefined);
  assert.ok(h.nodes().some(n => n.textContent === 'On your turn'));
  h.g.cur = 0;
  h.g.devPlayed = true;
  h.draw();
  assert.equal(h.button('Play Knight'), undefined);
  assert.ok(h.nodes().some(n => n.textContent === 'One per turn'));
});

test('spectators and empty hands do not expose development cards or a pager', () => {
  const empty = hand([]);
  assert.equal(empty.cards().length, 0);
  assert.equal(empty.button('Next development cards'), undefined);
  const spectator = hand();
  spectator.watch();
  assert.equal(spectator.cards().length, 0);
  assert.equal(spectator.button('Next development cards'), undefined);
  assert.ok(spectator.nodes().some(n => n.textContent?.includes('Players’ cards stay hidden')));
});
