const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const api=require('../site/evaluation-core.js'),engine=require('../site/routing.js');
const d=require('../site/data/evaluation-set-08.json'),source=require('../site/data/evaluation-set-08-source.json');
test('final test VIII is unanswered, physically disjoint and requires a known arrival branch',()=>{
 api.validateDataset(d);assert.equal(d.id,source.id);assert.equal(d.pairs.length,100);assert.deepEqual(d.responses,[]);assert.equal(source.predictionsViewed,false);assert.equal(source.humanAnswers,0);
 assert.equal(source.priorDatasets.reduce((n,s)=>n+s.pairs,0),700);assert.equal(new Set(d.pairs.map(p=>JSON.stringify([...p.splitGroups].sort()))).size,100);
 assert.match(source.frozenModelSha256,/^[a-f0-9]{64}$/);
 assert.equal(source.frozenModelSha256,require('../docs/junction-ablation-summary.json').frozenModelSha256);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../site/data/evaluation-set-08.json'))).digest('hex'),source.datasetSha256);
 const uses=new Map();
 for(const p of d.pairs){assert(Number.isInteger(p.context.candidateIncomingBranch));assert(p.context.candidateIncomingBranch>=0&&p.context.candidateIncomingBranch<p.modelInput.candidate.branches.length);
  p.splitGroups.forEach(g=>uses.set(g,(uses.get(g)||0)+1));
  for(const [i,key]of ['candidate','target'].entries())for(const old of source.excludedJunctions){assert.notEqual(p.splitGroups[i],old.group);assert(engine.distance(p.modelInput[key].center,old.center)>12);}
  for(const f of Object.values(p.modelInput))for(const q of [f.center,...f.branches.flat()])assert(q.lat>=source.bounds.south&&q.lat<=source.bounds.north&&q.lon>=source.bounds.west&&q.lon<=source.bounds.east);
 }
 assert(Math.max(...uses.values())<=3);assert(Math.max(...source.componentSizes)<=8);assert.equal(source.componentSizes.reduce((a,b)=>a+b,0),100);
});
