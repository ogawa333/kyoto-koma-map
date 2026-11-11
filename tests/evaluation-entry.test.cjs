const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../site/routing.js'),diagram=require('../site/diagram.js'),api=require('../site/evaluation-core.js');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../site/data/evaluation-incoming-roads.js'),'utf8'),sandbox);
const verified=sandbox.window.KOMA_INCOMING_ROADS;
function frame(){
 const center={lat:35,lon:135},p=(x,y)=>({lat:35+y/111320,lon:135+x/111320/Math.cos(35*Math.PI/180)});
 const branches=[[center,p(0,-6),p(-12,-20)],[center,p(0,28)],[center,p(12,-20)]];
 return {center,heading:0,branches,branchEnds:['limit','limit','limit'],routeIn:[p(-12,-20),p(0,-6),center],routeOut:branches[1]};
}
test('actual approach determines the arrival branch; candidates reveal no exit arrow or added geometry',()=>{
 const f=frame(),index=engine.incomingBranchIndex(f);assert.equal(index,0);
 const svg=diagram.render(f,false,index);assert(svg.includes('evaluation-entry'));assert(svg.includes('data-incoming-branch="0"'));assert(svg.includes(diagram.geometry(f).path(f.branches[0])));
 assert(!svg.includes('marker-end'));assert(!svg.includes('evaluation-route-out'));assert(!svg.includes('evaluation-route-in'));assert(svg.includes('青い太線'));
 assert(!diagram.render(f,false).includes('evaluation-entry'));assert(!diagram.render(f,true,index).includes('evaluation-entry'));
 assert(!diagram.render(f,false,99).includes('evaluation-entry'));
});
test('verified map matches all 600 archived geometries and corrects direction-only mistakes',()=>{
 let count=0;
 for(let n=2;n<=7;n++){const d=require('../site/data/evaluation-set-0'+n+'.json');for(const p of d.pairs){const entry=verified.datasets[d.id][p.id];assert(entry);assert(Number.isInteger(entry[0])&&entry[0]>=0&&entry[0]<p.modelInput.candidate.branches.length);assert.equal(entry[1],diagram.fingerprint(p.modelInput.candidate));count++;}}
 assert.equal(count,600);
 const d=require('../site/data/evaluation-set-02.json');
 for(const [suffix,index]of [[33,2],[40,3]]){const p=d.pairs.find(p=>p.id===d.id+':pair:'+suffix);assert.equal(verified.datasets[d.id][p.id][0],index);assert.notEqual(diagram.inferredIncomingBranch(p.modelInput.candidate),index);}
});
test('unresolved geometry does not invent an arrival branch and fingerprint checks detect altered questions',()=>{
 const f=frame();assert.equal(engine.incomingBranchIndex({...f,routeIn:[]}),null);
 const ambiguous={...f,branches:[f.branches[0],f.branches[0],f.branches[1]]};assert.equal(engine.incomingBranchIndex(ambiguous),null);assert.equal(diagram.inferredIncomingBranch(ambiguous),null);
 const before=diagram.fingerprint(f);f.branches[0][1].lat+=.00001;assert.notEqual(diagram.fingerprint(f),before);
});
test('new questions include only the arrival index in context; response view metadata survives export',()=>{
 const f=frame(),frames=[0,1,2].map(i=>({...structuredClone(f),id:'junction:'+i+':0',at:i*100,canOmit:i===1,checkpoints:[]}));
 const dataset=api.buildDataset({result:{generationVersion:engine.GENERATION_VERSION,allFrames:frames}},{id:'entry-test'});
 assert.equal(dataset.pairs[0].context.candidateIncomingBranch,0);assert.equal(dataset.pairs[0].modelInput.candidate.routeIn,undefined);assert.equal(dataset.pairs[0].modelInput.candidate.routeOut,undefined);
 const response={pairId:dataset.pairs[0].id,evaluatorId:'P001',role:'participant',choice:'borderline',notes:'',activeViewMs:1000,decisionMs:500,updatedAt:new Date().toISOString(),diagramPresentation:'candidate-entry-v1',candidateIncomingBranch:0,entrySource:'route'};
 const next=api.saveResponse(dataset,response),copy=api.validateDataset(JSON.parse(JSON.stringify(api.exportDataset(next))));
 assert.equal(copy.responses[0].candidateIncomingBranch,0);assert.equal(copy.responses[0].diagramPresentation,'candidate-entry-v1');
 const old={...response};delete old.diagramPresentation;delete old.candidateIncomingBranch;delete old.entrySource;assert.equal(api.saveResponse(dataset,old).responses[0].diagramPresentation,undefined);
 assert.throws(()=>api.saveResponse(dataset,{...response,candidateIncomingBranch:99}));
 const invalid=structuredClone(dataset);invalid.pairs[0].context.candidateIncomingBranch=99;assert.throws(()=>api.validateDataset(invalid));
});
