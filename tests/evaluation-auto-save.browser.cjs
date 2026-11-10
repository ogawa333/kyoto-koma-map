const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..'),api=require(root+'/site/evaluation-core.js');
const url=process.env.EVALUATION_TEST_URL||'http://127.0.0.1:8000/site/evaluation.html',KEY='kyoto-junction-evaluation-v1';
const base=JSON.parse(fs.readFileSync(root+'/site/data/evaluation-set-02.json'));base.pairs=base.pairs.slice(0,4);base.id='auto-save-test';
async function saved(p){return p.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);}
async function reset(p){await p.evaluate(([k,d])=>localStorage.setItem(k,JSON.stringify({dataset:d,evaluatorId:'P001',role:'participant',currentPairId:null,onlyPending:false})),[KEY,base]);await p.reload();}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await reset(p);
  assert.equal(await p.locator('#saveAnswer').count(),0);
  await p.locator('#notes').fill('左の枝道の角度');
  const choices=['clear','borderline','indistinguishable','uncertain'];
  for(let i=0;i<choices.length;i++){
   const before=(await saved(p)).currentPairId;
   await p.locator('label.choice:has(input[value='+choices[i]+'])').click();
   const s=await saved(p);assert.equal(s.dataset.responses.length,i+1);assert.equal(s.dataset.responses[i].choice,choices[i]);
   assert.equal(s.dataset.responses[i].revision,1);assert(s.dataset.responses[i].decisionMs<=s.dataset.responses[i].activeViewMs);
   if(i<3)assert.notEqual(s.currentPairId,before);else assert.equal(s.currentPairId,before);
  }
  assert.equal((await saved(p)).dataset.responses[0].notes,'左の枝道の角度');assert.match(await p.locator('#message').innerText(),/最後/);
  await p.reload();assert.equal((await saved(p)).dataset.responses.length,4);
  // Clicking an already-selected radio saves revisions and supports editing notes.
  await p.locator('#notes').fill('理由を追記');await p.locator('input[value=uncertain]').click();
  assert.equal((await saved(p)).dataset.responses.at(-1).revision,2);assert.equal((await saved(p)).dataset.responses.at(-1).notes,'理由を追記');
  await p.locator('#previous').click();const revising=(await saved(p)).currentPairId;await p.locator('input[value=clear]').click();
  assert.equal((await saved(p)).dataset.responses.find(r=>r.pairId===revising).choice,'clear');assert.equal((await saved(p)).dataset.responses.length,4);
  console.log('PASS all four choices auto-save once, notes, next, last, reload and revisions');
  await reset(p);await p.locator('label.choice:has(input[value=clear])').dblclick();
  assert.equal((await saved(p)).dataset.responses.length,1,'double-click must not answer the next question');
  assert.equal(await p.locator('[name=choice]:checked').count(),0);
  console.log('PASS double-click does not answer or select the next question');
  await reset(p);await p.locator('input[value=borderline]').focus();await p.keyboard.press('Space');assert.equal((await saved(p)).dataset.responses.length,1);
  console.log('PASS keyboard selection auto-saves');
  await reset(p);const before=(await saved(p)).currentPairId;await p.locator('#notes').fill('保存に失敗した回答');
  const disk=await p.evaluate(k=>localStorage.getItem(k),KEY);
  await p.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')};});
  await p.locator('input[value=clear]').click();
  assert.match(await p.locator('#message').innerText(),/保存できないため次へ進みません/);assert.equal(await p.evaluate(k=>localStorage.getItem(k),KEY),disk);
  assert.equal(await p.locator('#notes').inputValue(),'保存に失敗した回答');assert.equal(await p.locator('input[value=clear]').isChecked(),true);
  await p.locator('#settingsPanel').evaluate(e=>e.open=true);
  const downloadPromise=p.waitForEvent('download');await p.locator('#exportData').click();const download=await downloadPromise;
  const exported=api.validateDataset(JSON.parse(fs.readFileSync(await download.path())));assert.equal(exported.responses.length,1);assert.equal(exported.responses[0].notes,'保存に失敗した回答');
  await p.evaluate(()=>Storage.prototype.setItem=window.originalSetItem);await p.locator('input[value=clear]').click();
  assert.equal((await saved(p)).dataset.responses.length,1);assert.notEqual((await saved(p)).currentPairId,before);
  console.log('PASS quota failure stays on question, retains answer for export, and can retry');
  // The final unanswered-only question should finish without re-saving or advancing to another set.
  await reset(p);await p.locator('#onlyPending').check();
  for(let i=0;i<4;i++)await p.locator('input[value=clear]').click();
  assert.equal((await saved(p)).dataset.responses.length,4);assert.equal(await p.locator('#pairArea').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS unanswered filter completion and no JavaScript errors');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
