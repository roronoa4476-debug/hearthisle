// The real server over a real WebSocket: a refused move sends the player the
// actual table (so a predicted move snaps back), and history is sent on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createApp } from '../server.mjs';

const tok = (n) => n.toString(16).padStart(32, '0');
function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    const i = waiters.findIndex((w) => w.test(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  const next = (test = () => true) => {
    const i = inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { waiters.push({ test, resolve }); setTimeout(() => reject(new Error('no message')), 3000); });
  };
  return new Promise((resolve) => ws.on('open', () => resolve({ ws, next, send: (m) => ws.send(JSON.stringify(m)) })));
}

test('a refused move sends the real table back; the history panel gets every move', async () => {
  const server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const c = await connect(port);
    c.send({ type: 'hello', token: tok(7), name: 'Tester', practice: true });
    const first = await c.next((m) => m.type === 'room' && m.game);
    assert.equal(first.room.you.seat, 0);
    c.send({ type: 'action', name: 'placeAtEdge', args: [9999] }); // not a real edge: refused
    const back = await c.next((m) => m.type === 'room');
    assert.equal(back.refused, true);
    assert.equal(back.game.serial, first.game.serial, 'the table is unchanged');
    c.send({ type: 'action', name: 'bankTrade', args: ['ore', 'wood'] }); // allowed in practice
    const traded = await c.next((m) => m.type === 'room' && !m.refused && m.game.serial > first.game.serial);
    assert.equal(traded.game.events.at(-1).type, 'bank');
    c.send({ type: 'history' });
    const history = await c.next((m) => m.type === 'history');
    assert.ok(Array.isArray(history.log) && history.log.length >= traded.game.log.length);
    c.ws.close();
  } finally {
    server.wss.clients.forEach((ws) => ws.terminate());
    await new Promise((r) => server.close(r));
  }
});

test('artwork is cached for a week; unchanged files answer 304 without a body', async () => {
  const server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const art = await fetch(`${base}/art/icons/wood-emblem.png`);
    assert.equal(art.status, 200);
    assert.match(art.headers.get('cache-control'), /max-age=604800/);
    const code = await fetch(`${base}/js/rules.js`);
    assert.equal(code.headers.get('cache-control'), 'no-cache');
    const tag = code.headers.get('etag');
    assert.ok(tag);
    const again = await fetch(`${base}/js/rules.js`, { headers: { 'If-None-Match': tag } });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0);
    assert.equal((await fetch(`${base}/js/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/../server.mjs`)).status !== 200, true, 'nothing outside public/');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('a moved server forwards pages (with invite codes) to its new address but still reports healthy', async () => {
  process.env.REDIRECT_TO = 'https://example.test/';
  const { createApp: fresh } = await import(`../server.mjs?moved=${Date.now()}`);
  delete process.env.REDIRECT_TO;
  const server = fresh();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/?room=ABCD`, { redirect: 'manual' });
    assert.equal(page.status, 308);
    assert.equal(page.headers.get('location'), 'https://example.test/?room=ABCD');
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    server.wss.clients.forEach((ws) => ws.terminate());
    await new Promise((r) => server.close(r));
  }
});
