const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {prepare}=require('../scripts/prepare_evaluations.cjs'),registry=require('../config/junction-evaluation-exclusions.json');
test('requested cases 01/05/02 are explicitly excluded without removing original answers',()=>{
 assert.deepEqual(registry.entries.map(e=>e.caseNumber),[1,5,2]);assert.equal(new Set(registry.entries.map(e=>e.pairId)).size,3);
 const d=structuredClone(require('../site/data/evaluation-set-02.json')),entry=registry.entries[0];d.id=entry.datasetId;d.pairs=d.pairs.slice(0,2);d.pairs[0].id=entry.pairId;
 d.responses=d.pairs.map(p=>({pairId:p.id,evaluatorId:'P001',role:'participant',choice:'clear',notes:'original answer',activeViewMs:1000,decisionMs:500,updatedAt:'2026-11-12T00:00:00Z',revision:1}));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'excluded-evals-'));try{
  const file=path.join(dir,'answered.json'),original=JSON.stringify(d);fs.writeFileSync(file,original);
  const result=prepare([file],'P001');assert.equal(result.excluded.manualExclusions,1);assert.equal(result.rows.length,1);assert.equal(result.rows[0].references[0].pairId,d.pairs[1].id);assert.equal(fs.readFileSync(file,'utf8'),original);
 }finally{fs.rmSync(dir,{recursive:true});}
});
