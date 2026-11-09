const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../site/routing.js');
global.window={};require('../site/data/kyoto-network.js');const data=global.window.KYOTO_NETWORK;delete global.window;
test('bundled Kyoto data has actual roads and five street-side checkpoints',()=>{
  assert.ok(data.nodes.length>1000);assert.ok(data.ways.length>1000);
  assert.equal(data.source,'https://api.openstreetmap.org/api/0.6/map');
  assert.equal(data.sampleLocations.length,7);assert.equal(data.sampleLocations.filter(p=>p.checkpoint).length,5);
  assert.ok(data.sampleLocations.every(p=>p.lat>=data.bounds.south&&p.lat<=data.bounds.north&&p.lon>=data.bounds.west&&p.lon<=data.bounds.east));
  const ids=new Set(data.nodes.map(p=>p.id));assert.ok(data.ways.every(w=>w.nodes.every(id=>ids.has(id))));
});
test('temples and park references resolve to religious/park objects, not same-name stations',()=>{
  for(const name of ['東本願寺','西本願寺','東寺']){
    const ref=data.sampleReferences.find(p=>p.name===name);assert.ok(ref);
    assert.equal(data.places.find(p=>p.id===ref.id).tags.amenity,'place_of_worship');
  }
  const park=data.sampleReferences.find(p=>p.name==='梅小路公園');
  assert.equal(data.places.find(p=>p.id===park.id).tags.leisure,'park');
});
test('both Kyoto tail orders generate connected routes, retain CP5 and avoid ambiguous omissions',()=>{
  for(const random of [()=>0,()=>.999]){
    const ordered=engine.orderWaypoints(data.sampleLocations,random),result=engine.generate(data,ordered);
    assert.ok(result.distance>5000&&result.distance<7000);assert.ok(result.snapped.every(p=>p.offset<40));
    const selected=engine.selectFrames(result.frames,'reduced'),keep=new Set(selected.map(p=>p.id));
    assert.equal(selected.flatMap(f=>f.checkpoints).length+result.unassignedCheckpoints.length,5);
    assert.ok(selected.length<result.frames.length);let previous=0;
    for(let j=1;j<result.frames.length;j++){
      if(!keep.has(result.frames[j].id))continue;
      for(let i=previous+1;i<j;i++)assert.equal(engine.similarJunctions(result.frames[i],result.frames[j]),false);
      previous=j;
    }
  }
});
test('area polygons are not treated as perimeter roads',()=>{
  const nodes=[{id:1,lat:35,lon:135},{id:2,lat:35.001,lon:135},{id:3,lat:35,lon:135.001}];
  const g=engine.graph({nodes,ways:[{id:1,nodes:[1,2,3,1],tags:{highway:'pedestrian',area:'yes'}}]});
  assert.equal(g.adj.size,0);assert.equal(g.visual.size,0);
});
