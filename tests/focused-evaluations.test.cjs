const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const engine=require('../site/routing.js'),api=require('../site/evaluation-core.js');
const {pairFeatures,profiles,selectSets,DEFAULT_QUOTAS,touches}=require('../scripts/focused_evaluation.cjs');
function frame(angles,length=28,lat=35){const center={lat,lon:139.62};return {center,heading:0,branches:angles.map(a=>[center,{lat:lat+Math.cos(a*Math.PI/180)*length/111320,lon:139.62+Math.sin(a*Math.PI/180)*length/111320/Math.cos(lat*Math.PI/180)}])};}
function pair(index,a=[180,0,90],b=[180,0,65],length=28){return {splitGroups:['node:'+index+':a','node:'+index+':b'],rulePrediction:'omit',modelInput:{candidate:frame(a,length,35+index*.01),target:frame(b,length,35+index*.01+.001)}};}
test('mining separates short/long angle-boundary examples and mirror/count controls without labels',()=>{
 assert(profiles['short-boundary'](pairFeatures(pair(1,undefined,undefined,4))));
 assert(profiles['long-boundary'](pairFeatures(pair(1))));
 const mirrored=pairFeatures(pair(1,[180,0,90],[180,0,-90]));assert(profiles['mirror-control'](mirrored));assert(mirrored.angle>45&&mirrored.mirrorAngle<.01);
 const extra=pairFeatures(pair(1,[180,0,90],[180,0,90,-90],4));assert(profiles['count-connection'](extra));assert.equal(extra.sameCount,false);
});
test('selection is deterministic and independent of machine predictions and input ordering',()=>{
 const pool=Array.from({length:12},(_,i)=>pair(i,[180,0,90],[180,0,90]));
 const options={quotas:{'near-control':2}},first=selectSets(pool,options);
 const changed=structuredClone(pool).reverse();for(const p of changed){p.rulePrediction='keep';p.responses=[{choice:'indistinguishable'}];}
 assert.deepEqual(selectSets(changed,options).map(s=>s.rows.map(r=>r.pair.splitGroups)),first.map(s=>s.rows.map(r=>r.pair.splitGroups)));
 assert(first.every(s=>s.rows.length===2));assert(first[0].rows.every(a=>first[1].rows.every(b=>!touches(a.pair,b.pair))));
 assert.throws(()=>selectSets([pool[0]],options),/不足/);
});
test('built-in VI/VII contain 100 unanswered, stratified real Miura pairs with correct current predictions',()=>{
 const source=require('../site/data/evaluation-miura-focused-source.json');
 assert.equal(source.sourceExtractProvenance,'evaluation-miura-source.json');assert.equal(source.exclusionInputs.reduce((n,d)=>n+d.pairs,0),500);
 for(const [index,number]of [6,7].entries()){
   const file='../site/data/evaluation-set-0'+number+'.json',d=require(file),entry=source.sets[index];api.validateDataset(d);
   assert.equal(d.id,entry.id);assert.equal(d.pairs.length,100);assert.deepEqual(d.responses,[]);assert.equal(d.source.generationVersion,source.generationVersion);assert.equal(d.source.ruleVersion,source.ruleVersion);
   assert.equal(new Set(d.pairs.map(p=>JSON.stringify([...p.splitGroups].sort()))).size,100);
   const counts={};for(const item of entry.items){counts[item.category]=(counts[item.category]||0)+1;const p=d.pairs.find(p=>p.id===item.pairId);assert(p);assert(profiles[item.category](pairFeatures(p)));if(d.source.ruleVersion===engine.RULE_VERSION)assert.equal(p.rulePrediction,engine.similarJunctions(p.modelInput.candidate,p.modelInput.target)?'keep':'omit');
     assert(p.context.targetAt>p.context.candidateAt);assert(p.modelInput.target.routeOut.length>=2);
     assert(p.splitGroups.every(g=>/^osm-node:\d+$/.test(g)));
     for(const f of Object.values(p.modelInput))for(const point of [f.center,...f.branches.flat()])assert(point.lat>=source.bounds.south&&point.lat<=source.bounds.north&&point.lon>=source.bounds.west&&point.lon<=source.bounds.east);
   }
   assert.deepEqual(counts,DEFAULT_QUOTAS);assert(entry.componentSizes.length>=20);assert(Math.max(...entry.componentSizes)<=8);
   assert(entry.items.filter(i=>i.geometry.minLength>=20).length>=20);
 }
});
test('new sets share no junctions or centers within 12m with each other or any of the previous 500 pairs',()=>{
 const six=require('../site/data/evaluation-set-06.json'),seven=require('../site/data/evaluation-set-07.json'),source=require('../site/data/evaluation-miura-focused-source.json');
 for(const d of [six,seven])for(const p of d.pairs){
   for(const [i,key]of ['candidate','target'].entries())for(const old of source.excludedJunctions){assert.notEqual(p.splitGroups[i],old.group);assert(engine.distance(p.modelInput[key].center,old.center)>12);}
 }
 for(const a of six.pairs)for(const b of seven.pairs)assert(!touches(a,b));
 // Verify the catalog really includes all public earlier sets, rather than merely
 // trusting a declaration that the generator excluded them.
 for(const number of [2,3,4,5]){const d=require('../site/data/evaluation-set-0'+number+'.json');for(const p of d.pairs)for(const [i,key]of ['candidate','target'].entries())assert(source.excludedJunctions.some(old=>old.group===p.splitGroups[i]&&engine.distance(old.center,p.modelInput[key].center)<.001));}
 for(const input of source.exclusionInputs.filter(input=>input.id!=='92d7a73c-39e5-4da3-aeaf-499d9e1b6e8e')){const number=[2,3,4,5].find(n=>require('../site/data/evaluation-set-0'+n+'.json').id===input.id);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../site/data/evaluation-set-0'+number+'.json'))).digest('hex'),input.sha256);}
});
