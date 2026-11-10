const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..'),api=require(root+'/site/evaluation-core.js');
const url=process.env.EVALUATION_TEST_URL||'http://127.0.0.1:8000/site/evaluation.html';
const KEY='kyoto-junction-evaluation-v1',two='50b2bef2-face-4e6a-9085-6a14026b5cde',three='88924b4c-094f-4b42-925a-08aec0f6a121';
const initial=JSON.parse(fs.readFileSync(root+'/site/data/evaluation-set-02.json'));
initial.id='old-evaluation';initial.source.courseName='以前の評価セット';initial.pairs=initial.pairs.slice(0,6);
const old=api.saveResponse(initial,{pairId:initial.pairs[0].id,evaluatorId:'P001',role:'participant',choice:'clear',notes:'以前の回答',activeViewMs:1000,decisionMs:500,updatedAt:new Date().toISOString()});
async function saved(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY)}
async function choose(page,id){await page.locator('#evaluationSet').selectOption(id);await page.locator('#openEvaluationSet').click();await page.waitForFunction(([key,id])=>JSON.parse(localStorage.getItem(key)).dataset.id===id,[KEY,id]);}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1280,height:640}});const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url);
 await p.evaluate(([key,dataset])=>localStorage.setItem(key,JSON.stringify({dataset,evaluatorId:'P001',role:'participant',onlyPending:false,currentPairId:null})),[KEY,old]);await p.reload();
 assert.match(await p.locator('#progress').innerText(),/回答済み 1 \/ 6/);
 await choose(p,two);assert.equal((await saved(p)).otherDatasets[0].responses[0].notes,'以前の回答');
 assert.equal(await p.locator('#candidateDiagram svg, #targetDiagram svg').count(),2);
 for(const [width,height] of [[1280,640],[1366,768],[1024,768],[1920,1080]]){
  await p.setViewportSize({width,height});await p.evaluate(()=>scrollTo(0,0));
  for(const sel of ['#candidateDiagram svg','#targetDiagram svg',...['clear','borderline','indistinguishable','uncertain'].map(v=>'label.choice:has(input[value='+v+'])'),'#notes']){
   const b=await p.locator(sel).boundingBox();assert(b&&b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1,JSON.stringify({width,height,sel,b}));
  }
 }
 await p.locator('[name=choice][value=borderline]').click();
 assert.equal((await saved(p)).dataset.responses.length,1);
 await choose(p,three);await p.locator('[name=choice][value=indistinguishable]').click();
 await p.reload();assert.equal((await saved(p)).otherDatasets.length,2);
 await choose(p,two);assert.equal((await saved(p)).dataset.responses[0].choice,'borderline');
 await choose(p,'old-evaluation');assert.equal((await saved(p)).dataset.responses[0].notes,'以前の回答');
 // Importing the original unanswered preset must not erase a saved answer.
 await p.locator('#settingsPanel').evaluate(e=>e.open=true);await p.locator('#importData').setInputFiles(root+'/site/data/evaluation-set-02.json');
 await p.waitForFunction(([key,id])=>JSON.parse(localStorage.getItem(key)).dataset.id===id,[KEY,two]);assert.equal((await saved(p)).dataset.responses.length,1);
 // A cancelled unsaved answer must stay on the current question.
 await p.locator('#notes').fill('入力途中');p.once('dialog',d=>d.dismiss());await p.locator('#evaluationSet').selectOption(three);await p.locator('#openEvaluationSet').click();
 assert.equal((await saved(p)).dataset.id,two);assert.equal(await p.locator('#notes').inputValue(),'入力途中');
 // Storage quota failure must keep the prior answers, draft and disk copy intact.
 await p.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')};});
 p.once('dialog',d=>d.accept());await p.locator('#openEvaluationSet').click();assert.match(await p.locator('#message').innerText(),/保存容量/);
 assert.equal((await saved(p)).dataset.id,two);assert.equal(await p.locator('#notes').inputValue(),'入力途中');
 await p.evaluate(()=>Storage.prototype.setItem=window.originalSetItem);await p.locator('#notes').fill('');await p.locator('[name=choice][value=clear]').click();
 // Miura presets load directly, save answers, and resume without changing Kyoto answers.
 const fourth=JSON.parse(fs.readFileSync(root+'/site/data/evaluation-set-04.json'));
 const fifth=JSON.parse(fs.readFileSync(root+'/site/data/evaluation-set-05.json'));
 await choose(p,fourth.id);assert.match(await p.locator('#activeSetStatus').innerText(),/④.*三浦/);
 assert.equal((await saved(p)).dataset.pairs.length,100);
 assert((await saved(p)).dataset.pairs.every(pair=>pair.modelInput.candidate.center.lon>139));
 await p.locator('[name=choice][value=borderline]').click();
 await choose(p,fifth.id);assert.match(await p.locator('#activeSetStatus').innerText(),/⑤.*三浦/);
 await p.locator('[name=choice][value=indistinguishable]').click();
 await p.reload();await choose(p,fourth.id);assert.equal((await saved(p)).dataset.responses[0].choice,'borderline');
 await choose(p,fifth.id);assert.equal((await saved(p)).dataset.responses[0].choice,'indistinguishable');
 console.log('PASS Miura sets IV/V load, save, switch and reload');
 // Archived presets resume even when the preset download fails.
 await p.route('**/data/evaluation-set-*.json',route=>route.abort());await choose(p,three);assert.equal((await saved(p)).dataset.responses.length,1);
 await p.locator('#settingsPanel').evaluate(e=>e.open=true);
 const downloadPromise=p.waitForEvent('download');await p.locator('#exportData').click();const download=await downloadPromise;
 const exported=api.validateDataset(JSON.parse(fs.readFileSync(await download.path())));assert.equal(exported.id,three);assert.equal(exported.responses.length,1);
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>scrollTo(0,0));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert(await p.locator('#openEvaluationSet').isVisible());
 assert.deepEqual(errors,[]);console.log('PASS migration, set switching, answer preservation, reload, import, cancel, quota failure, offline resume, export, desktop fit, mobile');
 const fresh=await context.newPage();await fresh.goto(url);await fresh.evaluate(key=>localStorage.removeItem(key),KEY);await fresh.reload();
 await fresh.route('**/data/evaluation-set-02.json',route=>route.fulfill({status:503,body:'unavailable'}));await fresh.locator('#openEvaluationSet').click();await fresh.waitForFunction(()=>document.querySelector('#message').classList.contains('error'));
 assert.equal(await fresh.locator('#exportData').isDisabled(),true);assert.equal(await saved(fresh),null);assert.equal(await fresh.locator('#openEvaluationSet').isDisabled(),false);console.log('PASS failed first download is retryable without modifying storage');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
