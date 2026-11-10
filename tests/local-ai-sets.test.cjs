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
