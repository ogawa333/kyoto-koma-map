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
      if(result.frames[j].retainedForStraightSignal&&result.frames[j].label==='直進'&&!result.frames[j].checkpoints.length){previous=j;continue;}
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

test('Kyoto screenshot junctions at 3395/3397m have opposite side roads and must not match',()=>{
  const result=engine.generate(data,engine.orderWaypoints(data.sampleLocations,()=>0));
  const right=result.frames.find(f=>f.id==='junction:1314708603:0');
  const left=result.frames.find(f=>f.id==='junction:2090717787:0');
  assert.ok(right);assert.ok(left);assert.equal(right.branches.length,3);assert.equal(left.branches.length,3);
  assert.ok(engine.junctionSignature(right));assert.ok(engine.junctionSignature(left));
  assert.equal(engine.similarJunctions(right,left),false);
  assert.equal(engine.similarJunctions(left,right),false);
  const shown=engine.selectFrames(result.frames,'reduced');
  for(const f of shown.filter(f=>f.retentionTargetId)){
    const target=shown.find(t=>t.id===f.retentionTargetId);assert.ok(target);
    assert.equal(target.number,f.retentionTargetNumber);assert.ok(target.at>f.at);
    assert.equal(engine.similarJunctions(f,target),true);
  }
});

test('former Kyoto frame 091 may be omitted while the Shiokoji route remains unchanged',()=>{
  const result=engine.generate(data,engine.orderWaypoints(data.sampleLocations,()=>.999));
  const frame=result.frames.find(f=>f.id==='junction:5140799169:0');assert.ok(frame);
  assert.equal(Math.round(frame.at),5055);assert.equal(frame.label,'直進');assert.equal(frame.canOmit,true);
  const selected=engine.selectFrames(result.frames,'reduced');
  assert.equal(selected.some(f=>f.id===frame.id),false);
  assert.equal(engine.selectFrames(result.frames,'all').some(f=>f.id===frame.id),true);
  assert.equal(Math.round(result.distance),5776);
});

test('1766m straight signal remains visible without restoring earlier lookalikes for it',()=>{
  for(const random of [()=>0,()=>.999]){
    const result=engine.generate(data,engine.orderWaypoints(data.sampleLocations,random));
    const id='junction:8288264257:0',signal=result.frames.find(f=>f.id===id);assert.ok(signal);
    assert.equal(signal.label,'直進');assert.equal(signal.canOmit,false);assert.equal(signal.retainedForStraightSignal,true);
    const selected=engine.selectFrames(result.frames,'reduced');assert.ok(selected.some(f=>f.id===id));
    assert.equal(selected.some(f=>f.retentionTargetId===id),false);
  }
});
test('the real Kyoto evaluation set includes both rule classes and excludes protected candidates',()=>{
  const evaluation=require('../site/evaluation-core.js');
  const result=engine.generate(data,engine.orderWaypoints(data.sampleLocations,()=>.999));
  const course={result:{...result,allFrames:result.frames,name:'京都評価セット'},edits:{}};
  const dataset=evaluation.buildDataset(course,{id:'kyoto-real-evaluation'});evaluation.validateDataset(dataset);
  assert.ok(dataset.pairs.some(p=>p.rulePrediction==='keep'));assert.ok(dataset.pairs.some(p=>p.rulePrediction==='omit'));
  for(const pair of dataset.pairs){
    const index=result.frames.findIndex(f=>f.id===pair.context.candidateId),target=result.frames.find(f=>f.id===pair.context.targetId);
    assert.equal(engine.baseFrameIsRequired(result.frames[index],index,result.frames.length),false);
    assert.equal(engine.skipSimilarityTarget(target),false);
    assert.equal(Object.hasOwn(pair.modelInput.candidate,'routeOut'),false);
  }
});
test('two genuine Kyoto visit orders provide 100 distinct evaluation pairs while retaining answers',()=>{
  const api=require('../site/evaluation-core.js');
  function make(random,id){const result=engine.generate(data,engine.orderWaypoints(data.sampleLocations,random));return api.buildDataset({result:{...result,allFrames:result.frames,name:'京都評価セット'},edits:{}},{id,createdAt:'2026-11-09T00:00:00Z'});}
  let base=make(()=>.999,'old-evaluation-set');assert.equal(base.pairs.length,74);
  base=api.saveResponse(base,{pairId:base.pairs[0].id,evaluatorId:'P001',role:'participant',choice:'borderline',notes:'既存の回答',activeViewMs:1000,decisionMs:900,updatedAt:'2026-11-09T01:00:00Z'});
  const expanded=api.extendDataset(base,make(()=>0,'other-route'),{count:100,courseId:'route-B',name:'京都・別訪問順'});
  assert.equal(expanded.pairs.length,100);assert.equal(new Set(expanded.pairs.map(p=>JSON.stringify(p.splitGroups))).size,100);
  assert.deepEqual(expanded.pairs.slice(0,74),base.pairs);assert.deepEqual(expanded.responses,base.responses);
  assert.ok(expanded.pairs.some(p=>p.rulePrediction==='keep'));assert.ok(expanded.pairs.some(p=>p.rulePrediction==='omit'));
});
