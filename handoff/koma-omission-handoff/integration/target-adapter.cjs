'use strict';
const engine=require('../source/site/routing.js');
// Compatibility geometry only. This does NOT replace the recipient's walking/access graph.
function compatibilityGraph(targetGraph){
 return engine.graph({nodes:[...targetGraph.nodes.values()],ways:[...targetGraph.ways.values()]});
}
// approachFromCenter: real route points, CENTER -> BACKWARD, clipped at last stop/return.
// Do not derive the path from image coordinates or the longest branch.
function frameFromCandidate(g,candidate,approachFromCenter){
 const center=g.nodes.get(candidate.nodeId),arms=g.visual.get(candidate.nodeId)||[];
 if(!center||arms.length<3||!candidate.arrival)throw Error('Not an internal approach-known junction');
 const expected=(candidate.branches||[]).map(b=>b.neighborNodeId).sort((a,b)=>a-b),actual=arms.map(e=>e.to).sort((a,b)=>a-b);
 if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Target and compatibility branch sets differ; retain for review');
 if(!Array.isArray(approachFromCenter)||approachFromCenter.length<2||engine.distance(center,approachFromCenter[0])>.01)throw Error('Actual route approach required');
 let remain=8,near=approachFromCenter.at(-1);
 for(let i=1;i<approachFromCenter.length;i++){
  const a=approachFromCenter[i-1],b=approachFromCenter[i],d=engine.distance(a,b);
  if(d>0&&d>=remain){const t=remain/d;near={lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t};break;}remain-=d;
 }
 const incomingBranchIndex=arms.findIndex(e=>e.to===candidate.arrival.neighborNodeId);
 if(incomingBranchIndex<0)throw Error('Arrival branch missing in compatibility graph');
 const traces=arms.map(e=>engine.traceRoad(g,candidate.nodeId,e.to,28));
 return {id:`junction:${candidate.nodeId}:${candidate.pathIndex}`,center:{lat:center.lat,lon:center.lon},heading:engine.bearing(near,center),branches:traces.map(t=>t.points),branchEnds:traces.map(t=>t.end),routeIn:[...approachFromCenter].reverse(),incomingBranchIndex,at:candidate.metersFromStart};
}
module.exports={compatibilityGraph,frameFromCandidate};
