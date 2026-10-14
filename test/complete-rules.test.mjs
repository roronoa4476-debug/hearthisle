import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/js/rules.js';
import {getGeometry} from '../public/js/geometry.js';
const seeded=(seed=13)=>()=>((seed=seed*16807%2147483647)/2147483647);
const bag=list=>list.reduce((out,x)=>(out[x]=(out[x]||0)+1,out),{});
const basket=patch=>({...R.emptyRes(),...patch});
function blank(count=4){const g=R.createGame({playerCount:count,autoSetup:false,rng:seeded()});g.phase='main';g.setup=null;g.mode=null;return g;}
function hand(g,p,patch){for(const r of R.RES){const next=patch[r]||0;g.bank[r]+=g.players[p].res[r]-next;g.players[p].res[r]=next;}}
function town(g,v,p,city=false){g.settlements[v]={p,city};g.townList.push(v);}
function road(g,e,p){g.roads[e]=p;g.roadList.push(e);}
function invariant(g){assert.ok(R.validSavedGame(g),'resource conservation and save structure');for(const pl of g.players)for(const r of R.RES)assert.ok(pl.res[r]>=0);assert.equal(new Set(g.roadList).size,g.roadList.length);assert.equal(new Set(g.townList).size,g.townList.length);}
for(const count of [3,4,5,6]){
  test(`${count} players: component counts, topology, coast and ports`,()=>{
    const G=getGeometry(count),cfg=R.configFor(count),big=count>4;
    assert.equal(G.hexes.length,big?30:19);assert.equal(G.verts.length,big?80:54);assert.equal(G.edges.length,big?109:72);assert.equal(G.coast.length,big?38:30);
    assert.equal(G.verts.length-G.edges.length+G.hexes.length,1);
    assert.equal(new Set(G.harbors.flatMap(h=>h.verts)).size,big?22:18);
    assert.deepEqual(bag(G.harbors.map(h=>h.type)),{any:big?5:4,wheat:1,ore:1,sheep:big?2:1,brick:1,wood:1});
    assert.deepEqual(bag(cfg.terrain),{mountains:big?5:3,pasture:big?6:4,forest:big?6:4,fields:big?6:4,hills:big?5:3,desert:big?2:1});
    assert.deepEqual(bag(cfg.sequence),big?{2:2,3:3,4:3,5:3,6:3,8:3,9:3,10:3,11:3,12:2}:{2:1,3:2,4:2,5:2,6:2,8:2,9:2,10:2,11:2,12:1});
    assert.deepEqual(bag(cfg.deck),{knight:big?20:14,vp:5,roads:big?3:2,plenty:big?3:2,monopoly:big?3:2});
    assert.equal(cfg.resourceCount,big?24:19);
    assert.equal(new Set(G.spiral).size,G.hexes.length);
    for(let i=1;i<G.spiral.length;i++)assert.ok(G.neighbors[G.spiral[i-1]].includes(G.spiral[i]),`spiral step ${i} touches the preceding tile`);
  });
  test(`${count} players: 100 random islands preserve alphabetical tokens and every component`,()=>{
    const rng=seeded(count);
    for(let n=0;n<100;n++){
      const g=R.createGame({playerCount:count,rng,autoSetup:false});
      assert.deepEqual(bag(g.terrain),bag(R.configFor(count).terrain));
      assert.deepEqual(getGeometry(count).spiral.filter(h=>g.terrain[h]!=='desert').map(h=>g.numbers[h]),R.configFor(count).sequence);
      g.terrain.forEach((t,h)=>assert.equal(g.numbers[h]===0,t==='desert'));
      invariant(g);
    }
  });
  test(`${count} players: full manual snake setup, second grants and piece limits`,()=>{
    let g=R.createGame({playerCount:count,firstPlayer:1,autoSetup:false,rng:seeded(16)});const order=[];
    for(let i=0;i<count*2;i++){
      const p=g.cur;order.push(p);const v=R.validVertices(g)[0];assert.notEqual(v,undefined);
      const prev=R.totalCards(g.players[p].res);g=R.placeAtVertex(g,v);
      assert.equal(R.totalCards(g.players[p].res)-prev,i<count?0:getGeometry(count).verts[v].hexes.filter(h=>g.numbers[h]).length);
      assert.equal(g.cur,p);assert.equal(R.placeAtVertex(g,v),g);
      const edge=R.validEdges(g)[0];assert.ok(getGeometry(count).verts[v].edges.includes(edge));g=R.placeAtEdge(g,edge);invariant(g);
    }
    assert.deepEqual(order,g.setupOrder);assert.equal(g.cur,1);assert.equal(g.phase,'roll');
    for(let p=0;p<count;p++)assert.deepEqual(R.piecesLeft(g,p),{road:13,settlement:3,city:4,dev:count>4?34:25});
  });
  test(`${count} players: 120 deterministic turns retain supply and legal action phases`,()=>{
    let g=R.createGame({playerCount:count,rng:seeded(count),autoSetup:true}),rng=seeded(count*20);
    for(let i=0;i<120&&g.winner===null;i++){
      if(g.phase==='roll')g=R.resolveRoll(g,R.rollDice(rng));
      while(g.mode==='discard'){const d=g.discards[0],b=R.emptyRes();let n=d.n;for(const r of R.RES){b[r]=Math.min(n,g.players[d.p].res[r]);n-=b[r];}g=R.discardCards(g,b);}
      if(g.mode==='robber')g=R.moveRobber(g,R.robberTargets(g)[0],rng);
      if(g.mode==='steal')g=R.stealFrom(g,g.victims[0],rng);
      for(const k of ['city','settlement','road'])if(R.canBuild(g,k)){g=R.chooseBuild(g,k);g=k==='road'?R.placeAtEdge(g,R.validEdges(g)[0]):R.placeAtVertex(g,R.validVertices(g)[0]);break;}
      invariant(g);if(g.winner===null){const next=R.endTurn(g);assert.notEqual(next,g);g=next;}
    }
  });
}
test('highest opening roll determines first player; tied leaders reroll',()=>{
  const values=[0,0, .4,.4, .9,.9, .9,.9, 0,0, .9,.9];let n=0;
  const g=R.createGame({chooseFirst:true,autoSetup:false,randomize:false,playerCount:4,rng:()=>values[n++]??.3});
  assert.equal(g.firstPlayer,3);assert.equal(g.cur,3);assert.deepEqual(g.openingRolls[3],[6,6]);assert.deepEqual(g.openingRolls[2],[1,1]);
});
test('settlements need distance and an own road; cities only replace own settlements',()=>{
  const g=blank(),G=getGeometry(4),v=20;town(g,v,1);
  for(const n of G.verts[v].adj)assert.equal(R.canSettle(g,n,0,true),false);
  assert.equal(R.canCity(g,v,0),false);assert.equal(R.canCity(g,v,1),true);
  const free=G.verts.find(v=>!g.settlements[v.id]&&R.canSettle(g,v.id,0,true));
  assert.equal(R.canSettle(g,free.id,0,false),false);road(g,free.edges[0],0);assert.equal(R.canSettle(g,free.id,0,false),true);
});
test('road cannot connect through an opponent building',()=>{
  const g=blank(),G=getGeometry(4),v=G.verts.find(v=>v.edges.length===3);road(g,v.edges[0],0);town(g,v.id,1);
  assert.equal(R.canRoad(g,v.edges[1],0),false);assert.equal(R.canRoad(g,v.edges[1],1),true);
});
test('city upgrade returns settlement piece and pays bank exactly',()=>{
  let g=blank();town(g,20,0);hand(g,0,basket({wheat:2,ore:3}));const before={...g.bank};g=R.placeAtVertex(R.chooseBuild(g,'city'),20);
  assert.equal(g.settlements[20].city,true);assert.equal(R.piecesLeft(g,0).settlement,5);assert.equal(R.piecesLeft(g,0).city,3);
  assert.equal(g.bank.wheat,before.wheat+2);assert.equal(g.bank.ore,before.ore+3);invariant(g);
});
function producer(owners){const g=blank(),G=getGeometry(4),hid=g.terrain.findIndex(t=>t==='forest');g.phase='roll';g.numbers=g.numbers.map(()=>0);g.numbers[hid]=6;g.robber=g.terrain.indexOf('desert');owners.forEach((p,i)=>town(g,G.hexes[hid].verts[i*2],p,true));return g;}
test('production pays cities two, all players, and blocks the robber tile',()=>{
  let g=producer([0,1]);const hid=g.numbers.indexOf(6);g=R.resolveRoll(g,[3,3]);assert.equal(g.players[0].res.wood,2);assert.equal(g.players[1].res.wood,2);invariant(g);
  let blocked=producer([0]);blocked.robber=hid;blocked=R.resolveRoll(blocked,[3,3]);assert.equal(blocked.players[0].res.wood,0);
});
test('shortage: multiple recipients receive none; sole recipient gets remaining bank cards',()=>{
  for(const owners of [[0,1],[0]]){let g=producer(owners);hand(g,2,basket({wood:18}));g=R.resolveRoll(g,[3,3]);assert.equal(g.players[0].res.wood,owners.length===1?1:0);assert.equal(g.players[1].res.wood,0);invariant(g);}
});
test('seven queues every large hand; exact chosen discard excludes development cards',()=>{
  let g=blank();g.phase='roll';hand(g,0,basket({wood:7}));hand(g,1,basket({brick:9}));hand(g,2,basket({wheat:8}));g.players[0].dev=Array.from({length:5},()=>({type:'knight',turn:0}));
  g=R.resolveRoll(g,[3,4]);assert.deepEqual(g.discards,[{p:1,n:4},{p:2,n:4}]);assert.equal(R.handOwner(g),1);
  assert.equal(R.discardCards(g,basket({brick:3})),g);assert.equal(R.discardCards(g,basket({wood:4})),g);assert.equal(R.endTurn(g),g);
  g=R.discardCards(g,basket({brick:4}));assert.equal(R.handOwner(g),2);g=R.discardCards(g,basket({wheat:4}));assert.equal(g.mode,'robber');assert.equal(R.totalCards(g.players[0].res),7);invariant(g);
});
test('robber must move; victims are distinct adjacent opponents with cards; random stealing conserved',()=>{
  let g=blank();const G=getGeometry(4),hid=g.robber===0?1:0;town(g,G.hexes[hid].verts[0],1);town(g,G.hexes[hid].verts[2],2);town(g,G.hexes[hid].verts[4],0);hand(g,1,basket({wood:1}));hand(g,2,basket({ore:1}));g.mode='robber';
  assert.equal(R.moveRobber(g,g.robber),g);assert.equal(R.moveRobber(g,999),g);g=R.moveRobber(g,hid);assert.equal(g.mode,'steal');assert.deepEqual(g.victims,[1,2]);assert.equal(R.stealFrom(g,0),g);g=R.stealFrom(g,2,()=>0);assert.equal(g.players[0].res.ore,1);assert.equal(g.players[2].res.ore,0);invariant(g);
});
for(const type of ['any','wood','brick','wheat','sheep','ore'])test(`${type} harbor gives the correct owned-building trade ratio`,()=>{
  const g=blank(),harbor=getGeometry(4).harbors.find(h=>h.type===type);town(g,harbor.verts[0],0,true);
  for(const r of R.RES)assert.equal(R.harborRatio(g,0,r),type==='any'?3:type===r?2:4);
  assert.equal(R.harborRatio(g,1,'wood'),4);
});
test('bank rejects empty supply, giveaways, same resource and wrong phases',()=>{
  let g=blank();hand(g,0,basket({wood:8}));hand(g,1,basket({ore:19}));assert.equal(R.bankTrade(g,'wood','ore'),g);
  assert.equal(R.bankTrade(g,'wood','wood'),g);g.phase='roll';assert.equal(R.bankTrade(g,'wood','brick'),g);
});
test('basket trade needs partner consent then active confirmation, conserves cards and accepts mixed resources',()=>{
  let g=blank();hand(g,0,basket({wood:2,brick:1}));hand(g,1,basket({ore:1,wheat:2}));
  const give=basket({wood:2,brick:1}),get=basket({ore:1,wheat:2});g=R.proposeTrade(g,give,get);
  assert.equal(R.confirmTrade(g,1),g);g=R.respondTrade(g,1,true);assert.equal(g.players[0].res.wood,2);g=R.confirmTrade(g,1);assert.deepEqual(g.players[0].res,get);assert.deepEqual(g.players[1].res,give);assert.equal(g.offer,null);invariant(g);
});
test('trade rejects free gifts, overlapping types, negatives, fractional amounts and nonparticipants',()=>{
  let g=blank();hand(g,0,basket({wood:2}));hand(g,1,basket({ore:1}));
  for(const [give,get] of [[basket({wood:1}),basket({})],[basket({wood:1}),basket({wood:1})],[basket({wood:-1}),basket({ore:1})],[basket({wood:.5}),basket({ore:1})]])assert.equal(R.proposeTrade(g,give,get),g);
  g=R.proposeTrade(g,basket({wood:1}),basket({ore:1}));assert.equal(R.respondTrade(g,0,true),g);assert.equal(R.respondTrade(g,8,true),g);g=R.respondTrade(g,1,false);assert.equal(R.confirmTrade(g,1),g);
});
test('counteroffers can be confirmed; stale accepted offers recheck both hands',()=>{
  let g=blank();hand(g,0,basket({wood:3}));hand(g,1,basket({ore:2}));g=R.proposeTrade(g,basket({wood:1}),basket({ore:1}));g=R.counterTrade(g,1,basket({wood:2}),basket({ore:1}));g=R.confirmTrade(g,1);assert.equal(g.players[0].res.wood,1);assert.equal(g.players[1].res.wood,2);invariant(g);
  g=R.proposeTrade(g,basket({wood:1}),basket({ore:1}));g=R.respondTrade(g,1,true);hand(g,1,basket({}));assert.equal(R.confirmTrade(g,1),g);
});
for(const type of ['knight','roads','plenty','monopoly'])test(`${type} may be played before dice, only once and only old cards`,()=>{
  let g=R.createGame({autoSetup:true,rng:seeded(5)});g.players[0].dev=[{type,turn:0},{type:'knight',turn:0}];assert.ok(R.canPlayDev(g,type));g=R.playDevCard(g,type);assert.equal(g.devPlayed,true);assert.equal(R.canPlayDev(g,'knight'),false);assert.equal(R.startRoll(g),g);
  if(type==='knight'){g=R.moveRobber(g,R.robberTargets(g)[0],()=>0);if(g.mode==='steal')g=R.stealFrom(g,g.victims[0],()=>0);}
  if(type==='roads')while(g.freeRoads)g=R.placeAtEdge(g,R.validEdges(g)[0]);
  if(type==='plenty'){g=R.pickResource(g,'wood');g=R.pickResource(g,'ore');}
  if(type==='monopoly')g=R.pickResource(g,'wood');
  assert.equal(g.phase,'roll');assert.notEqual(R.startRoll(g),g);
});
test('Road Building uses up to two available pieces and cannot be cancelled midway',()=>{
  let g=blank(),G=getGeometry(4);town(g,0,0);g.players[0].dev=[{type:'roads',turn:0}];
  // Fourteen connected coastal roads, leaving one piece.
  let v=G.coast[0].a;for(let i=0;i<14;i++){const e=G.verts[v].edges.find(e=>G.edges[e].hexes.length===1&&g.roads[e]===undefined);road(g,e,0);v=G.edges[e].a===v?G.edges[e].b:G.edges[e].a;}
  g=R.playDevCard(g,'roads');assert.equal(g.freeRoads,1);assert.equal(R.cancelBuild(g),g);const before={...g.players[0].res};g=R.placeAtEdge(g,R.validEdges(g)[0]);assert.equal(g.mode,null);assert.equal(R.piecesLeft(g,0).road,0);assert.deepEqual(g.players[0].res,before);invariant(g);
});
test('Invention takes only available bank cards; Monopoly transfers everyone’s selected type',()=>{
  let g=blank();hand(g,1,basket({wood:19,wheat:3}));g.players[0].dev=[{type:'plenty',turn:0}];g=R.playDevCard(g,'plenty');assert.equal(R.pickResource(g,'wood'),g);g=R.pickResource(g,'ore');g=R.pickResource(g,'ore');assert.equal(g.players[0].res.ore,2);invariant(g);
  g.devPlayed=false;g.players[0].dev=[{type:'monopoly',turn:0}];hand(g,2,basket({wheat:2}));g=R.pickResource(R.playDevCard(g,'monopoly'),'wheat');assert.equal(g.players[0].res.wheat,5);assert.equal(g.players[1].res.wheat,0);assert.equal(g.players[2].res.wheat,0);invariant(g);
});
test('Largest Army requires three, retains ties, transfers only to strictly larger army',()=>{
  let g=blank();
  for(const [p,knights,expected] of [[0,1,null],[0,2,0],[1,2,0],[1,3,1]]){g.cur=p;g.players[p].knights=knights;g.devPlayed=false;g.mode=null;g.players[p].dev.push({type:'knight',turn:0});g=R.playDevCard(g,'knight');assert.equal(g.army,expected);}
});
function path(g,p,start,length){const G=getGeometry(4);let v=start;const edges=[];for(let i=0;i<length;i++){const e=G.verts[v].edges.find(e=>G.edges[e].hexes.length===1&&g.roads[e]===undefined&&!edges.includes(e));edges.push(e);road(g,e,p);v=G.edges[e].a===v?G.edges[e].b:G.edges[e].a;}return {edges,end:v};}
test('Longest Road counts cycles once and opponent buildings split a route',()=>{
  const g=blank(),G=getGeometry(4),hex=G.hexes[9];for(const e of G.edges.filter(e=>e.hexes.includes(hex.id)))road(g,e.id,0);assert.equal(R.longestRoadFor(g,0),6);town(g,hex.verts[0],1);assert.equal(R.longestRoadFor(g,0),6);town(g,hex.verts[3],2);assert.equal(R.longestRoadFor(g,0),3);
});
test('Longest Road holder keeps equal tie; a broken holder cannot award a tied challenger arbitrarily',()=>{
  let g=blank(),G=getGeometry(4),start=G.coast[0].a;
  // Three disjoint paths along the coast, separated by unused edges.
  const a=path(g,0,start,7),gap1=path(g,3,a.end,1),b=path(g,1,gap1.end,6),gap2=path(g,3,b.end,1);path(g,2,gap2.end,6);
  g=R.updateAwards(g);assert.equal(g.longest,0);
  const cut=G.edges[a.edges[3]].a;town(g,cut,3);g=R.updateAwards(g);assert.equal(g.roadLens[1],6);assert.equal(g.roadLens[2],6);assert.equal(g.longest,null);
  const tied=blank();const aa=path(tied,0,start,5),gap=path(tied,3,aa.end,1);path(tied,1,gap.end,5);tied.longest=0;assert.equal(R.updateAwards(tied).longest,0);
});
for(const count of [5,6])test(`${count} players: complete paired cycle, restrictions and card aging`,()=>{
  let g=R.createGame({playerCount:count,autoSetup:true,rng:seeded(77)});
  for(let lead=0;lead<count;lead++){
    assert.equal(g.cur,lead);assert.equal(g.paired,false);assert.equal(g.phase,'roll');g=R.resolveRoll(g,[1,1]);g=R.endTurn(g);
    assert.equal(g.cur,(lead+3)%count);assert.equal(g.paired,true);assert.equal(g.phase,'main');assert.equal(R.startRoll(g),g);assert.equal(R.proposeTrade(g,basket({wood:1}),basket({ore:1})),g);
    hand(g,g.cur,basket({wood:4,wheat:1,sheep:1,ore:1}));assert.ok(R.bankTradeOk(g,{give:'wood',get:'brick'}));g=R.bankTrade(g,'wood','brick');
    g.deck.push('monopoly');g=R.buyDevCard(g);assert.equal(R.canPlayDev(g,'monopoly'),false);g=R.endTurn(g);invariant(g);
  }
  assert.equal(g.cur,0);assert.equal(g.phase,'roll');assert.ok(R.canPlayDev(g,'monopoly'),'card bought during player 2 is playable at a later player 1 turn');
});
test('win on turn entry, including hidden points; profiles remain public',()=>{
  let g=blank();g.players[1].dev=Array.from({length:4},()=>({type:'vp',turn:1}));g.longest=1;g.army=1;town(g,0,1,true);
  assert.equal(R.victoryPoints(g,1,false),6);assert.equal(R.victoryPoints(g,1,true),10);g=R.endTurn(g);assert.equal(g.winner,1);assert.equal(R.startRoll(g),g);assert.equal(R.endTurn(g),g);assert.equal(R.buyDevCard(g),g);
});
test('a newly purchased hidden point can win immediately; action-only player can win',()=>{
  let g=blank(6);g.cur=3;g.paired=true;g.players[3].dev=Array.from({length:4},()=>({type:'vp',turn:0}));g.longest=3;g.army=3;town(g,0,3);hand(g,3,basket({wheat:1,sheep:1,ore:1}));g.deck.push('vp');g=R.buyDevCard(g);assert.equal(g.winner,3);assert.equal(R.victoryPoints(g,3,false),5);
});
test('invalid actions are no-ops and valid actions leave input state unchanged',()=>{
  let g=blank();const old=structuredClone(g);assert.equal(R.placeAtEdge(g,999),g);assert.equal(R.placeAtVertex(g,999),g);assert.equal(R.playDevCard(g,'vp'),g);assert.equal(R.pickResource(g,'fake'),g);assert.deepEqual(g,old);
  hand(g,0,basket({wood:4}));const before=structuredClone(g);const next=R.bankTrade(g,'wood','ore');assert.deepEqual(g,before);assert.notEqual(next,g);invariant(next);
});
test('save validation accepts genuine games and rejects old, inconsistent or damaged saves',()=>{
  const g=R.createGame();assert.ok(R.validSavedGame(JSON.parse(JSON.stringify(g))));for(const change of [{schema:1},{playerCount:7},{bank:R.emptyRes()},{terrain:[]},{cur:99}])assert.equal(R.validSavedGame({...g,...change}),false);
});
test('same injected randomness produces identical pure game states and dice',()=>{
  assert.deepEqual(R.createGame({chooseFirst:true,playerCount:6,rng:seeded(883)}),R.createGame({chooseFirst:true,playerCount:6,rng:seeded(883)}));
  assert.deepEqual(R.rollDice(()=>0),[1,1]);assert.deepEqual(R.rollDice(()=>.999),[6,6]);
});
test('piece supplies are enforced even on a stale placement request',()=>{
  let g=blank(),G=getGeometry(4);G.edges.slice(0,15).forEach(e=>road(g,e.id,0));hand(g,0,basket({wood:5,brick:5}));g.mode='road';const e=G.edges.find(e=>R.canRoad(g,e.id,0));assert.ok(e);assert.equal(R.placeAtEdge(g,e.id),g);assert.equal(R.canBuild(g,'road'),false);
  g=blank();G.verts.slice(0,4).forEach(v=>town(g,v.id,0,true));town(g,20,0);hand(g,0,basket({ore:3,wheat:2}));g.mode='city';assert.equal(R.placeAtVertex(g,20),g);
});
test('branching roads use the longest trail, not the sum of all branches',()=>{
  const g=blank(),G=getGeometry(4),v=G.verts.find(v=>v.edges.length===3);v.edges.forEach(e=>road(g,e,0));assert.equal(R.longestRoadFor(g,0),2);
});
test('Knight victory ends immediately without requiring robber completion',()=>{
  let g=blank();town(g,0,0,true);town(g,10,0,true);town(g,20,0,true);g.longest=0;g.players[0].knights=2;g.players[0].dev=[{type:'knight',turn:0}];g=R.playDevCard(g,'knight');assert.equal(g.winner,0);assert.equal(g.mode,null);assert.equal(R.moveRobber(g,1),g);
});
test('player 1 victory stops paired play before player 2 can act',()=>{
  let g=blank(5);g.players[0].dev=Array.from({length:5},()=>({type:'vp',turn:0}));g.longest=0;g.army=0;town(g,0,0);hand(g,0,basket({wheat:2,ore:3}));g=R.placeAtVertex(R.chooseBuild(g,'city'),0);assert.equal(g.winner,0);assert.equal(R.endTurn(g),g);assert.equal(g.paired,false);
});
test('development buttons reject Road Building without pieces and Invention without bank supply',()=>{
  let g=blank();getGeometry(4).edges.slice(0,15).forEach(e=>road(g,e.id,0));g.players[0].dev=[{type:'roads',turn:0}];assert.equal(R.canPlayDev(g,'roads'),false);assert.equal(R.playDevCard(g,'roads'),g);
  g=blank();hand(g,1,Object.fromEntries(R.RES.map(r=>[r,19])));g.players[0].dev=[{type:'plenty',turn:0}];assert.equal(R.canPlayDev(g,'plenty'),false);assert.equal(R.playDevCard(g,'plenty'),g);invariant(g);
});
