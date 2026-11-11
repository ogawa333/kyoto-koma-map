const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..'),engine=require(root+'/site/routing.js'),api=require(root+'/site/evaluation-core.js');
global.window={};require(root+'/site/data/kyoto-network.js');const data=global.window.KYOTO_NETWORK;delete global.window;
const base=process.env.KOMA_TEST_URL||'http://127.0.0.1:8030/site/';
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const p=await b.newPage({viewport:{width:1366,height:768}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const locations=engine.orderWaypoints(data.sampleLocations,()=>.999),result=engine.generate(data,locations);
 const legacy=JSON.parse(JSON.stringify({...result,allFrames:result.frames,generationVersion:11,name:'保存済みコース'}));for(const f of [...legacy.frames,...legacy.allFrames])delete f.branchEnds;
 const frameId=legacy.frames[10].id;
 await p.addInitScript(({locations,legacy,frameId})=>{
  if(!localStorage.getItem('kyoto-komachizu-v1'))localStorage.setItem('kyoto-komachizu-v1',JSON.stringify({version:4,locations,result:legacy,settings:{name:'保存済みコース',frameMode:'reduced',routeOrder:'input',autoLandmarks:true},edits:{[frameId]:{note:'保存済みの追記'}},dirty:false}));
 },{locations,legacy,frameId});
 await p.goto(base+'index.html');await p.waitForSelector('.koma');
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('kyoto-komachizu-v1'))?.result?.generationVersion===10);
 const course=await p.evaluate(()=>JSON.parse(localStorage.getItem('kyoto-komachizu-v1')));
 assert.equal(course.edits[frameId].note,'保存済みの追記');assert.deepEqual(course.locations,locations);assert(course.result.allFrames.every(f=>f.branchEnds.length===f.branches.length));
 assert(await p.locator('.diagram [data-branch-end=junction]').count()>0);assert(await p.locator('#endingLegend').isVisible());
 await p.locator('.koma').first().screenshot({path:'/tmp/koma-endings-main.png'});
 const exported=api.buildDataset(course,{id:'new-browser-evaluation'});assert.equal(exported.version,3);
 const popup=p.waitForEvent('popup');await p.getByRole('link',{name:'交差点を評価',exact:true}).click();const e=await popup;e.on('pageerror',error=>errors.push(error.message));await e.waitForSelector('#candidateDiagram svg');
 const saved=await e.evaluate(()=>JSON.parse(localStorage.getItem('kyoto-junction-evaluation-v1')));
 assert.equal(saved.dataset.version,3);assert.equal(saved.dataset.pairs.length,100);assert.equal(saved.dataset.source.ruleVersion,engine.RULE_VERSION);
 assert(await e.locator('#endingLegend').isVisible());assert(await e.locator('#candidateDiagram [data-branch-end]').count()>0);assert.equal(await e.locator('#candidateDiagram [marker-end]').count(),0);
 for(const [width,height]of [[1280,640],[1366,768],[1024,768],[1920,1080]]){
  await e.setViewportSize({width,height});await e.evaluate(()=>scrollTo(0,0));
  for(const selector of ['#candidateDiagram svg','#targetDiagram svg','#notes',...['clear','borderline','indistinguishable','uncertain'].map(v=>'label.choice:has(input[value='+v+'])')]){const box=await e.locator(selector).boundingBox();assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify({width,height,selector,box}));}
 }
 await e.locator('input[value=borderline]').click();assert.equal((await e.evaluate(()=>JSON.parse(localStorage.getItem('kyoto-junction-evaluation-v1')))).dataset.responses.length,1);
 await e.reload();assert.equal((await e.evaluate(()=>JSON.parse(localStorage.getItem('kyoto-junction-evaluation-v1')))).dataset.responses.length,1);
 await e.locator('#settingsPanel').evaluate(el=>el.open=true);const downloadPromise=e.waitForEvent('download');await e.locator('#exportData').click();const download=await downloadPromise;const roundtrip=api.validateDataset(JSON.parse(fs.readFileSync(await download.path())));assert.equal(roundtrip.version,3);assert(roundtrip.pairs[0].modelInput.candidate.branchEnds);
 await e.locator('#evaluationSet').selectOption('50b2bef2-face-4e6a-9085-6a14026b5cde');await e.locator('#openEvaluationSet').click();await e.waitForFunction(()=>JSON.parse(localStorage.getItem('kyoto-junction-evaluation-v1')).dataset.version===2);
 assert.equal(await e.locator('#endingLegend').isVisible(),false);assert.equal(await e.locator('#candidateDiagram [data-branch-end]').count(),0);assert.match(await e.locator('#sourceInfo').innerText(),/従来の図/);
 assert.deepEqual(errors,[]);console.log('PASS old course migration preserves order/notes; new glyphs; version3 evaluation/export/reload; desktop fit; historical datasets unchanged');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
