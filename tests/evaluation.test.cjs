const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../site/evaluation-core.js'),diagram=require('../site/diagram.js');
function frame(id,at,canOmit,angles=[180,0,90]){
  const center={lat:35,lon:135};
  const p=(degrees,meters)=>({lat:35+Math.cos(degrees*Math.PI/180)*meters/111320,lon:135+Math.sin(degrees*Math.PI/180)*meters/111320/Math.cos(35*Math.PI/180)});
  return {id:'junction:'+id+':0',at,canOmit,label:'直進',center,heading:0,branches:angles.map(a=>[center,p(a,28)]),routeIn:[p(180,24),center],routeOut:[center,p(0,24)],checkpoints:[]};
}
function course(){const frames=[frame(0,0,false),frame(1,100,true),frame(2,200,true,[180,0,-90]),frame(3,300,false)];return {result:{name:'評価テスト',generationVersion:9,sourceDate:'2026-11-09T00:00:00Z',allFrames:frames},edits:{}};}
const build=c=>api.buildDataset(c||course(),{id:'dataset-test',createdAt:'2026-11-09T00:00:00Z'});
function answer(d,index,choice,evaluatorId='P001',extra={}){return api.saveResponse(d,{pairId:d.pairs[index].id,evaluatorId,role:'participant',choice,notes:'比較した理由',activeViewMs:4000,decisionMs:2500,updatedAt:'2026-11-09T01:00:00Z',...extra});}
test('build includes both rule positives and negatives, with no candidate answer or images',()=>{
  const c=course();c.result.settings={apiKey:'DO-NOT-EXPORT'};c.edits[c.result.allFrames[0].id]={images:{x:'PRIVATE-PHOTO'}};
  const d=build(c);assert.equal(d.pairs.length,2);assert.deepEqual(d.pairs.map(p=>p.rulePrediction),['keep','omit']);
  assert.deepEqual(Object.keys(d.pairs[0].modelInput.candidate).sort(),['branches','center','heading']);
  assert.ok(d.pairs[0].modelInput.target.routeOut.length);const json=JSON.stringify(d);assert.ok(!json.includes('DO-NOT-EXPORT'));assert.ok(!json.includes('PRIVATE-PHOTO'));api.validateDataset(d);
});
test('mandatory edits/CP and straight-signal target exclusions use the shared navigation policy',()=>{
  const c=course();c.result.allFrames[1].checkpoints=[{name:'CP'}];assert.equal(build(c).pairs.length,1);
  const edited=course();edited.edits[edited.result.allFrames[1].id]={note:'確認'};assert.equal(build(edited).pairs.length,1);
  const signal=course();signal.result.allFrames[3].retainedForStraightSignal=true;assert.throws(()=>build(signal),/評価可能/);
});
test('dirty, old, missing and malformed courses cannot produce a misleading dataset',()=>{
  assert.throws(()=>api.buildDataset(null,{id:'x'}),/コマ地図/);
  assert.throws(()=>build({...course(),dirty:true}),/変更中/);
  const c=course();c.result.generationVersion=8;assert.throws(()=>build(c),/更新/);
  c.result.generationVersion=9;c.result.allFrames[1].center.lat=NaN;assert.throws(()=>build(c),/読み取れません/);
});
test('borderline is an omit label; uncertainty is unlabelled with keep recommendation',()=>{
  let d=answer(build(),0,'borderline');d=answer(d,1,'uncertain');
  assert.equal(d.responses[0].trainingLabel,'omit');assert.equal(d.responses[1].trainingLabel,null);assert.equal(d.responses[1].retentionRecommendation,'keep');
});
test('rule comparison metrics count false omissions and unnecessary keeps separately',()=>{
  let d=answer(build(),0,'clear');d=answer(d,1,'indistinguishable');d=answer(d,1,'borderline','P002');d=answer(d,0,'uncertain','P002');d=answer(d,0,'indistinguishable','P003');
  const s=api.summary(d);assert.equal(s.responses,5);assert.equal(s.evaluated,4);assert.equal(s.uncertain,1);assert.equal(s.falseOmit,1);assert.equal(s.unnecessaryKeep,1);assert.equal(s.accuracy,.5);assert.equal(s.falseOmissionRate,.5);assert.equal(s.omissionPrecision,.5);assert.equal(s.borderlineOmissionRate,1);
  assert.equal(api.summary(d,'P001').evaluated,2);assert.equal(api.summary(build()).accuracy,null);
});
test('revisions replace only the same evaluator and pair',()=>{
  let d=answer(build(),0,'clear');d=answer(d,0,'indistinguishable');d=answer(d,0,'clear','P002');assert.equal(d.responses.length,2);assert.equal(d.responses[0].revision,2);assert.equal(d.responses[0].choice,'indistinguishable');
});
test('export round trip and distinct-evaluator merging do not overwrite answers',()=>{
  const first=answer(build(),0,'clear'),exported=api.exportDataset(first);api.validateDataset(exported);
  assert.equal(api.mergeDatasets(first,exported).responses.length,1);
  const second=answer(build(),1,'borderline','P002'),merged=api.mergeDatasets(first,api.exportDataset(second));assert.equal(merged.responses.length,2);assert.equal(first.responses.length,1);
  assert.throws(()=>api.mergeDatasets(first,answer(build(),0,'indistinguishable')),/競合/);
  const changed=build();changed.pairs[0].modelInput.target.heading=.1;assert.throws(()=>api.mergeDatasets(first,changed),/異なります/);
});
test('invalid imports reject duplicate/unknown pairs, answer labels, times, photos and leaked route arrows',()=>{
  const variations=[d=>d.pairs.push(structuredClone(d.pairs[0])),d=>d.pairs[0].modelInput.candidate.routeOut=[],d=>d.pairs[0].modelInput.target.apiKey='bad',d=>d.credentials='bad',d=>d.responses[0].choice='__proto__',d=>d.responses[0].decisionMs=5000,d=>d.responses[0].pairId='missing',d=>d.responses.push(structuredClone(d.responses[0]))];
  for(const modify of variations){const d=answer(build(),0,'clear');modify(d);assert.throws(()=>api.validateDataset(d));}
});
test('rule-viewing after an initial answer does not erase it, but informed revisions leave baseline scoring',()=>{
  let d=answer(build(),0,'clear');d.responses[0].ruleViewedAt='2026-11-09T01:01:00Z';
  assert.equal(api.summary(d).evaluated,1);
  d=answer(d,0,'indistinguishable','P001',{ruleViewedAt:'2026-11-09T01:01:00Z',updatedAt:'2026-11-09T01:02:00Z'});
  assert.equal(api.summary(d).evaluated,0);assert.equal(api.summary(d).unblinded,1);assert.equal(api.exportDataset(d).responses[0].blindAtDecision,false);
});
test('candidate rendering omits every arrow and route highlight; target rendering includes the instruction',()=>{
  const f=frame(1,100,true),candidate=diagram.render(f,false),target=diagram.render(f,true);
  assert.ok(!candidate.includes('marker-end'));assert.ok(!candidate.includes('evaluation-route'));assert.ok(target.includes('marker-end'));
  const q=diagram.geometry(f).point(f.routeOut.at(-1));assert.ok(Math.abs(q.x-110)<.01);assert.ok(Math.abs(q.y-(105-24*2.6))<.1);
});
test('physical groups are stable across repeat visits to the same OSM node',()=>{
  const c=course();c.result.allFrames[2].id='junction:1:1';const d=build(c);
  assert.equal(d.pairs[0].splitGroups[0],d.pairs[1].splitGroups[0]);
});
