const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../site/evaluation-core.js'),routing=require('../site/routing.js');
const second=require('../site/data/evaluation-set-02.json'),third=require('../site/data/evaluation-set-03.json');
test('built-in additional sets are valid, contain 100 unique unanswered pairs and retain their original IDs',()=>{
  assert.equal(second.id,'50b2bef2-face-4e6a-9085-6a14026b5cde');
  assert.equal(third.id,'88924b4c-094f-4b42-925a-08aec0f6a121');
  for(const dataset of [second,third]){
    api.validateDataset(dataset);assert.equal(dataset.pairs.length,100);assert.deepEqual(dataset.responses,[]);
    assert.equal(new Set(dataset.pairs.map(p=>JSON.stringify(p.splitGroups))).size,100);
  }
});
test('additional sets share no physical junction IDs or centers within 12 meters',()=>{
  const ids=new Set(second.pairs.flatMap(p=>p.splitGroups));
  const centers=second.pairs.flatMap(p=>[p.modelInput.candidate.center,p.modelInput.target.center]);
  for(const p of third.pairs){
    assert(!p.splitGroups.some(g=>ids.has(g)));
    for(const c of [p.modelInput.candidate.center,p.modelInput.target.center])assert(centers.every(old=>routing.distance(c,old)>12));
  }
});
