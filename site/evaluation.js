(function(){
  'use strict';
  const $=id=>document.getElementById(id),api=window.KomaEvaluation,KEY='kyoto-junction-evaluation-v1',COURSE='kyoto-komachizu-v1';
  let state={dataset:null,evaluatorId:'P001',role:'participant',currentPairId:null,onlyPending:false};
  let dirty=false,unsaved=false,elapsed=0,started=performance.now(),active=!document.hidden,decision=null;
  const message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
  const elapsedNow=()=>Math.min(86400000,Math.round(elapsed+(active?performance.now()-started:0)));
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){elapsed+=performance.now()-started;active=false;}else if(!document.hidden&&!active){started=performance.now();active=true;}});
  function persist(){
    try{localStorage.setItem(KEY,JSON.stringify(state));unsaved=false;$('storageStatus').textContent='このブラウザに保存済み';$('storageStatus').classList.remove('error');}
    catch{unsaved=true;$('storageStatus').textContent='自動保存できません。回答は画面内に保持しています。「評価JSONを保存」で書き出してください。';$('storageStatus').classList.add('error');}
  }
  function discardDraft(){return !dirty||confirm('この回答はまだ保存していません。移動してよいですか？');}
  function answerFor(id){return state.dataset?.responses.find(r=>r.pairId===id&&r.evaluatorId===state.evaluatorId);}
  function orderedPairs(){
    function hash(s){let value=2166136261;for(const c of s){value^=c.charCodeAt(0);value=Math.imul(value,16777619);}return value>>>0;}
    return [...(state.dataset?.pairs||[])].sort((a,b)=>hash(a.id)-hash(b.id)).filter(p=>!state.onlyPending||!answerFor(p.id));
  }
  function currentPair(){return state.dataset?.pairs.find(p=>p.id===state.currentPairId);}
  const rate=value=>value===null?'—':(value*100).toFixed(1)+'%';
  function renderSummary(){
    const s=api.summary(state.dataset,state.evaluatorId),rows=[['この評価者の回答数',s.responses],['比較できる回答数',s.evaluated],['判断保留（比較から除外）',s.uncertain],['ルール確認後の再回答（比較から除外）',s.unblinded],['誤省略：残すべきなのにルールは間引く',s.falseOmit],['不要な保持：区別できるのにルールは残す',s.unnecessaryKeep],['誤省略率：誤省略 ÷ 人間が残すとした回答',rate(s.falseOmissionRate)],['省略の適切さ：適切な省略 ÷ ルールの省略',rate(s.omissionPrecision)],['ギリギリ区別できる回答の省略率',rate(s.borderlineOmissionRate)]];
    const table=document.createElement('table');
    for(const [label,value] of rows){const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;th.scope='row';td.textContent=String(value);tr.append(th,td);table.append(tr);}
    const note=document.createElement('p');note.className='small';note.textContent='少ない回答数で精度を断定しないでください。複数の評価者の回答はJSONに個別に残ります。';$('summaryData').replaceChildren(table,note);
  }
  function render(){
    const dataset=state.dataset;$('workspace').hidden=!dataset;$('exportData').disabled=!dataset;
    $('evaluatorId').value=state.evaluatorId;$('role').value=state.role;$('onlyPending').checked=state.onlyPending;
    if(!dataset){$('sourceInfo').textContent='評価セットがありません。コマ地図を生成するか、評価JSONを読み込んでください。';return;}
    $('sourceInfo').textContent=dataset.source.courseName+' ／ '+dataset.pairs.length+'ペア ／ 作成 '+new Date(dataset.createdAt).toLocaleString('ja-JP');
    const list=orderedPairs();if(!list.some(p=>p.id===state.currentPairId))state.currentPairId=list[0]?.id||null;
    const pair=currentPair(),index=list.findIndex(p=>p.id===state.currentPairId),answered=dataset.responses.filter(r=>r.evaluatorId===state.evaluatorId).length;
    $('progress').textContent=(pair?(index+1)+' / '+list.length+'ペア':'完了')+' ・ '+state.evaluatorId+' 回答済み '+answered+' / '+dataset.pairs.length;
    $('previous').disabled=index<=0;$('next').disabled=index<0||index>=list.length-1;
    $('pairArea').hidden=!pair;$('emptyState').hidden=!!pair;renderSummary();
    if(!pair)return;
    const answer=answerFor(pair.id);
    $('targetDiagram').innerHTML=window.KomaDiagram.render(pair.modelInput.target,true);
    $('candidateDiagram').innerHTML=window.KomaDiagram.render(pair.modelInput.candidate,false);
    $('answerForm').reset();$('notes').value=answer?.notes||'';
    for(const input of document.querySelectorAll('[name=choice]'))input.checked=input.value===answer?.choice;
    $('ruleResult').open=false;$('ruleResult').hidden=!answer;
    $('ruleText').textContent='このペアの形状判定：'+(pair.rulePrediction==='keep'?'似ている（残す判定）':'別の形（間引く判定）')+'。この回答：'+(answer?api.CHOICES[answer.choice].label:'未回答');
    elapsed=0;started=performance.now();active=!document.hidden;decision=null;dirty=false;
  }
  function focusComparison(){
    $('workspace').scrollIntoView({block:'start'});
    if(currentPair())$('pairArea').focus({preventScroll:true});
  }
  function move(delta){
    if(!discardDraft())return;const list=orderedPairs(),index=list.findIndex(p=>p.id===state.currentPairId),next=list[index+delta];if(!next)return;
    state.currentPairId=next.id;render();persist();focusComparison();
  }
  function buildFromCourse(){
    try{
      const course=JSON.parse(localStorage.getItem(COURSE)||'null');
      const dataset=api.buildDataset(course,{id:crypto.randomUUID()});
      if(!discardDraft())return;
      if(state.dataset?.responses.length&&!confirm('新しい評価セットに切り替えます。前の回答を残すには、先に評価JSONを保存してください。切り替えてよいですか？'))return;
      state.dataset=dataset;state.currentPairId=null;state.onlyPending=false;render();persist();message('評価セットを作成しました。現行ルールの判定は回答するまで表示しません。');
    }catch(error){message(error.message,true);}
  }
  $('identityForm').onsubmit=event=>{
    event.preventDefault();const code=$('evaluatorId').value.trim(),role=$('role').value;
    if(!code||code.length>40||/[\u0000-\u001f\u007f]/.test(code)){message('評価者コードは1〜40文字で入力してください。',true);return;}
    if(!discardDraft())return;state.evaluatorId=code;state.role=role;state.currentPairId=null;render();persist();message('評価者を '+code+' に切り替えました。');
  };
  $('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);$('newDataset').onclick=buildFromCourse;
  $('onlyPending').onchange=()=>{if(!discardDraft()){$('onlyPending').checked=state.onlyPending;return;}state.onlyPending=$('onlyPending').checked;state.currentPairId=null;render();persist();};
  for(const input of document.querySelectorAll('[name=choice]'))input.onchange=()=>{decision=elapsedNow();dirty=true;};
  $('notes').oninput=()=>{dirty=true;};
  $('answerForm').onsubmit=event=>{
    event.preventDefault();const pair=currentPair(),choice=document.querySelector('[name=choice]:checked')?.value;if(!pair||!choice)return;
    try{
      const list=orderedPairs(),index=list.findIndex(p=>p.id===pair.id),next=list[index+1]?.id;
      const old=answerFor(pair.id),now=elapsedNow();
      state.dataset=api.saveResponse(state.dataset,{pairId:pair.id,evaluatorId:state.evaluatorId,role:state.role,choice,notes:$('notes').value.trim(),activeViewMs:now,decisionMs:Math.min(decision??now,now),updatedAt:new Date().toISOString(),...(old?.ruleViewedAt?{ruleViewedAt:old.ruleViewedAt}:{})});
      dirty=false;state.currentPairId=next||pair.id;render();persist();focusComparison();message(next?'回答を記録しました。': '回答を記録しました。最後のペアです。JSONを保存して、回答を持ち出せます。');
    }catch(error){message(error.message,true);}
  };
  $('ruleResult').addEventListener('toggle',()=>{
    if(!$('ruleResult').open||$('ruleResult').hidden)return;const pair=currentPair(),answer=pair&&answerFor(pair.id);if(!answer||answer.ruleViewedAt)return;
    answer.ruleViewedAt=new Date().toISOString();persist();
  });
  $('exportData').onclick=()=>{
    if(!state.dataset)return;
    if(dirty&&!confirm('入力中の回答はまだ含まれていません。保存済みの回答を書き出してよいですか？'))return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(api.exportDataset(state.dataset),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='kyoto-junction-evaluation-'+state.dataset.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('評価JSONを書き出しました。学習時はmodelInputを使い、context・rulePredictionを入力特徴に混ぜないでください。');
  };
  $('importData').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>15*1024*1024)throw new Error('評価JSONは15MB以下にしてください。');
      const incoming=api.validateDataset(JSON.parse(await file.text()));
      const merged=api.mergeDatasets(state.dataset,incoming);
      if(!discardDraft())return;
      if(state.dataset&&state.dataset.id!==incoming.id&&state.dataset.responses.length&&!confirm('別の評価セットに切り替えます。現在の回答は書き出し済みですか？'))return;
      state.dataset=merged;state.currentPairId=null;state.onlyPending=false;render();persist();message('評価JSONを読み込みました。同じセットの異なる評価者の回答は統合しています。');
    }catch(error){message(error.message,true);}
  };
  window.addEventListener('beforeunload',event=>{if(dirty||unsaved){event.preventDefault();event.returnValue='';}});
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved?.dataset){api.validateDataset(saved.dataset);state={dataset:saved.dataset,evaluatorId:typeof saved.evaluatorId==='string'&&saved.evaluatorId.length<=40?saved.evaluatorId:'P001',role:api.ROLES.includes(saved.role)?saved.role:'participant',currentPairId:saved.currentPairId,onlyPending:!!saved.onlyPending};render();message('前回の評価セットと回答を復元しました。');$('storageStatus').textContent='このブラウザに保存済み';}
    else{render();if(localStorage.getItem(COURSE))buildFromCourse();}
  }catch(error){render();message('保存済みデータを復元できませんでした。評価JSONから読み込めます。'+error.message,true);}
})();
