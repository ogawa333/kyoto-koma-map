const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../site/routing.js'),diagram=require('../site/diagram.js'),evaluation=require('../site/evaluation-core.js');
function point(id,x,y,tags={}){return {id,lat:35+y/111320,lon:135+x/111320/Math.cos(35*Math.PI/180),tags};}
function data(nodes,paths){return {nodes,ways:paths.map((path,i)=>({id:i+1,nodes:path,tags:{highway:'residential'}})),places:[],signs:[]};}
function shape(angles,length=28){const center=point(0,0,0);return {center,heading:0,branches:angles.map(d=>[center,point(1,Math.sin(d*Math.PI/180)*length,Math.cos(d*Math.PI/180)*length)])};}
test('a nearby junction is a continuation cutoff, never a dead end',()=>{
 const g=engine.graph(data([point(1,0,0),point(2,0,3),point(3,0,20),point(4,20,3)],[[1,2,3],[2,4]]));
 const traced=engine.traceRoad(g,1,2);assert.equal(traced.end,'junction');assert(traced.points.length===2);assert(engine.distance(traced.points[0],traced.points[1])<4);
});
test('only a registered noexit leaf is labeled dead-end; an unverified leaf stays unknown',()=>{
 const d=data([point(1,0,0),point(2,0,4)],[[1,2]]);
 assert.equal(engine.traceRoad(engine.graph(d),1,2).end,'unknown');
 d.nodes[1].tags.noexit='yes';assert.equal(engine.traceRoad(engine.graph(d),1,2).end,'dead-end');
 delete d.nodes[1].tags.noexit;d.ways[0].tags.noexit='yes';assert.equal(engine.traceRoad(engine.graph(d),1,2).end,'dead-end');
});
test('range cutoff and loop are continuations even when the far endpoint is registered noexit',()=>{
 const d=data([point(1,0,0),point(2,0,50,{noexit:'yes'})],[[1,2]]);const clipped=engine.traceRoad(engine.graph(d),1,2);
 assert.equal(clipped.end,'limit');assert(Math.abs(engine.distance(clipped.points[0],clipped.points[1])-28)<.01);
 const loop=engine.graph(data([point(1,0,0),point(2,1,0),point(3,1,1)],[[1,2,3,1]]));assert.equal(engine.traceRoad(loop,1,2).end,'loop');
});
test('similarity keeps a short angular ambiguity but distinguishes the same angle on long branches',()=>{
 const a=shape([180,0,90],4),b=shape([180,0,60],4);assert.equal(engine.similarJunctions(a,b),true);
 assert.equal(engine.similarJunctions(shape([180,0,90]),shape([180,0,60])),false);
 assert.equal(engine.similarJunctions(shape([180,0,90],.5),shape([180,0,44],.5)),false);
 assert.equal(engine.similarJunctions(shape([180,0,90],4),shape([180,0,50],4)),true);
 assert.equal(engine.similarJunctions(shape([180,0,90],5),shape([180,0,50],5)),false);
 assert.equal(engine.similarJunctions(shape([180,0,90],.5),shape([180,0,-90],.5)),false);
 assert.equal(engine.similarJunctions(a,shape([180,0,60,90],4)),false);
 assert.equal(engine.similarJunctions(a,a),true);
});
test('ending annotations preserve all road paths, avoid route arrows on candidates and retain old displays',()=>{
 const f=shape([180,0,90],4);f.branchEnds=['junction','dead-end','unknown'];const svg=diagram.render(f,false);
 assert(svg.includes('data-branch-end="junction"'));assert(svg.includes('data-branch-end="dead-end"'));assert(svg.includes('data-branch-end="unknown"'));
 assert(!svg.includes('marker-end'));assert(svg.includes('道は先へ続きます'));
 delete f.branchEnds;assert(!diagram.render(f).includes('branch-ending'));
});
test('new evaluation exports preserve endings and rule metadata; original sets remain unchanged',()=>{
 const original=require('../site/data/evaluation-set-02.json');const old=JSON.stringify(original);evaluation.validateDataset(evaluation.exportDataset(original));assert.equal(JSON.stringify(original),old);
 const f=shape([180,0,90]);f.branchEnds=['limit','limit','limit'];f.routeIn=[f.branches[0][1],f.center];f.routeOut=f.branches[1];
 const frames=[0,1,2].map((i)=>({...structuredClone(f),id:'junction:'+i+':0',at:i*100,canOmit:i===1,checkpoints:[]}));
 const d=evaluation.buildDataset({result:{generationVersion:11,allFrames:frames,sourceDate:null},edits:{}},{id:'new-ends'});
 assert.equal(d.version,3);assert.equal(d.source.ruleVersion,engine.RULE_VERSION);assert.equal(d.source.ruleSvgTolerance,8);assert.equal(d.source.presentationVersion,'branch-ends-v1');assert(d.pairs[0].modelInput.candidate.branchEnds);
 evaluation.validateDataset(evaluation.exportDataset(d));
 const bad=structuredClone(d);bad.pairs[0].modelInput.candidate.branchEnds=['limit'];assert.throws(()=>evaluation.validateDataset(bad));
 const downgraded=structuredClone(d);downgraded.version=2;assert.throws(()=>evaluation.validateDataset(downgraded));
 assert.throws(()=>evaluation.extendDataset(original,d,{count:101,courseId:'new',name:'new'}),/版が異なる/);
});
