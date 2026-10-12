import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/js/rules.js';
import * as Rooms from '../server/rooms.mjs';
import { seal, unseal } from '../server/snapshots.mjs';

test('a long match retains its opening history through actions and sealed backups', () => {
  let g=R.createGame({playerCount:5,autoSetup:true});
  const opening=structuredClone(g.log);
  for(let i=0;i<160;i++) {
    if(g.phase==='roll')g=R.resolveRoll(g,[1,1]);
    g=R.endTurn(g);
  }
  assert.ok(g.log.length>60);
  for(const entry of opening)assert.ok(g.log.some(e=>e.id===entry.id&&e.text===entry.text),'opening entry retained');
  assert.ok(R.validSavedGame(g));
  const room=Rooms.createRoom();room.phase='game';room.game=g;
  const backup=seal(Rooms.snapshotOf(room));
  assert.deepEqual(unseal(backup).game.log,g.log);
  assert.ok(Buffer.byteLength(JSON.stringify({type:'hello',snapshot:backup}))<512*1024,'long match backup fits the WebSocket restore limit');
});
