#!/usr/bin/env node
// A model-blind final test: no scores or human labels enter pair selection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const api=require('../site/evaluation-core.js'),{makePool,exclusionCatalog}=require('./create_focused_evaluations.cjs'),{touches}=require('./focused_evaluation.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function build(network,prior,{seed=20261112,maxRoutes=160}={}){
 const excluded=exclusionCatalog(prior),pool=makePool(network,excluded,{seed,maxRoutes,createdAt:new Date().toISOString()}),rows=[],components=[],seen=new Set();
 const candidates=pool.pairs.filter(p=>Number.isInteger(p.context.candidateIncomingBranch)).sort((a,b)=>sha(seed+':'+JSON.stringify(a.splitGroups)).localeCompare(sha(seed+':'+JSON.stringify(b.splitGroups))));
 for(const pair of candidates){
  const key=JSON.stringify([...pair.splitGroups].sort());if(seen.has(key))continue;
  if(pair.splitGroups.some(g=>rows.filter(p=>p.splitGroups.includes(g)).length>=3))continue;
  const joined=components.filter(c=>c.some(i=>touches(rows[i],pair)));
  if(1+joined.reduce((n,c)=>n+c.length,0)>8)continue;
  for(const c of joined)components.splice(components.indexOf(c),1);
  components.push([...joined.flat(),rows.length]);rows.push(pair);seen.add(key);
  if(rows.length===100)break;
 }
 if(rows.length!==100)throw Error('Independent final-test candidates insufficient; do not weaken exclusions.');
 const digest=sha(JSON.stringify(rows.map(p=>({modelInput:p.modelInput,splitGroups:p.splitGroups})))),h=digest.slice(0,32),id=[h.slice(0,8),h.slice(8,12),'5'+h.slice(13,16),'8'+h.slice(17,20),h.slice(20)].join('-');
 const pairs=rows.map((p,i)=>{const {courseId,...context}=p.context;return {...p,id:id+':pair:'+i,context};});
 const dataset=api.validateDataset({format:api.FORMAT,version:api.VERSION,id,createdAt:new Date().toISOString(),source:{...pool.source,courseName:'三浦海岸駅周辺・未使用の最終確認⑧',requestedPairs:100},pairs,responses:[]});
 const used=new Set(rows.map(p=>p.context.courseId));
 return {dataset,provenance:{region:'三浦海岸駅周辺',attribution:'© OpenStreetMap contributors',source:network.source,sourceDate:network.timestamp,bounds:network.bounds,seed,maxRoutes,poolPairs:pool.pairs.length,
  selection:'Seeded geometry-blind random ordering of genuine route pairs, with max 3 uses per ID and max 8 pairs per proximity component. Requires known arrival branch. No model prediction or answer is read.',
  mergeMeters:12,excludedJunctions:excluded,priorDatasets:prior.map(d=>({id:d.id,pairs:d.pairs.length})),componentSizes:components.map(c=>c.length).sort((a,b)=>b-a),courses:pool.courses.filter(c=>used.has(c.id)),items:rows.map((p,i)=>({pairId:pairs[i].id,courseId:p.context.courseId})),predictionsViewed:false,humanAnswers:0}};
}
if(require.main===module){try{
 const [networkFile,freezeFile,outputDir,...priorFiles]=process.argv.slice(2);if(!networkFile||!freezeFile||!outputDir||!priorFiles.length)throw Error('Usage: node scripts/create_final_evaluation.cjs network.json freeze.json output-dir prior1.json [...]');
 const files=['evaluation-set-08.json','evaluation-set-08-source.json'].map(f=>path.join(outputDir,f));if(files.some(f=>fs.existsSync(f)))throw Error('Output exists; preserve final-test IDs.');
 const raw=fs.readFileSync(networkFile),freeze=JSON.parse(fs.readFileSync(freezeFile)),result=build(JSON.parse(raw),priorFiles.map(f=>JSON.parse(fs.readFileSync(f))));
 result.provenance={...result.provenance,id:result.dataset.id,datasetSha256:sha(JSON.stringify(result.dataset,null,2)+'\n'),networkSha256:sha(raw),frozenModelSha256:freeze.modelSha256,modelAlgorithm:'D: predeclared features plus inner-only weights/thresholds',generatorSha256:sha(fs.readFileSync(__filename)),status:'awaiting human answers; no final-test accuracy yet'};
 fs.mkdirSync(outputDir,{recursive:true});[result.dataset,result.provenance].forEach((value,i)=>fs.writeFileSync(files[i],JSON.stringify(value,null,2)+'\n',{flag:'wx'}));
 console.log(JSON.stringify({id:result.dataset.id,pairs:100,pool:result.provenance.poolPairs,modelHash:freeze.modelSha256,unanswered:true}));
}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={build};
