'use strict';
const engine=require('../source/site/routing.js'),{prepare}=require('./geometry.cjs');
// Callback is injected; use a batch/persistent worker in production.
// Never use pair classification to decide whether a turn/stop may initially be omitted.
async function selectFrames(frames,{mode='all',edits={},scorePair}={}){
 if(mode==='all'||mode==='rule')return engine.selectFrames(frames,mode==='rule'?'reduced':'all',edits);
 if(mode!=='hybrid-experimental'||typeof scorePair!=='function')throw Error('Choose all, rule or hybrid-experimental + scorePair callback');
 const keep=frames.map((f,i)=>engine.baseFrameIsRequired(f,i,frames.length,edits)),reasons=new Map();
 let changed;
 do{
  changed=false;let previous=0;
  for(let target=1;target<frames.length;target++){
   if(!keep[target])continue;
   if(engine.skipSimilarityTarget(frames[target],edits)){previous=target;continue;}
   for(let i=previous+1;i<target;i++){
    let retain=true,reason='invalid-or-unavailable';
    try{
     const input={candidate:frames[i],target:frames[target],entryIndex:frames[i].incomingBranchIndex??null,targetEntryIndex:frames[target].incomingBranchIndex??null},p=prepare(input);
     if(p.rule==='keep'){reason='current-rule-keep';}
     else if(!p.entryKnown){reason='incoming-branch-unknown';}
     else{
      const result=await scorePair(input);
      if(!result||!['keep','omit'].includes(result.decision))throw Error('Missing score decision');
      retain=result.decision==='keep';reason=result.reason;
     }
    }catch{/* Keep if source data or inference is unresolved. */}
    if(retain){keep[i]=true;reasons.set(i,{target:frames[target],reason});changed=true;break;}
   }
   if(changed)break;previous=target;
  }
 }while(changed);
 const selected=frames.map((f,i)=>({f,i})).filter(({i})=>keep[i]),numbers=new Map(selected.map(({f},i)=>[f.id,i+1]));
 return selected.map(({f,i},n)=>{const reason=reasons.get(i);return {...f,number:n+1,fromPrevious:f.at-(n?selected[n-1].f.at:0),retentionReason:reason?.reason,retentionTargetId:reason?.target.id,retentionTargetNumber:reason?numbers.get(reason.target.id):undefined};});
}
module.exports={selectFrames};
