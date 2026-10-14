// Shared topology for both islands. Coordinates are hex radii, pointy side up.
export const SQ3 = Math.sqrt(3);
export const HARBOR_TYPES = ['any', 'wheat', 'any', 'ore', 'sheep', 'any', 'any', 'brick', 'wood'];
function buildGeometry(expanded) {
  const rows = expanded ? [3,4,5,6,5,4,3] : [3,4,5,4,3];
  const hexes=[], verts=[], edges=[], vk=new Map(), ek=new Map();
  rows.forEach((n,row)=>{ for(let j=0;j<n;j++) hexes.push({id:hexes.length,x:(j-(n-1)/2)*SQ3,y:(row-(rows.length-1)/2)*1.5,verts:[]}); });
  for(const h of hexes){
    for(let k=0;k<6;k++){
      const a=(60*k-90)*Math.PI/180, x=h.x+Math.cos(a), y=h.y+Math.sin(a), key=`${Math.round(x*100)},${Math.round(y*100)}`;
      if(!vk.has(key)){vk.set(key,verts.length);verts.push({id:verts.length,x,y,hexes:[],adj:[],edges:[]});}
      const v=verts[vk.get(key)];v.hexes.push(h.id);h.verts.push(v.id);
    }
    for(let k=0;k<6;k++){
      const a=h.verts[k],b=h.verts[(k+1)%6], key=[a,b].sort((x,y)=>x-y).join('-');
      if(!ek.has(key)){
        const va=verts[a],vb=verts[b],id=edges.length;ek.set(key,id);
        edges.push({id,a,b,x:(va.x+vb.x)/2,y:(va.y+vb.y)/2,angle:Math.atan2(vb.y-va.y,vb.x-va.x)*180/Math.PI,hexes:[]});
        va.adj.push(b);vb.adj.push(a);va.edges.push(id);vb.edges.push(id);
      }edges[ek.get(key)].hexes.push(h.id);
    }
  }
  const neighbors=hexes.map(()=>[]);
  for(const e of edges) if(e.hexes.length===2){neighbors[e.hexes[0]].push(e.hexes[1]);neighbors[e.hexes[1]].push(e.hexes[0]);}
  const coast=edges.filter(e=>e.hexes.length===1).sort((a,b)=>Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x));
  const types=expanded?[...HARBOR_TYPES,'any','sheep']:HARBOR_TYPES;
  const harbors=types.map((type,i)=>{
    const e=coast[Math.floor(i*coast.length/types.length+1)%coast.length],h=hexes[e.hexes[0]],dx=e.x-h.x,dy=e.y-h.y,d=Math.hypot(dx,dy);
    return {id:i,type,edge:e.id,verts:[e.a,e.b],x:e.x+dx/d*.72,y:e.y+dy/d*.72};
  });
  // Peel rings counterclockwise, starting at their upper-right corner.
  const spiral=[],remaining=new Set(hexes.map(h=>h.id));
  while(remaining.size){
    const ring=hexes.filter(h=>remaining.has(h.id)&&neighbors[h.id].filter(n=>remaining.has(n)).length<6);
    const start=ring.slice().sort((a,b)=>a.y-b.y||b.x-a.x)[0],angle=Math.atan2(start.y,start.x);
    const sweep=h=>(angle-Math.atan2(h.y,h.x)+Math.PI*4)%(Math.PI*2);
    ring.sort((a,b)=>sweep(a)-sweep(b));
    for(const h of ring){spiral.push(h.id);remaining.delete(h.id);}
  }
  const width=expanded?12.8:11, height=expanded?13.2:10.2;
  return {hexes,verts,edges,neighbors,coast,harbors,spiral,width,height,rows};
}
export const GEO=buildGeometry(false);
export const EXPANDED_GEO=buildGeometry(true);
export const getGeometry=count=>count>4?EXPANDED_GEO:GEO;
export const pctX=(x,geo=GEO)=>(x/geo.width+.5)*100;
export const pctY=(y,geo=GEO)=>(y/geo.height+.5)*100;
export const pctW=(n,geo=GEO)=>n/geo.width*100;
