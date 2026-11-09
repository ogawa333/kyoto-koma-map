// Prepare street-side sample points from real OSM landmarks, then validate both tail orders.
const fs=require('node:fs'),path=require('node:path');
const engine=require('../site/routing.js');
const file=path.join(__dirname,'../site/data/kyoto-network.js');
global.window={};require(file);const data=window.KYOTO_NETWORK;
if(!data?.ways?.length)throw new Error('Run python3 scripts/fetch_osm.py before preparing the sample.');
const graph=engine.graph(data),visited=new Set();let largest=new Set();
for(const start of graph.adj.keys()){
  if(visited.has(start))continue;
  const component=new Set(),queue=[start];visited.add(start);
  for(let i=0;i<queue.length;i++){
    const id=queue[i];component.add(id);
    for(const e of graph.adj.get(id)||[])if(!visited.has(e.to)){visited.add(e.to);queue.push(e.to);}
  }
  if(component.size>largest.size)largest=component;
}
function landmark(names,accept){
  const candidates=data.places.filter(accept);
  for(const name of names){const exact=candidates.find(p=>p.name===name);if(exact)return exact;}
  for(const name of names){const partial=candidates.find(p=>p.name.includes(name));if(partial)return partial;}
  throw new Error('OSM landmark missing: '+names.join(' / '));
}
function streetPoint(names,checkpoint,accept=()=>true){
  const p=landmark(names,accept);let best;
  for(const [a,edges] of graph.adj){
    if(!largest.has(a))continue;
    for(const e of edges){
      // Use through streets, rather than points inside a temple, park or station.
      if(!/^(residential|living_street|unclassified|tertiary|secondary|primary|pedestrian)$/.test(e.way.tags.highway))continue;
      const projected=engine.project(p,graph.nodes.get(a),graph.nodes.get(e.to));
      if(!best||projected.distance<best.distance)best={...projected,way:e.way};
    }
  }
  if(!best||best.distance>400)throw new Error('No suitable nearby street for '+p.name);
  if(best.point.lat<data.bounds.south||best.point.lat>data.bounds.north||best.point.lon<data.bounds.west||best.point.lon>data.bounds.east)throw new Error('Sample point outside extract: '+p.name);
  return {location:{name:p.name+'付近（道路上）',...best.point,...(checkpoint?{checkpoint:true,mission:'安全な場所から周囲を観察し、この場所の特徴を1つ記録しよう。'}:{})},reference:{id:p.id,name:p.name,lat:p.lat,lon:p.lon,streetWay:best.way.id,offsetMeters:best.distance}};
}
const start=streetPoint(['京都タワー','ニデック京都タワー'],false);
const worship=p=>p.tags?.amenity==='place_of_worship';
const checkpoints=[
  streetPoint(['東本願寺'],true,worship),
  streetPoint(['西本願寺'],true,worship),
  streetPoint(['渉成園'],true,p=>p.tags?.leisure==='garden'),
  streetPoint(['梅小路公園'],true,p=>p.tags?.leisure==='park'),
  streetPoint(['東寺','教王護国寺'],true,worship)
];
const locations=[start.location,...checkpoints.map(p=>p.location),{...start.location,name:'京都駅北側（ゴール）'}];
const stats=[];
for(const random of [()=>0,()=>.999]){
  const ordered=engine.orderWaypoints(locations,random),result=engine.generate(data,ordered);
  const selected=engine.selectFrames(result.frames,'reduced');
  const cp=result.frames.flatMap(f=>f.checkpoints).length+result.unassignedCheckpoints.length;
  if(cp!==5||!result.frames.length||result.snapped.some(p=>p.offset>40))throw new Error('Sample route failed readiness checks');
  stats.push({distanceMeters:Math.round(result.distance),allFrames:result.frames.length,displayedFrames:selected.length});
}
data.sampleLocations=locations;data.sampleReferences=[start,...checkpoints].map(p=>p.reference);data.sampleValidation=stats;
const temporary=file+'.tmp';fs.writeFileSync(temporary,'window.KYOTO_NETWORK = '+JSON.stringify(data)+';\n');fs.renameSync(temporary,file);
console.log(JSON.stringify({locations:locations.map(p=>p.name),validation:stats},null,2));
