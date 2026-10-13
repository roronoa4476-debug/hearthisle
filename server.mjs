// Koolkatan server: serves the game files and runs online rooms over WebSockets.
// Locally: http://localhost:5174 (or $PORT). On a host such as Render it listens
// on the port the host provides.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Rooms from './server/rooms.mjs';
import { seal, unseal } from './server/snapshots.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(root, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function createApp() {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ready' }));
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = normalize(join(publicDir, pathname));
    if (!file.startsWith(publicDir + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const info = await stat(file);
      // Artwork rarely changes, so browsers keep it for a week. Code and pages are
      // re-checked on every visit, but an unchanged file costs only a tiny 304 reply.
      const headers = {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': pathname.startsWith('/art/') ? 'public, max-age=604800' : 'no-cache',
        ETag: `W/"${info.size}-${Math.round(info.mtimeMs)}"`,
      };
      if (req.headers['if-none-match'] === headers.ETag) {
        res.writeHead(304, headers).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  attachRooms(server);
  return server;
}

/* ---------- WebSocket rooms ---------- */
function attachRooms(server) {
  // Updates are JSON and compress well, so messages over 1 KB are deflated.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024, perMessageDeflate: { threshold: 1024 } });
  server.wss = wss;
  const sockets = new Map(); // room code -> Set of { ws, token }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (room) => {
    let snapshot = null;
    try {
      snapshot = seal(Rooms.snapshotOf(room));
    } catch (err) {
      console.error('snapshot failed', err);
    }
    const set = sockets.get(room.code) || new Set();
    for (const c of set) {
      try {
        if (!room.members.has(c.token)) {
          // removed by the host: tell them and drop the connection
          send(c.ws, { type: 'error', code: 'removed', message: 'The host removed you from this room.' });
          set.delete(c);
          c.ws.close();
          continue;
        }
        send(c.ws, { ...Rooms.viewFor(room, c.token), snapshot });
      } catch (err) {
        console.error('send failed', err);
      }
    }
  };

  wss.on('connection', (ws) => {
    let room = null;
    let token = null;
    let budget = 40; // simple flood protection: messages per 5 seconds
    let lastAction = '';
    let lastActionAt = 0;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (data) => {
      try {
        handle(data);
      } catch (err) {
        console.error('message failed', err); // one bad message never takes the server down
      }
    });
    const handle = (data) => {
      if (--budget < 0) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'hello') {
        if (room) return;
        token = typeof msg.token === 'string' && /^[a-f0-9]{32}$/.test(msg.token) ? msg.token : null;
        if (!token) return send(ws, { type: 'error', message: 'Bad session. Reload the page.' });
        // A practice request can only create a fresh room, never modify a requested room.
        const practice = msg.practice === true && !msg.room;
        room = practice ? Rooms.createPracticeRoom(token, msg.name) : msg.room ? Rooms.getRoom(msg.room) : Rooms.createRoom();
        // Server restarted? The browser's sealed copy brings the room back.
        if (msg.room && msg.snapshot) {
          const data = unseal(msg.snapshot);
          if (data && data.code === String(msg.room).toUpperCase()) {
            const restored = Rooms.restoreRoom(data);
            if (restored && restored !== room) console.log(`restored room ${restored.code} at version ${restored.version}`);
            room = restored || room;
          }
        }
        if (!room) {
          return send(ws, msg.room
            ? { type: 'error', code: 'no-room', message: 'That room doesn’t exist any more. Create a new one.' }
            : { type: 'error', message: 'The server is busy right now. Try again in a minute.' });
        }
        const member = Rooms.join(room, token, msg.name);
        // "Play solo": a fresh room with three bots already seated.
        if (member && msg.solo === true && !msg.room && !practice && room.members.size === 1) for (let i = 0; i < 3; i++) Rooms.addBot(room);
        if (!member) {
          const removed = room.removed?.has(token);
          room = null;
          return send(ws, { type: 'error', code: removed ? 'removed' : 'full', message: removed ? 'The host removed you from this room.' : 'That room is full.' });
        }
        if (!sockets.has(room.code)) sockets.set(room.code, new Set());
        sockets.get(room.code).add({ ws, token });
        if (!room.listeners.size) room.listeners.add(broadcast);
        Rooms.connected(room, token, +1);
        return;
      }
      if (!room || msg.type === 'ping') return; // keep-alive from the browser
      if (msg.type === 'history') return send(ws, { type: 'history', log: Rooms.historyFor(room) }); // the full move list, on request
      if (msg.type === 'action') {
        // Ignore an exact repeat within a moment (a double-click must not trade twice).
        const key = JSON.stringify([msg.name, msg.args]);
        if (key === lastAction && Date.now() - lastActionAt < 400) return;
        lastAction = key;
        lastActionAt = Date.now();
        const accepted = Rooms.act(room, token, String(msg.name), Array.isArray(msg.args) ? msg.args : []);
        // the browser may already show the move (it predicts certain moves); if it was
        // refused, send this player the real table so their screen snaps back
        if (!accepted) send(ws, { ...Rooms.viewFor(room, token), refused: true });
      } else {
        Rooms.lobby(room, token, msg);
      }
    };

    const refill = setInterval(() => (budget = 40), 5000);
    ws.on('close', () => {
      clearInterval(refill);
      if (!room) return;
      const set = sockets.get(room.code);
      if (set) for (const c of set) if (c.ws === ws) set.delete(c);
      Rooms.connected(room, token, -1);
    });
  });

  // Ping every 25 s so idle connections (and free hosts) stay awake during a game.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    Rooms.sweep();
  }, 25000);
  server.on('close', () => clearInterval(heartbeat));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Log unexpected errors instead of exiting, so one bug can't end everyone's game.
  process.on('uncaughtException', (err) => console.error('uncaught', err));
  process.on('unhandledRejection', (err) => console.error('unhandled', err));
  const port = Number(process.env.PORT) || 5174;
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`Koolkatan is running at http://localhost:${port}`);
  });
}
