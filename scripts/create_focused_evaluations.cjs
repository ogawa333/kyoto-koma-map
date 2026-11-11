#!/usr/bin/env node
// Build unanswered Miura VI/VII from real routes; no human answer is used to rank.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const engine=require('../site/routing.js'),api=require('../site/evaluation-core.js');
const {selectSets,DEFAULT_QUOTAS}=require('./focused_evaluation.cjs');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
function exclusionCatalog(datasets){
  const points=new Map();
  for(const dataset of datasets){api.validateDataset(dataset);for(const pair of dataset.pairs)for(const [i,key]of ['candidate','target'].entries()){
    const center=pair.modelInput[key].center,group=pair.splitGroups[i];
    points.set(group+':'+center.lat+':'+center.lon,{group,center});
  }}
  return [...points.values()].sort((a,b)=>a.group.localeCompare(b.group)||a.center.lat-b.center.lat||a.center.lon-b.center.lon);
}
function makePool(data,excluded,{seed=20261111,maxRoutes=1200,createdAt,progress=()=>{}}={}){
  const groups=new Set(excluded.map(p=>p.group)),g=engine.graph(data),nodes=[...g.adj.keys()].sort((a,b)=>a-b).map(id=>g.nodes.get(id));
  let state=seed>>>0;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const pairs=[],courses=[],seen=new Set();let source=null;
  for(let route=0;route<maxRoutes;route++){
    const locations=Array.from({length:4},(_,i)=>({...nodes[Math.floor(random()*nodes.length)],name:'評価用地点'+(i+1)}));let sample;
    try{
      const result=engine.generate(data,locations);
      sample=api.buildDataset({result:{...result,allFrames:result.frames,name:'三浦・追加評価'},edits:{}},{id:'miura-pool-'+route,createdAt});
    }catch(error){if(/道|スタート|評価可能/.test(error.message))continue;throw error;}
    source=sample.source;const courseId='miura-focused-route-'+route;let added=false;
    for(const pair of sample.pairs){
      if(pair.splitGroups.some(x=>groups.has(x)))continue;
      if([pair.modelInput.candidate.center,pair.modelInput.target.center].some(c=>excluded.some(old=>engine.distance(c,old.center)<=12)))continue;
      const key=JSON.stringify(pair.splitGroups);if(seen.has(key))continue;
      seen.add(key);pairs.push({...pair,context:{...pair.context,courseId}});added=true;
    }
    if(added)courses.push({id:courseId,locations:locations.map(p=>({id:p.id,lat:p.lat,lon:p.lon}))});
    if(route%100===0)progress({route,pairs:pairs.length});
  }
  return {source,pairs,courses};
}
function stableId(text){const b=Buffer.from(sha(text).slice(0,32),'hex');b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
function buildFocused(data,excluded,{seed=20261111,maxRoutes=1200,createdAt=new Date().toISOString(),progress}={}){
  const pool=makePool(data,excluded,{seed,maxRoutes,createdAt,progress}),selected=selectSets(pool.pairs,{seed});
  const fingerprint=sha(JSON.stringify(data));
  const sets=selected.map((selection,index)=>{
    const questionHash=sha(JSON.stringify(selection.rows.map(r=>({modelInput:r.pair.modelInput,splitGroups:r.pair.splitGroups}))));
    const number=index+6,id=stableId('miura-focused:'+fingerprint+':'+seed+':'+number+':'+questionHash);
    const pairs=selection.rows.map(({pair},i)=>{
      const {courseId,...context}=pair.context;
      return {...pair,id:id+':pair:'+(i+1),context};
    });
    return api.validateDataset({format:api.FORMAT,version:api.VERSION,id,createdAt,source:{...pool.source,courseName:'三浦・三崎港周辺・追加評価'+['⑥','⑦'][index],requestedPairs:100},pairs,responses:[]});
  });
  const usedCourses=new Set(selected.flatMap(s=>s.rows.map(r=>r.pair.context.courseId)));
  return {sets,selection:{seed,maxRoutes,poolPairs:pool.pairs.length,quotas:DEFAULT_QUOTAS,mergeMeters:12,maxEndpointReuse:3,maxComponentPairs:8,
    recommendedUse:{six:'development after human answers',seven:'holdout; do not use to tune until evaluation is complete'},
    purpose:'Focused stress tests informed by previous errors, not a random sample or a known-answer test. No model was trained or rule changed.',
    excludedJunctions:excluded,courses:pool.courses.filter(c=>usedCourses.has(c.id)),
    sets:sets.map((d,i)=>({file:'evaluation-set-0'+(i+6)+'.json',id:d.id,pairs:d.pairs.length,componentSizes:selected[i].componentSizes,
      items:selected[i].rows.map((r,j)=>({pairId:d.pairs[j].id,courseId:r.pair.context.courseId,category:r.category,geometry:r.features}))}))}};
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),excludedFiles=[];let networkFile,outputDir,createdAt;
    while(args.length){const key=args.shift(),value=args.shift();if(!value)throw Error('Missing value: '+key);if(key==='--network-json')networkFile=value;else if(key==='--exclude')excludedFiles.push(value);else if(key==='--output-dir')outputDir=value;else if(key==='--created-at')createdAt=value;else throw Error('Unknown option: '+key);}
    if(!networkFile||!outputDir||!excludedFiles.length)throw Error('Usage: node scripts/create_focused_evaluations.cjs --network-json miura.json --exclude set1.json [--exclude set2.json ...] --output-dir output [--created-at ISO]');
    const outputFiles=['evaluation-set-06.json','evaluation-set-07.json','evaluation-miura-focused-source.json'].map(f=>path.join(outputDir,f));
    if(outputFiles.some(f=>fs.existsSync(f)))throw Error('Output exists; use a new directory to preserve evaluation IDs and answers.');
    const raw=fs.readFileSync(networkFile,'utf8'),data=JSON.parse(raw),prior=excludedFiles.map(f=>({raw:fs.readFileSync(f,'utf8'),file:path.basename(f)}));
    const datasets=prior.map(p=>JSON.parse(p.raw)),result=buildFocused(data,exclusionCatalog(datasets),{createdAt,progress:p=>console.error(JSON.stringify(p))});
    const source={region:'三浦・三崎港周辺（本土側、城ヶ島を含まない）',attribution:'© OpenStreetMap contributors',source:data.source,sourceDate:data.timestamp,bounds:data.bounds,extractSha256:sha(raw),
      sourceExtractProvenance:sha(raw)===require('../site/data/evaluation-miura-source.json').extractSha256?'evaluation-miura-source.json':null,
      exclusionInputs:prior.map((p,i)=>({id:datasets[i].id,pairs:datasets[i].pairs.length,sha256:sha(p.raw)})),
      generatorSha256:sha(fs.readFileSync(__filename)),selectionCodeSha256:sha(fs.readFileSync(require.resolve('./focused_evaluation.cjs'))),
      generationVersion:engine.GENERATION_VERSION,ruleVersion:engine.RULE_VERSION,...result.selection};
    fs.mkdirSync(outputDir,{recursive:true});
    [...result.sets,source].forEach((value,i)=>fs.writeFileSync(outputFiles[i],JSON.stringify(value,null,2)+'\n',{flag:'wx'}));
    console.log('Saved unanswered Miura sets VI/VII, 100 pairs each.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={exclusionCatalog,makePool,buildFocused};
