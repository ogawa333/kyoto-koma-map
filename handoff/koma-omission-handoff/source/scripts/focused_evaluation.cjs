// Geometry-only sampling helpers. These never assign human answers.
const engine=require('../site/routing.js');
const crypto=require('node:crypto');
const degrees=x=>Math.abs(engine.angle(x))*180/Math.PI;
function matchAngle(a,b,depths=[0,1]){
  if(a.length>b.length)[a,b]=[b,a];
  const costs=a.map(u=>b.map(v=>Math.max(...depths.map(k=>degrees(u[k]-v[k])))));
  const limits=[...new Set(costs.flat())].sort((x,y)=>x-y);
  function possible(limit){
    const matched=Array(b.length).fill(-1);
    function assign(i,seen){for(let j=0;j<b.length;j++)if(!seen.has(j)&&costs[i][j]<=limit+1e-9){seen.add(j);if(matched[j]<0||assign(matched[j],seen)){matched[j]=i;return true;}}return false;}
    return a.every((_,i)=>assign(i,new Set()));
  }
  return limits.find(possible)??180;
}
function pairFeatures(pair){
  const frames=[pair.modelInput.candidate,pair.modelInput.target],signatures=frames.map(engine.junctionSignature);
  if(signatures.some(s=>!s))return null;
  const lengths=frames.flatMap(f=>f.branches.map(branch=>branch.slice(1).reduce((sum,p,i)=>sum+engine.distance(branch[i],p),0)));
  const sameCount=signatures[0].length===signatures[1].length;
  return {counts:signatures.map(s=>s.length),sameCount,minLength:Math.min(...lengths),maxLength:Math.max(...lengths),
    angle:matchAngle(...signatures),mirrorAngle:matchAngle(signatures[0].map(branch=>branch.map(a=>-a)),signatures[1]),
    bend:Math.max(...signatures.flat().map(branch=>degrees(branch[0]-branch[1]))),
    angle8:matchAngle(...signatures,[0]),angle20:matchAngle(...signatures,[1])};
}
const profiles={
  'short-boundary':f=>f.sameCount&&f.minLength<8&&f.angle>15&&f.angle<=45,
  'long-boundary':f=>f.sameCount&&f.minLength>=8&&f.angle>15&&f.angle<=45,
  'large-angle-short':f=>f.sameCount&&f.minLength<8&&f.angle>45&&f.angle<=75,
  'bending':f=>f.sameCount&&f.bend>=8&&f.angle<=65,
  'count-connection':f=>Math.abs(f.counts[0]-f.counts[1])===1&&f.minLength<8&&f.angle<=30,
  'mirror-control':f=>f.sameCount&&f.mirrorAngle<=20&&f.angle>=45,
  'near-control':f=>f.sameCount&&f.angle<=15,
  'clear-control':f=>Math.abs(f.counts[0]-f.counts[1])>=2||(f.angle>=75&&f.mirrorAngle>40)
};
const DEFAULT_QUOTAS={'short-boundary':15,'long-boundary':20,'large-angle-short':10,bending:15,'count-connection':15,'mirror-control':10,'near-control':10,'clear-control':5};
const endpoints=p=>[p.modelInput.candidate.center,p.modelInput.target.center];
function touches(a,b,meters=12){return a.splitGroups.some(g=>b.splitGroups.includes(g))||endpoints(a).some(p=>endpoints(b).some(q=>engine.distance(p,q)<=meters));}
function selectSets(pool,{quotas=DEFAULT_QUOTAS,seed=20261111,maxComponent=8,maxReuse=3}={}){
  const rows=pool.map(pair=>({pair,features:pairFeatures(pair)})).filter(r=>r.features);
  const sets=[{rows:[],components:[]},{rows:[],components:[]}],seen=new Set();
  const rank=p=>crypto.createHash('sha256').update(seed+':'+JSON.stringify(p.splitGroups)).digest('hex');
  function eligible(s,row){
    const other=sets[1-sets.indexOf(s)];
    if(other.rows.some(r=>touches(r.pair,row.pair)))return false;
    if(row.pair.splitGroups.some(g=>s.rows.filter(r=>r.pair.splitGroups.includes(g)).length>=maxReuse))return false;
    const joined=s.components.filter(indices=>indices.some(i=>touches(s.rows[i].pair,row.pair)));
    return 1+joined.reduce((n,c)=>n+c.length,0)<=maxComponent;
  }
  // Scarce geometric cases first; alternate sets so one cannot consume the pool.
  const categories=Object.entries(quotas).sort(([a,an],[b,bn])=>rows.filter(r=>profiles[a](r.features)).length/an-rows.filter(r=>profiles[b](r.features)).length/bn);
  for(const [category,count]of categories){
    const candidates=rows.filter(r=>profiles[category](r.features)).sort((a,b)=>rank(a.pair).localeCompare(rank(b.pair))),taken=[0,0];
    for(let round=0;round<count;round++)for(const index of [round%2,1-round%2]){
      const s=sets[index],row=candidates.find(r=>!seen.has(JSON.stringify([...r.pair.splitGroups].sort()))&&eligible(s,r));
      if(!row)throw Error('独立した問題が不足しています: '+category+' set '+(index+6)+' '+taken[index]+'/'+count+'。除外条件を緩めず実道路の候補を増やしてください。');
      const joined=s.components.filter(indices=>indices.some(i=>touches(s.rows[i].pair,row.pair)));
      s.components=s.components.filter(c=>!joined.includes(c));s.components.push([...joined.flat(),s.rows.length]);
      s.rows.push({...row,category});taken[index]++;seen.add(JSON.stringify([...row.pair.splitGroups].sort()));
    }
  }
  return sets.map(s=>({rows:s.rows,componentSizes:s.components.map(c=>c.length).sort((a,b)=>b-a)}));
}
module.exports={matchAngle,pairFeatures,profiles,DEFAULT_QUOTAS,touches,selectSets};
