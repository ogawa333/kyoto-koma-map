'use strict';
// Optional JS forest decoder. Feature creation is still Python unless ported.
function keepScore(model,features){
 if(model.featureVersion!=='junction-correspondence-entry-curve-v1:D'||model.inputPrecision!=='float32')throw Error('Unsupported feature/model version');
 if(!Array.isArray(features)||features.length!==350||!features.every(Number.isFinite))throw Error('Expected 350 finite features');
 const values=features.map(Math.fround),scores=model.trees.map(tree=>{
  let n=0;
  while(tree.left[n]!==-1)n=values[tree.feature[n]]<=tree.threshold[n]?tree.left[n]:tree.right[n];
  return tree.keepProbability[n];
 });
 return scores.reduce((a,b)=>a+b,0)/scores.length;
}
module.exports={keepScore};
