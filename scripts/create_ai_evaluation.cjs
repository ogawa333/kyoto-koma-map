#!/usr/bin/env node
// Make unanswered sets from genuine bundled routes, excluding prior intersections.
const fs = require('node:fs');
const crypto = require('node:crypto');
const api = require('../site/evaluation-core.js');
const engine = require('../site/routing.js');
let network;
function makeSet({exclude=[], count=100, seed=43, mergeMeters=12, maxRoutes=40, networkData=null, regionName='京都'}={}) {
  if (!networkData && !network) {
    const sandbox = {window:{}};
    require('node:vm').runInNewContext(fs.readFileSync(require.resolve('../site/data/kyoto-network.js'),'utf8'),sandbox);
    network = sandbox.window.KYOTO_NETWORK;
  }
  const data = networkData || network;
  const excludedGroups = new Set(), excludedCenters = [];
  for (const d of exclude) {
    api.validateDataset(d);
    for (const p of d.pairs) {
      p.splitGroups.forEach(g=>excludedGroups.add(g));
      excludedCenters.push(p.modelInput.candidate.center, p.modelInput.target.center);
    }
  }
  let state = seed >>> 0;
  const random = () => {state = (Math.imul(state,1664525)+1013904223) >>> 0;return state/4294967296;};
  const g = engine.graph(data), nodes = [...g.adj.keys()].sort((a,b)=>a-b).map(id=>g.nodes.get(id));
  const id = crypto.randomUUID(), pairs = [], courses = [], seen = new Set();
  let base = null;
  for (let route=0; route<maxRoutes && pairs.length<count; route++) {
    const locations = Array.from({length:4},(_,i)=>({...nodes[Math.floor(random()*nodes.length)], name:'評価用道路地点'+(i+1)}));
    let sample;
    try {
      const result = engine.generate(data,locations);
      sample = api.buildDataset({result:{...result,allFrames:result.frames,name:regionName+'・追加評価セット（seed '+seed+'）'},edits:{}},{id:id+':route:'+route});
    } catch (error) {
      if (/道|スタート|評価可能/.test(error.message)) continue;
      throw error;
    }
    if (!base) base = sample;
    const courseId = 'seed-'+seed+'-route-'+route;
    let added = false;
    for (const p of sample.pairs) {
      if (p.splitGroups.some(group=>excludedGroups.has(group))) continue;
      if ([p.modelInput.candidate.center,p.modelInput.target.center].some(point=>excludedCenters.some(other=>engine.distance(point,other)<=mergeMeters))) continue;
      const key = JSON.stringify(p.splitGroups);
      if (seen.has(key)) continue;
      seen.add(key); added = true;
      pairs.push({...p,id:id+':pair:'+pairs.length,context:{...p.context,courseId}});
      if (pairs.length>=count) break;
    }
    if (added) courses.push({id:courseId,name:(networkData?regionName+'・':'')+'追加評価ルート '+(route+1),sourceDate:sample.source.sourceDate,generationVersion:sample.source.generationVersion,ruleVersion:sample.source.ruleVersion});
  }
  if (pairs.length<count) throw Error('重複しない問題が'+pairs.length+'問しかありません。別エリアの道路データ・ルートで集めてください。既存の除外条件は緩めません。');
  return api.validateDataset({...base,id,pairs,responses:[],source:{...base.source,requestedPairs:count,supplementalCourses:courses}});
}
if (require.main === module) {
  try {
    const args=process.argv.slice(2), options={exclude:[]};let output;
    while(args.length) {
      const flag=args.shift(), value=args.shift();
      if(!value) throw Error('オプションに値が必要です: '+flag);
      if(flag==='--exclude') options.exclude.push(JSON.parse(fs.readFileSync(value,'utf8')));
      else if(flag==='--output') output=value;
      else if(flag==='--network-json') options.networkData=JSON.parse(fs.readFileSync(value,'utf8'));
      else if(flag==='--region-name') options.regionName=value;
      else if(flag==='--seed') options.seed=Number(value);
      else if(flag==='--count') options.count=Number(value);
      else throw Error('Unknown option: '+flag);
    }
    if(!output) throw Error('Usage: node scripts/create_ai_evaluation.cjs --exclude answered.json --output pending.json [--seed 43]');
    if(options.seed!==undefined&&!Number.isSafeInteger(options.seed))throw Error('seed must be an integer');
    if(options.count!==undefined&&(!Number.isInteger(options.count)||options.count<1||options.count>1000))throw Error('count must be 1..1000');
    if(fs.existsSync(output)) throw Error('出力先が既にあります。既存の回答を保護するため別名を指定してください。');
    const d=makeSet(options);
    fs.writeFileSync(output,JSON.stringify(d,null,2)+'\n',{flag:'wx'});
    console.log('未回答 '+d.pairs.length+'ペアを保存: '+output);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
module.exports={makeSet};
