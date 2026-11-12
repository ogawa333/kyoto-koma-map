const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../source/site/routing.js'),{prepare}=require('../runtime/geometry.cjs'),{selectFrames}=require('../runtime/select-frames.cjs');
const {compatibilityGraph,frameFromCandidate}=require('../integration/target-adapter.cjs');
function frame(id,angles=[180,0,90]){const center={lat:35,lon:135};return {id,at:Number(id)*50,heading:0,center,canOmit:true,label:'直進',branches:angles.map(a=>[center,{lat:35+Math.cos(a*Math.PI/180)*28/111320,lon:135+Math.sin(a*Math.PI/180)*28/111320/Math.cos(35*Math.PI/180)}]),incomingBranchIndex:0};}
test('pair order does not mirror left and right',()=>{
 assert.equal(prepare({candidate:frame('0'),target:frame('1'),entryIndex:0,targetEntryIndex:0}).rule,'keep');
 assert.equal(prepare({candidate:frame('0'),target:frame('1',[180,0,-90]),entryIndex:0,targetEntryIndex:0}).rule,'omit');
 assert.throws(()=>prepare({candidate:{},target:frame('1')}));
});
test('all/rule modes reuse original selector exactly',async()=>{
 const frames=[frame('0'),frame('1'),frame('2')];
 assert.deepEqual(await selectFrames(frames,{mode:'rule'}),engine.selectFrames(frames,'reduced'));
 assert.deepEqual(await selectFrames(frames),engine.selectFrames(frames,'all'));
});
test('AI never removes mandatory or current-rule-retained cards',async()=>{
 const frames=[frame('0'),frame('1'),frame('2')];let calls=0;
 const out=await selectFrames(frames,{mode:'hybrid-experimental',scorePair:async()=>{calls++;return {decision:'omit'}}});
 assert.equal(out.length,3);assert.equal(calls,0);
 frames[1].checkpoints=[{number:1}];assert.equal((await selectFrames(frames,{mode:'hybrid-experimental',scorePair:async()=>({decision:'omit'})})).length,3);
});
test('AI can restore geometry guard and errors retain the card',async()=>{
 const frames=[frame('0'),frame('1',[180,0,60]),frame('2')];
 assert.equal((await selectFrames(frames,{mode:'rule'})).length,2);
 for(const callback of [async()=>({decision:'keep',reason:'ai-geometry-guard'}),async()=>{throw Error('unavailable')}]){
  const out=await selectFrames(frames,{mode:'hybrid-experimental',scorePair:callback});assert.equal(out.length,3);assert.equal(out[1].retentionTargetNumber,3);
 }
 const out=await selectFrames(frames,{mode:'hybrid-experimental',scorePair:async()=>({decision:'omit'})});assert.equal(out.length,2);
});
test('straight signal remains displayed without restoring earlier lookalikes',async()=>{
 const frames=[frame('0'),frame('1'),frame('2'),frame('3',[180,0,-90])];frames[2].canOmit=false;frames[2].retainedForStraightSignal=true;
 const out=await selectFrames(frames,{mode:'hybrid-experimental',scorePair:async()=>{throw Error('not called')}});
 assert.deepEqual(out.map(x=>x.id),['0','2','3']);
});
test('target adapter recomputes source geometry at 28m and actual 8m approach',()=>{
 const c={id:1,lat:35,lon:135},nodes=[c,{id:2,lat:34.9995,lon:135},{id:3,lat:35.0005,lon:135},{id:4,lat:35,lon:135.0005}];
 const graph={nodes:new Map(nodes.map(n=>[n.id,n])),ways:new Map([2,3,4].map(i=>[i,{id:i,nodes:[1,i],tags:{highway:'residential'}}]))};
 const g=compatibilityGraph(graph),f=frameFromCandidate(g,{nodeId:1,pathIndex:1,arrival:{neighborNodeId:2},branches:[2,3,4].map(neighborNodeId=>({neighborNodeId})),metersFromStart:50},[c,nodes[1]]);
 assert(Math.abs(f.heading)<1e-10);assert.equal(f.branches.length,3);assert.equal(g.visual.get(1)[f.incomingBranchIndex].to,2);
 assert(f.branches.every(b=>Math.abs(engine.distance(b[0],b.at(-1))-28)<.01));
});
test('JavaScript forest uses float32 features and matches all golden scores',()=>{
 const golden=require('./golden.json'),model=require('../models/corrected-candidate/model.json'),{keepScore}=require('../runtime/forest.cjs');
 for(const e of golden)assert(Math.abs(keepScore(model,e.features)-e.keepScore)<1e-12);
});
