// Hearthisle server: serves the game files and runs online rooms over WebSockets.
// Locally: http://localhost:5174 (or $PORT). On a host such as Render it listens
// on the port the host provides.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Rooms from './server/rooms.mjs';

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
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
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
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const sockets = new Map(); // room code -> Set of { ws, token }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (room) => {
    for (const c of sockets.get(room.code) || []) send(c.ws, Rooms.viewFor(room, c.token));
  };

  wss.on('connection', (ws) => {
    let room = null;
    let token = null;
    let budget = 40; // simple flood protection: messages per 5 seconds
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (data) => {
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
        room = msg.room ? Rooms.getRoom(msg.room) : Rooms.createRoom();
        if (!room) {
          room = null;
          return send(ws, { type: 'error', code: 'no-room', message: 'That room doesn’t exist any more. Create a new one.' });
        }
        const member = Rooms.join(room, token, msg.name);
        if (!member) {
          room = null;
          return send(ws, { type: 'error', message: 'That room is full.' });
        }
        if (!sockets.has(room.code)) sockets.set(room.code, new Set());
        sockets.get(room.code).add({ ws, token });
        if (!room.listeners.size) room.listeners.add(broadcast);
        Rooms.connected(room, token, +1);
        return;
      }
      if (!room) return;
      if (msg.type === 'action') {
        Rooms.act(room, token, String(msg.name), Array.isArray(msg.args) ? msg.args : []);
      } else {
        Rooms.lobby(room, token, msg);
      }
    });

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
  const port = Number(process.env.PORT) || 5174;
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`Hearthisle is running at http://localhost:${port}`);
  });
}
