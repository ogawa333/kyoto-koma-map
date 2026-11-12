'use strict';
const fs=require('node:fs');
const rule=require('../source/site/routing.js');
const {pairFeatures}=require('../source/scripts/focused_evaluation.cjs');
function validate(frame){
 if(!frame||!Number.isFinite(frame.heading)||!frame.center||!Array.isArray(frame.branches)||frame.branches.length<3)throw Error('Requires >=3 road branches, center and heading in radians');
 const point=p=>p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180;
 if(!point(frame.center)||!frame.branches.every(b=>Array.isArray(b)&&b.length>=2&&b.every(point)&&rule.distance(frame.center,b[0])<=.01))throw Error('Invalid WGS84 polyline; every branch must start at center');
 if(!rule.junctionSignature(frame))throw Error('Unknown or zero-length branch geometry');
}
function prepare(input){
 const pair=input.pair||{modelInput:{candidate:input.candidate,target:input.target}};
 const frames=[pair.modelInput.candidate,pair.modelInput.target];frames.forEach(validate);
 const entry=(value,f)=>value==null?rule.incomingBranchIndex(f):value;
 const entryIndex=entry(input.entryIndex,frames[0]),targetEntryIndex=entry(input.targetEntryIndex,frames[1]);
 for(const [i,n]of [entryIndex,targetEntryIndex].entries())if(n!==null&&(!Number.isInteger(n)||n<0||n>=frames[i].branches.length))throw Error('Invalid incoming branch index');
 return {row:{pair,signatures:frames.map(rule.junctionSignature),entryIndex,targetEntryIndex},geometry:pairFeatures(pair),rule:rule.similarJunctions(...frames)?'keep':'omit',entryKnown:entryIndex!==null&&targetEntryIndex!==null};
}
module.exports={prepare,validate};
if(require.main===module){try{const x=JSON.parse(fs.readFileSync(0,'utf8'));const list=Array.isArray(x)?x:[x];const out=list.map(x=>{try{return prepare(x)}catch(e){return {rule:'keep',error:e.message,entryKnown:false}}});process.stdout.write(JSON.stringify(Array.isArray(x)?out:out[0]));}catch(e){console.error(e.message);process.exitCode=1;}}
