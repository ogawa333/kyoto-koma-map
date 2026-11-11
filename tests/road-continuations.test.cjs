const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../site/routing.js'),diagram=require('../site/diagram.js'),evaluation=require('../site/evaluation-core.js');
const point=(id,x,y,tags={})=>({id,lat:35+y/111320,lon:135+x/111320/Math.cos(35*Math.PI/180),tags});
function fixture(){
 const nodes=[point(1,0,0),point(2,3,0),point(3,3,30),point(4,3,-30),point(5,-30,0),point(6,0,-30)];
 const ways=[[1,2],[2,3],[2,4],[1,5],[1,6]].map((nodes,id)=>({id,nodes,tags:{highway:'residential'}}));
 const g=engine.graph({nodes,ways});
 const traces=(g.visual.get(1)||[]).map(e=>engine.traceRoad(g,1,e.to));
 return {g,traces,frame:{center:g.nodes.get(1),heading:0,branches:traces.map(t=>t.points),branchEnds:traces.map(t=>t.end),roadContinuations:engine.roadContinuations(g,1,traces)}};
}
test('short branches continue along actual roads on both sides of the next junction',()=>{
 const {frame}=fixture();assert.equal(frame.branches.length,3);assert.equal(frame.roadContinuations.length,2);
 const tip=frame.branches[0].at(-1);assert(engine.distance(frame.center,tip)<4);
 for(const road of frame.roadContinuations){assert.deepEqual(road.points[0],{lat:tip.lat,lon:tip.lon});assert(Math.abs(engine.distance(frame.center,tip)+engine.distance(...road.points)-12)<.01);}
 const ends=frame.roadContinuations.map(r=>r.points[1].lat);assert(ends.some(lat=>lat>tip.lat)&&ends.some(lat=>lat<tip.lat));
 const svg=diagram.continuationPaths(frame)+diagram.roadbookEndingMarks(frame);assert.equal((svg.match(/class="road-continuation"/g)||[]).length,2);assert(!svg.includes('data-branch-end="junction"'));assert(!svg.includes('stroke-dasharray'));assert(!svg.includes('marker-end'));
});
test('registered dead ends and unverified leaves are not invented into longer roads',()=>{
 const {g}=fixture();g.nodes.get(2).tags.noexit='yes';g.visual.set(2,[g.visual.get(2).find(e=>e.to===1)]);
 const trace=engine.traceRoad(g,1,2);assert.equal(trace.end,'dead-end');assert.deepEqual(engine.roadContinuations(g,1,[trace]),[]);
 delete g.nodes.get(2).tags.noexit;const unknown=engine.traceRoad(g,1,2);assert.equal(unknown.end,'unknown');assert.deepEqual(engine.roadContinuations(g,1,[unknown]),[]);
});
test('extension stops at actual dead ends and traces a curved road instead of projecting a straight line',()=>{
 const {g,traces}=fixture();g.nodes.set(7,point(7,6,3));g.nodes.set(8,point(8,9,3,{noexit:'yes'}));
 const way={tags:{highway:'residential'}};
 g.visual.set(3,[{to:2,way},{to:7,way}]);g.visual.set(7,[{to:3,way},{to:8,way}]);g.visual.set(8,[{to:7,way}]);g.nodes.set(3,point(3,3,3));
 const roads=engine.roadContinuations(g,1,traces);assert(roads.some(r=>r.end==='dead-end'));assert(roads.some(r=>r.points[1].lon===g.nodes.get(7).lon));
 assert(roads.every(r=>r.points.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))));
});
test('new context geometry does not change branch count, angle signature or rule prediction',()=>{
 const {frame}=fixture(),old=structuredClone(frame);delete old.roadContinuations;
 assert.deepEqual(engine.junctionSignature(frame),engine.junctionSignature(old));assert.equal(frame.branches.length,old.branches.length);
 assert.equal(engine.similarJunctions(frame,old),true);
 const mirrored=structuredClone(old);mirrored.branches=old.branches.map(road=>road.map(p=>({...p,lon:2*frame.center.lon-p.lon})));
 assert.equal(engine.similarJunctions(frame,mirrored),engine.similarJunctions(old,mirrored));
});
test('loops remain bounded and a clipped connecting edge can be drawn from both reachable ends',()=>{
 const {g,traces}=fixture(),way={tags:{highway:'residential'}};
 g.nodes.set(7,point(7,3,8));g.nodes.set(8,point(8,3,-8));
 g.visual.get(2).push({to:7,way},{to:8,way});
 g.visual.set(7,[{to:2,way},{to:8,way}]);g.visual.set(8,[{to:2,way},{to:7,way}]);
 const roads=engine.roadContinuations(g,1,traces);assert(roads.length<20);
 for(const node of [g.nodes.get(7),g.nodes.get(8)])assert(roads.some(r=>r.end==='limit'&&r.points[0].lat===node.lat&&r.points[0].lon===node.lon));
});
test('evaluation exports and diagrams remain unchanged despite extended roadbook drawings',()=>{
 const {frame}=fixture();frame.routeIn=[frame.branches[1].at(-1),frame.center];frame.routeOut=frame.branches[0];
 const frames=[0,1,2].map(i=>({...structuredClone(frame),id:'junction:'+i+':0',at:i*100,canOmit:i===1,checkpoints:[]}));
 const d=evaluation.buildDataset({result:{generationVersion:11,allFrames:frames},edits:{}},{id:'continued-roads'});
 const copy=evaluation.validateDataset(JSON.parse(JSON.stringify(evaluation.exportDataset(d))));assert.equal(copy.version,3);
 const candidate=copy.pairs[0].modelInput.candidate;assert.equal(candidate.roadContinuations,undefined);
 assert.deepEqual(candidate.branches,frame.branches);assert(diagram.render(candidate).includes('data-branch-end="junction"'));
 const original=structuredClone(frame);delete original.roadContinuations;
 assert.equal(diagram.render(frame),diagram.render(original));assert(!diagram.render(frame).includes('road-continuation'));
 const old=require('../site/data/evaluation-set-02.json'),before=JSON.stringify(old);evaluation.validateDataset(old);assert.equal(JSON.stringify(old),before);
});
