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
const fourth=require('../site/data/evaluation-set-04.json'),fifth=require('../site/data/evaluation-set-05.json');
const provenance=require('../site/data/evaluation-miura-source.json');
test('Miura sets have 100 unanswered genuine mainland pairs and matching provenance',()=>{
  const b=provenance.bounds;
  for(const [index,d] of [fourth,fifth].entries()){
    api.validateDataset(d);assert.equal(d.pairs.length,100);assert.deepEqual(d.responses,[]);
    assert.equal(new Set(d.pairs.map(p=>JSON.stringify(p.splitGroups))).size,100);
    assert.equal(d.id,provenance.sets[index].id);assert.equal(d.source.sourceDate,provenance.sourceDate);
    assert.match(d.source.courseName,/三浦・三崎港周辺/);
    for(const p of d.pairs)for(const f of [p.modelInput.candidate,p.modelInput.target]){
      for(const point of [f.center,...f.branches.flat()])assert(point.lat>=b.south&&point.lat<=b.north&&point.lon>=b.west&&point.lon<=b.east);
    }
  }
});
test('Miura sets have no shared intersections or endpoints within 12m with each other or Kyoto sets',()=>{
  const pairs=[fourth.pairs,fifth.pairs,second.pairs,third.pairs];
  for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){
    const ids=new Set(pairs[i].flatMap(p=>p.splitGroups));
    const points=pairs[i].flatMap(p=>[p.modelInput.candidate.center,p.modelInput.target.center]);
    for(const p of pairs[j]){
      assert(!p.splitGroups.some(g=>ids.has(g)));
      for(const point of [p.modelInput.candidate.center,p.modelInput.target.center])assert(points.every(old=>routing.distance(point,old)>12));
    }
  }
});
