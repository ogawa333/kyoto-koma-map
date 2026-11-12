(function(){
  'use strict';
  const $=id=>document.getElementById(id),api=window.KomaEvaluation,KEY='kyoto-junction-evaluation-v1',COURSE='kyoto-komachizu-v1';
  let state={dataset:null,evaluatorId:'P001',role:'participant',currentPairId:null,onlyPending:false};
  const presetSets=[
    {id:'50b2bef2-face-4e6a-9085-6a14026b5cde',label:'追加セット②（100問）',url:'data/evaluation-set-02.json'},
    {id:'88924b4c-094f-4b42-925a-08aec0f6a121',label:'追加セット③（100問）',url:'data/evaluation-set-03.json'},
    {id:'cbb5c4e3-75f2-40af-b7ca-c5ea65d647f8',label:'追加セット④（三浦・100問）',url:'data/evaluation-set-04.json'},
    {id:'58037cac-de65-419a-8c4d-552290b8f7e4',label:'追加セット⑤（三浦・100問）',url:'data/evaluation-set-05.json'},
    {id:'83031988-6c3b-57b5-9c8e-d0372282cbea',label:'追加セット⑥（三浦・重点評価100問）',url:'data/evaluation-set-06.json'},
    {id:'de6628d7-c538-563e-8514-d2bcfe226e59',label:'追加セット⑦（三浦・確認用100問）',url:'data/evaluation-set-07.json'},
    {id:'941a0ea9-815f-532b-879a-e504ed15078e',label:'追加セット⑧（三浦海岸・最終確認100問）',url:'data/evaluation-set-08.json'}
  ];
  let otherDatasets=[];
  let busy=false,networkPromise=null,disabledBeforeBusy=new Map();
  const storedDatasets=()=>[state.dataset,...otherDatasets].filter(Boolean);
  const setLabel=dataset=>presetSets.find(p=>p.id===dataset.id)?.label||dataset.source.courseName;
  function writeStorage(nextState=state,nextOthers=otherDatasets){
    localStorage.setItem(KEY,JSON.stringify({...nextState,otherDatasets:nextOthers}));
  }
  function renderSetPicker(){
    const datasets=storedDatasets(),options=new Map(presetSets.map(p=>[p.id,p.label]));
    for(const dataset of datasets)if(!options.has(dataset.id))options.set(dataset.id,setLabel(dataset));
    $('evaluationSet').replaceChildren(...[...options].map(([id,label])=>{
      const option=document.createElement('option'),dataset=datasets.find(d=>d.id===id);
      option.value=id;option.textContent=label+(dataset?' ・ 回答 '+dataset.responses.filter(r=>r.evaluatorId===state.evaluatorId).length+'/'+dataset.pairs.length:'');return option;
    }));
    $('evaluationSet').value=state.dataset?.id||presetSets[0].id;
    $('activeSetStatus').textContent=state.dataset?'表示中：'+setLabel(state.dataset):'追加セットはここから開始できます。';
  }
  function activateDataset(incoming,discardChecked=false){
    const prior=storedDatasets().find(d=>d.id===incoming.id);
    const dataset=api.mergeDatasets(prior,incoming);
    if(!discardChecked&&!discardDraft())return false;
    const nextOthers=storedDatasets().filter(d=>d.id!==dataset.id);
    const firstUnanswered=dataset.pairs.find(p=>!dataset.responses.some(r=>r.pairId===p.id&&r.evaluatorId===state.evaluatorId));
    const nextState={...state,dataset,currentPairId:state.dataset?.id===dataset.id?state.currentPairId:firstUnanswered?.id||null,onlyPending:false};
    // Write all sets atomically before replacing the active screen. On quota errors
    // the previous answers and the draft remain available for export.
    try{writeStorage(nextState,nextOthers);}catch{throw new Error('セットを切り替えるための保存容量が足りません。現在の回答は変更していません。評価JSONを保存し、空き容量のあるブラウザで追加セットを開いてください。');}
    state=nextState;otherDatasets=nextOthers;unsaved=false;render();
    $('storageStatus').textContent='このブラウザに保存済み';$('storageStatus').classList.remove('error');
    return true;
  }
  let dirty=false,unsaved=false,elapsed=0,started=performance.now(),active=!document.hidden,decision=null;
  const message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
  const elapsedNow=()=>Math.min(86400000,Math.round(elapsed+(active?performance.now()-started:0)));
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){elapsed+=performance.now()-started;active=false;}else if(!document.hidden&&!active){started=performance.now();active=true;}});
  function persist(){
    try{writeStorage();unsaved=false;$('storageStatus').textContent='このブラウザに保存済み';$('storageStatus').classList.remove('error');}
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
  function incomingInfo(pair){
    const frame=pair.modelInput.candidate,explicit=pair.context.candidateIncomingBranch;
    if(explicit!==undefined)return {index:explicit,source:explicit===null?'unknown':'route'};
    const records=window.KOMA_INCOMING_ROADS?.datasets?.[state.dataset.id],record=records?.[pair.id];
    if(record&&record[1]===window.KomaDiagram.fingerprint(frame))return {index:record[0],source:'verified'};
    if(records||presetSets.some(p=>p.id===state.dataset.id))return {index:null,source:'unknown'};
    const index=window.KomaDiagram.inferredIncomingBranch(frame);
    return {index,source:index===null?'unknown':'inferred'};
  }
  function render(){
    renderSetPicker();
    const dataset=state.dataset;
    $('endingLegend').hidden=dataset?.source.presentationVersion!=='branch-ends-v1';
    $('endingLegend').innerHTML=window.KomaDiagram.endingLegend();
    $('workspace').hidden=!dataset;$('exportData').disabled=!dataset;$('expandDataset').disabled=!dataset||dataset.pairs.length>=100||dataset.source.ruleVersion!==window.KomaRouting.RULE_VERSION;
    $('settingsSummary').textContent='評価者・保存・JSON操作（'+state.evaluatorId+'）';
    $('evaluatorId').value=state.evaluatorId;$('role').value=state.role;$('onlyPending').checked=state.onlyPending;
    if(!dataset){$('sourceInfo').textContent='評価セットがありません。上の選択欄から追加セット②〜⑧を開くか、評価JSONを読み込んでください。';return;}
    $('sourceInfo').textContent=dataset.source.courseName+' ／ '+dataset.pairs.length+'ペア'+(dataset.source.supplementalCourses?.length?'（補充コース'+dataset.source.supplementalCourses.length+'件を含む）':'')+(dataset.version<3?' ／ 従来の図・判定（回答当時の表示）':' ／ 道路端の記号と新しい判定')+' ／ 作成 '+new Date(dataset.createdAt).toLocaleString('ja-JP');
    const list=orderedPairs();if(!list.some(p=>p.id===state.currentPairId))state.currentPairId=list[0]?.id||null;
    const pair=currentPair(),index=list.findIndex(p=>p.id===state.currentPairId),answered=dataset.responses.filter(r=>r.evaluatorId===state.evaluatorId).length;
    $('progress').textContent=(pair?(index+1)+' / '+list.length+'ペア':'完了')+' ・ '+state.evaluatorId+' 回答済み '+answered+' / '+dataset.pairs.length;
    $('previous').disabled=index<=0;$('next').disabled=index<0||index>=list.length-1;
    $('pairArea').hidden=!pair;$('emptyState').hidden=!!pair;renderSummary();
    if(!pair)return;
    const answer=answerFor(pair.id);
    $('targetDiagram').innerHTML=window.KomaDiagram.render(pair.modelInput.target,true);
    const incoming=incomingInfo(pair);
    $('candidateDiagram').innerHTML=window.KomaDiagram.render(pair.modelInput.candidate,false,incoming.index);
    $('candidateHelp').textContent=incoming.source==='unknown'?'進入した道を特定できません。判断が難しい場合は保留してください。':incoming.source==='inferred'?'青い太線は進入方向からの推定です。形を見分けられますか？':'青い太線は歩いてきた道です。形を見分けられますか？';
    $('answerForm').reset();$('notes').value=answer?.notes||'';
    for(const input of document.querySelectorAll('[name=choice]'))input.checked=input.value===answer?.choice;
    $('ruleResult').open=false;$('ruleResult').hidden=!answer;
    const origin=dataset.source.supplementalCourses?.find(c=>c.id===pair.context.courseId)?.name||dataset.source.courseName;
    $('ruleText').textContent='出典：'+origin+'。このペアの形状判定：'+(pair.rulePrediction==='keep'?'似ている（残す判定）':'別の形（間引く判定）')+'。この回答：'+(answer?api.CHOICES[answer.choice].label:'未回答');
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
  function setBusy(value){
    busy=value;
    if(value){disabledBeforeBusy=new Map();for(const el of document.querySelectorAll('button,input,select,textarea')){disabledBeforeBusy.set(el,el.disabled);el.disabled=true;}}
    else{for(const [el,disabled] of disabledBeforeBusy)el.disabled=disabled;disabledBeforeBusy.clear();}
  }
  $('openEvaluationSet').onclick=async()=>{
    if(busy)return;
    const id=$('evaluationSet').value,saved=storedDatasets().find(d=>d.id===id),preset=presetSets.find(p=>p.id===id);
    try{
      if(saved){if(activateDataset(saved))message(setLabel(saved)+'の回答を復元しました。');return;}
      if(!preset)throw new Error('評価セットを選んでください。');
      setBusy(true);message(preset.label+'を読み込んでいます…');
      const response=await fetch(preset.url);
      if(!response.ok)throw new Error('追加セットを読み込めません。接続を確認して再試行してください。');
      const dataset=api.validateDataset(await response.json());
      if(dataset.id!==preset.id||dataset.pairs.length!==100||dataset.responses.length)throw new Error('追加セットの内容を確認できません。');
      setBusy(false);
      if(activateDataset(dataset))message(preset.label+'を開きました。回答はセットごとに保存され、切り替えても再開できます。');
    }catch(error){if(busy)setBusy(false);message(error.message,true);}
  };
  function loadNetwork(){
    if(window.KYOTO_NETWORK?.sampleLocations)return Promise.resolve(window.KYOTO_NETWORK);
    if(networkPromise)return networkPromise;
    networkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='data/kyoto-network.js';
      script.onload=()=>{script.remove();if(window.KYOTO_NETWORK?.sampleLocations)resolve(window.KYOTO_NETWORK);else reject(new Error('京都の補充用データが未準備です。'));};
      script.onerror=()=>{script.remove();reject(new Error('補充用の京都データを読み込めません。接続を確認して再試行してください。'));};document.head.append(script);
    }).catch(error=>{networkPromise=null;throw error;});
    return networkPromise;
  }
  async function fillTo100(dataset){
    if(dataset.pairs.length>=100)return dataset;
    message('100ペアを準備しています。京都の補充用コースを確認しています…');
    const network=await loadNetwork(),variants=[];
    let course;try{course=JSON.parse(localStorage.getItem(COURSE)||'null');}catch{}
    if(!course?.dirty&&Array.isArray(course?.locations)&&course.locations.length>=2&&course.locations.length<=12){
      const courseName=typeof course.result?.name==='string'?course.result.name.slice(0,150):'現在のコース';
      variants.push({name:courseName+'・補充訪問順A',locations:window.KomaRouting.orderWaypoints(course.locations,()=>0)},{name:courseName+'・補充訪問順B',locations:window.KomaRouting.orderWaypoints(course.locations,()=>.999)});
    }
    variants.push({name:'京都サンプル・訪問順A',locations:window.KomaRouting.orderWaypoints(network.sampleLocations,()=>0)},{name:'京都サンプル・訪問順B',locations:window.KomaRouting.orderWaypoints(network.sampleLocations,()=>.999)});
    const seen=new Set(),failures=[];
    for(const variant of variants){
      if(dataset.pairs.length>=100)break;
      const routeKey=JSON.stringify(variant.locations.map(p=>[p.lat,p.lon,!!p.checkpoint]));if(seen.has(routeKey))continue;seen.add(routeKey);
      message('100ペアを準備中：'+dataset.pairs.length+' / 100。'+variant.name+' を確認しています…');
      await new Promise(resolve=>setTimeout(resolve,0));
      try{
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(routeKey+'|'+network.timestamp+'|'+dataset.source.ruleVersion));
        const courseId='route-'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
        const prior=dataset.source.supplementalCourses?.find(c=>c.id===courseId);
        const result=window.KomaRouting.generate(network,variant.locations);
        const pool=api.buildDataset({result:{...result,allFrames:result.frames,name:prior?.name||variant.name},edits:{}},{id:'supplement-pool'});
        dataset=api.extendDataset(dataset,pool,{count:100,courseId,name:prior?.name||variant.name});
      }catch(error){failures.push(error.message);}
    }
    if(dataset.pairs.length<100)throw new Error('重複しない100ペアを用意できませんでした。元の回答は変更していません。'+failures.join(' / '));
    return dataset;
  }
  async function buildFromCourse(expand=false){
    if(busy)return;let preparationStarted=false;
    try{
      if(expand&&(!state.dataset||state.dataset.pairs.length>=100))return;
      const course=expand?null:JSON.parse(localStorage.getItem(COURSE)||'null');
      const base=expand?state.dataset:api.sizeUnansweredDataset(api.buildDataset(course,{id:crypto.randomUUID()}),100);
      if(!discardDraft())return;
      setBusy(true);preparationStarted=true;const dataset=await fillTo100(base);
      setBusy(false);activateDataset(dataset,true);message(expand?'回答と問題IDを保持して100ペアに増やしました。':'100ペアの評価セットを作成しました。判定は回答するまで表示しません。');
    }catch(error){if(preparationStarted){setBusy(false);render();}message(error.message,true);}
  }
  $('identityForm').onsubmit=event=>{
    event.preventDefault();const code=$('evaluatorId').value.trim(),role=$('role').value;
    if(!code||code.length>40||/[\u0000-\u001f\u007f]/.test(code)){message('評価者コードは1〜40文字で入力してください。',true);return;}
    if(!discardDraft())return;state.evaluatorId=code;state.role=role;state.currentPairId=null;render();persist();message('評価者を '+code+' に切り替えました。');
  };
  $('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);$('newDataset').onclick=()=>buildFromCourse(false);$('expandDataset').onclick=()=>buildFromCourse(true);
  $('onlyPending').onchange=()=>{if(!discardDraft()){$('onlyPending').checked=state.onlyPending;return;}state.onlyPending=$('onlyPending').checked;state.currentPairId=null;render();persist();};
  for(const input of document.querySelectorAll('[name=choice]'))input.onclick=event=>{
    // A double click belongs to one answer, even if the next diagram is already visible.
    if(event.detail>1){event.preventDefault();return;}
    decision=elapsedNow();saveSelectedAnswer(input.value);
  };
  $('notes').oninput=()=>{dirty=true;};
  $('answerForm').onsubmit=event=>event.preventDefault();
  function saveSelectedAnswer(choice){
    const pair=currentPair();if(busy||!pair||!api.CHOICES[choice])return;
    try{
      const list=orderedPairs(),index=list.findIndex(p=>p.id===pair.id),next=list[index+1]?.id;
      const old=answerFor(pair.id),now=elapsedNow(),incoming=incomingInfo(pair);
      const dataset=api.saveResponse(state.dataset,{pairId:pair.id,evaluatorId:state.evaluatorId,role:state.role,choice,diagramPresentation:'candidate-entry-v1',candidateIncomingBranch:incoming.index,entrySource:incoming.source,notes:$('notes').value.trim(),activeViewMs:now,decisionMs:Math.min(decision??now,now),updatedAt:new Date().toISOString(),...(old?.ruleViewedAt?{ruleViewedAt:old.ruleViewedAt}:{})});
      const nextState={...state,dataset,currentPairId:next||pair.id};
      // Advance only after the answer and all archived sets are durably stored.
      try{writeStorage(nextState);}catch{
        state.dataset=dataset;dirty=false;unsaved=true;
        $('storageStatus').textContent='自動保存できません。回答は画面内に保持しています。「評価JSONを保存」で書き出してください。';
        $('storageStatus').classList.add('error');
        message('保存できないため次へ進みません。回答は画面内に保持しています。「評価JSONを保存」で退避してください。',true);return;
      }
      state=nextState;dirty=false;unsaved=false;render();
      $('storageStatus').textContent='このブラウザに保存済み';$('storageStatus').classList.remove('error');
      focusComparison();message(next?'回答を自動保存しました。次のペアです。':'回答を自動保存しました。最後のペアです。「評価JSONを保存」で書き出せます。');
    }catch(error){message(error.message,true);}
  }
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
      if(busy)throw new Error('100ペアの準備が終わってから読み込んでください。');
      if(activateDataset(incoming))message('評価JSONを読み込みました。セットごとの回答を保持し、同じセットの異なる評価者の回答は統合しています。');
    }catch(error){message(error.message,true);}
  };
  window.addEventListener('beforeunload',event=>{if(dirty||unsaved){event.preventDefault();event.returnValue='';}});
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved?.dataset){api.validateDataset(saved.dataset);
      if(saved.otherDatasets!==undefined){
        if(!Array.isArray(saved.otherDatasets))throw new Error('保存セットの一覧が正しくありません。');
        const seen=new Set([saved.dataset.id]);
        for(const dataset of saved.otherDatasets){api.validateDataset(dataset);if(seen.has(dataset.id))throw new Error('保存セットが重複しています。');seen.add(dataset.id);}
        otherDatasets=saved.otherDatasets;
      }
      state={dataset:saved.dataset,evaluatorId:typeof saved.evaluatorId==='string'&&saved.evaluatorId.length<=40?saved.evaluatorId:'P001',role:api.ROLES.includes(saved.role)?saved.role:'participant',currentPairId:saved.currentPairId,onlyPending:!!saved.onlyPending};render();message('前回の評価セットと回答を復元しました。');$('storageStatus').textContent='このブラウザに保存済み';}
    else{render();if(localStorage.getItem(COURSE))buildFromCourse();}
  }catch(error){render();message('保存済みデータを復元できませんでした。評価JSONから読み込めます。'+error.message,true);}
})();
