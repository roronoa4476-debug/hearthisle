import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as R from '../public/js/rules.js';
import { getGeometry } from '../public/js/geometry.js';

// Run the real client event handlers with controlled sockets and time. Rendering
// is recorded so these tests can assert the state presented to the player.
const source = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
function client() {
  const sockets = [], timers = new Map(), storage = new Map([['hearthisle-name', 'Tester'], ['hearthisle-token', 'a'.repeat(32)]]);
  const elements = new Map();
  let nextTimer = 0, state, actions;
  const element = () => ({clientWidth:800, clientHeight:600, style:{}, classList:{toggle(){}, contains(){return false;}}, addEventListener(){}});
  class Socket {
    static OPEN = 1;
    constructor() { this.handlers = {}; this.sent = []; this.readyState = 1; sockets.push(this); }
    addEventListener(event, handler) { this.handlers[event] = handler; }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.emit('close'); }
    emit(event, value) { this.handlers[event]?.(value); }
    message(message) { this.emit('message', {data:JSON.stringify(message)}); }
  }
  const location = {protocol:'http:', host:'localhost', search:'?room=BAD1'};
  runInNewContext(source, {
    R, getGeometry, createMapView:()=>({resize(){}}), createSound:()=>({play(){}, muted:false, setMuted(){}}), createEffects:()=>({play(){}, points(){}, stats:{}}), globalThis:{}, freshEvents:()=>({play:[], seen:0}), shownPoints:()=>[], reattach(){}, predict:()=>null, console, Date, URLSearchParams, location,
    history:{replaceState(_state, _title, url){location.search = new URL(url, 'http://localhost').search;}},
    localStorage:{getItem:k=>storage.get(k)??null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k), key:i=>[...storage.keys()][i], get length(){return storage.size;}},
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);}, addEventListener(){}, body:element()},
    ResizeObserver:class{observe(){}}, addEventListener(){}, getComputedStyle:()=>({paddingLeft:'0'}), WebSocket:Socket,
    setTimeout:(fn, ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;}, clearTimeout:id=>timers.delete(id), setInterval(){},
    render(_game, handlers, ui, room){actions=handlers;state={...ui,room};},
  });
  return {sockets, timers, location, get actions(){return actions;}, get state(){return state;}, open(){sockets.at(-1).emit('open');}, tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();return timer.ms;}};
}
const roomMessage = () => ({type:'room',room:{code:'GOOD',version:1,you:{name:'Tester',seat:0},phase:'lobby'},game:null});
test('the name code creates a separate practice room and reconnects to that room', () => {
  const c = client();
  c.actions.draft({ nameDraft: ' /TEST ' });
  c.actions.joinRoom();
  c.open();
  const socket = c.sockets.at(-1);
  assert.equal(socket.sent[0].practice, true);
  assert.equal(socket.sent[0].room, null, 'an invitation must not be modified by the code');
  assert.equal(socket.sent[0].name, 'Tester');
  socket.message({ ...roomMessage(), room: { ...roomMessage().room, practice: true } });
  socket.emit('close');
  c.tick(); c.open();
  assert.equal(c.sockets.at(-1).sent[0].room, 'GOOD');
  assert.equal(c.sockets.at(-1).sent[0].practice, false, 'reconnecting must not create another practice island');
});
test('practice preserves the saved player name used by other rooms', () => {
  const c = client();
  c.actions.draft({ nameDraft: 'Nightmare' });
  c.actions.createRoom();
  c.actions.leave();
  c.actions.draft({ nameDraft: '/test' });
  c.actions.createRoom(); c.open();
  assert.equal(c.sockets.at(-1).sent[0].name, 'Nightmare');
  assert.equal(c.sockets.at(-1).sent[0].practice, true);
});
for (const code of ['full','no-room','removed',undefined]) test(`rejected join (${code??'other'}) stops retries and clears stale invitation`, () => {
  const c=client();c.open();c.sockets[0].message({type:'error',code,message:'Join rejected'});
  assert.equal(c.timers.size,0);assert.equal(c.state.status,'home');assert.equal(c.state.inviteCode,null);assert.equal(c.location.search,'');assert.equal(c.sockets.length,1);
});
test('first typed room code after a failed invitation is used', () => {
  const c=client();c.open();c.sockets[0].message({type:'error',code:'no-room',message:'Missing'});
  c.actions.draft({codeDraft:'GOOD'});c.actions.joinRoom();c.open();
  assert.equal(c.sockets[1].sent[0].room,'GOOD');c.sockets[1].message(roomMessage());assert.equal(c.state.room.code,'GOOD');
});
test('failed transport retries back off until a room is actually joined', () => {
  const about=(ms,base)=>assert.ok(ms>=base*0.8&&ms<=base*1.2,`${ms} is about ${base}`); // retries are spread a little
  const c=client();c.open();c.sockets[0].emit('close');about(c.tick(),600);
  c.open();c.sockets[1].emit('close');about(c.tick(),1200);
  c.open();c.sockets[2].message(roomMessage());c.sockets[2].emit('close');about(c.tick(),600);
});
test('explicit room choice cancels a pending retry and ignores the old socket', () => {
  const c=client();c.open();const old=c.sockets[0];old.emit('close');assert.equal(c.timers.size,1);
  c.actions.createRoom();assert.equal(c.timers.size,0);c.open();const current=c.sockets[1];assert.equal(current.sent[0].room,null);
  current.message(roomMessage());old.message({type:'error',code:'full',message:'Old error'});old.emit('close');old.emit('open');
  assert.equal(c.state.room.code,'GOOD');assert.equal(c.timers.size,0);assert.equal(old.sent.length,1);
});
test('leaving during reconnection cancels the pending reconnect', () => {
  const c=client();c.open();c.sockets[0].message(roomMessage());c.sockets[0].emit('close');assert.equal(c.timers.size,1);
  c.actions.leave();assert.equal(c.timers.size,0);assert.equal(c.state.status,'home');assert.equal(c.state.inviteCode,null);
});
