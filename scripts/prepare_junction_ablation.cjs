#!/usr/bin/env node
// Recompute the baseline consistently, preserving original exports and answers.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const engine=require('../site/routing.js'),api=require('../site/evaluation-core.js'),diagram=require('../site/diagram.js'),{prepare}=require('./prepare_evaluations.cjs');
const root=path.resolve(__dirname,'..'),sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'site/data/evaluation-incoming-roads.js'),'utf8'),sandbox);
function* permutations(a){if(!a.length){yield [];return;}for(let i=0;i<a.length;i++)for(const tail of permutations(a.filter((_,j)=>j!==i)))yield[a[i],...tail];}
function firstEntries(rows){
 if(!rows.length)return new Map();
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'site/data/kyoto-network.js'),'utf8'),context);
 const network=context.window.KYOTO_NETWORK,locations=network.sampleLocations,found=new Map();
 for(const order of permutations(locations.slice(1,-1))){
  const result=engine.generate(network,[locations[0],...order,locations.at(-1)]);
  for(const row of rows){const p=row.pair,f=result.frames.find(f=>f.id===p.context.candidateId&&Math.abs(f.at-p.context.candidateAt)<1e-7&&Math.abs(f.heading-p.modelInput.candidate.heading)<1e-9&&JSON.stringify(f.branches)===JSON.stringify(p.modelInput.candidate.branches));
   if(f){const index=engine.incomingBranchIndex(f);if(index!==null){if(found.has(row.key)&&found.get(row.key)!==index)throw Error('Ambiguous recovered entry');found.set(row.key,index);}}
  }if(found.size===rows.length)break;
 }
 return found;
}
function build(files){
 const rows=[],inputs=[],excluded={};
 for(const file of files){
  const raw=fs.readFileSync(file),d=api.validateDataset(JSON.parse(raw)),prepared=prepare([file],'P001'),pairs=new Map(d.pairs.map(p=>[p.id,p]));
  inputs.push({file,id:d.id,sha256:crypto.createHash('sha256').update(raw).digest('hex'),pairs:d.pairs.length,sourceRuleVersion:d.source.ruleVersion});
  for(const [key,n]of Object.entries(prepared.excluded))excluded[key]=(excluded[key]||0)+n;
  for(const r of prepared.rows){const p=pairs.get(r.references[0].pairId),frame=p.modelInput.candidate,record=sandbox.window.KOMA_INCOMING_ROADS.datasets[d.id]?.[p.id];
   let entryIndex=p.context.candidateIncomingBranch??null,entrySource=entryIndex===null?'unknown':'route';
   if(entryIndex===null&&record&&record[1]===diagram.fingerprint(frame)){entryIndex=record[0];entrySource='verified';}
   rows.push({...r,savedRule:r.rule,rule:engine.similarJunctions(frame,p.modelInput.target)?'keep':'omit',pair:p,entryIndex,entrySource,targetEntryIndex:engine.incomingBranchIndex(p.modelInput.target)});
  }
 }
 const first=rows.filter(r=>r.references[0].datasetId==='92d7a73c-39e5-4da3-aeaf-499d9e1b6e8e'&&r.entryIndex===null),recovered=firstEntries(first);
 for(const row of first)if(recovered.has(row.key)){row.entryIndex=recovered.get(row.key);row.entrySource='recovered';}
 rows.sort((a,b)=>a.key.localeCompare(b.key));if(new Set(rows.map(r=>r.key)).size!==rows.length)throw Error('Duplicate pairs: do not silently combine evaluations.');
 return {ruleVersion:engine.RULE_VERSION,inputFiles:inputs,excluded,rows,entrySources:rows.reduce((o,r)=>(o[r.entrySource]=(o[r.entrySource]||0)+1,o),{})};
}
if(require.main===module){try{const [output,...files]=process.argv.slice(2);if(!output||!files.length)throw Error('Usage: node scripts/prepare_junction_ablation.cjs output.json export1.json [...]');if(fs.existsSync(output))throw Error('Output exists; choose a new path.');const result=build(files);fs.writeFileSync(output,JSON.stringify(result)+'\n',{flag:'wx'});console.log(JSON.stringify({pairs:result.rows.length,excluded:result.excluded,entrySources:result.entrySources}));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={build};
