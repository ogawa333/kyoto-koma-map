const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeSet}=require('../scripts/create_ai_evaluation.cjs');
const api=require('../site/evaluation-core.js'),routing=require('../site/routing.js');
test('new genuine route sets are importable, unanswered and exclude prior physical intersections',()=>{
  const first=makeSet({count:4,seed:43});
  const second=makeSet({exclude:[first],count:4,seed:44});
  for(const d of [first,second]){
    api.validateDataset(d);assert.equal(d.responses.length,0);assert.equal(d.pairs.length,4);
    assert.equal(new Set(d.pairs.map(p=>JSON.stringify(p.splitGroups))).size,4);
  }
  for(const a of first.pairs)for(const b of second.pairs){
    assert(!a.splitGroups.some(g=>b.splitGroups.includes(g)));
    for(const u of [a.modelInput.candidate.center,a.modelInput.target.center])
      for(const v of [b.modelInput.candidate.center,b.modelInput.target.center])assert(routing.distance(u,v)>12);
  }
});
test('generator accepts a supplied regional network rather than substituting Kyoto roads',()=>{
  const nodes=[],ways=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)nodes.push({id:y*8+x+1,lat:35.14+y*.0003,lon:139.62+x*.0003});
  for(let y=0;y<8;y++)ways.push({id:y+1,nodes:Array.from({length:8},(_,x)=>y*8+x+1),tags:{highway:'residential',name:'横道'+y}});
  for(let x=0;x<8;x++)ways.push({id:100+x,nodes:Array.from({length:8},(_,y)=>y*8+x+1),tags:{highway:'residential',name:'縦道'+x}});
  const networkData={nodes,ways,places:[],signs:[],context:[],timestamp:'2026-11-03T00:00:00Z'};
  const result=makeSet({networkData,regionName:'三浦テスト',count:4,seed:45});
  api.validateDataset(result);assert.match(result.source.courseName,/^三浦テスト/);
  assert.equal(result.source.sourceDate,networkData.timestamp);
  assert(result.pairs.every(p=>p.modelInput.candidate.center.lon>=139.62&&p.modelInput.target.center.lon>=139.62));
});
