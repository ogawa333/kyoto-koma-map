(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./routing.js'));
  else root.KomaEvaluation=factory(root.KomaRouting);
})(typeof window==='undefined'?globalThis:window,function(engine){
  'use strict';
  const FORMAT='kyoto-junction-evaluation',VERSION=1;
  const CHOICES={clear:{label:'明確に区別できる',trainingLabel:'omit',recommendation:'omit'},borderline:{label:'ギリギリ区別できる',trainingLabel:'omit',recommendation:'omit'},indistinguishable:{label:'区別できない',trainingLabel:'keep',recommendation:'keep'},uncertain:{label:'判断保留',trainingLabel:null,recommendation:'keep'}};
  const ROLES=['participant','parent','child','author'];
  const isChoice=value=>Object.hasOwn(CHOICES,value);
  const point=p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  const text=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max;
  function frameValid(f,withRoute=false){
    return f&&point(f.center)&&Number.isFinite(f.heading)&&Array.isArray(f.branches)&&f.branches.length>=3&&f.branches.length<=32&&f.branches.every(a=>Array.isArray(a)&&a.length>=2&&a.length<=500&&a.every(point))&&(!withRoute||['routeIn','routeOut'].every(key=>Array.isArray(f[key])&&f[key].length<=1000&&f[key].every(point)));
  }
  const clonePoints=points=>points.map(p=>({lat:p.lat,lon:p.lon}));
  function modelFrame(f,withRoute=false){
    return {center:{lat:f.center.lat,lon:f.center.lon},heading:f.heading,branches:f.branches.map(clonePoints),...(withRoute?{routeIn:clonePoints(f.routeIn),routeOut:clonePoints(f.routeOut)}:{})};
  }
  function physicalId(f){const match=String(f.id).match(/^junction:([^:]+):/);return match?'osm-node:'+match[1]:'coordinate:'+f.center.lat.toFixed(7)+','+f.center.lon.toFixed(7);}
  function buildDataset(course,{id,createdAt=new Date().toISOString()}={}){
    if(!text(id,200))throw new Error('評価セットIDが必要です。');
    if(course?.dirty)throw new Error('コース設定が変更中です。コマ地図を自動生成してから評価してください。');
    const result=course?.result,frames=result?.allFrames,edits=course?.edits||{};
    if(!Array.isArray(frames)||frames.length<2||frames.length>3000||result.generationVersion!==9)throw new Error('コマ地図画面でコースを生成・更新してから開いてください。');
    if(!frames.every(f=>text(f.id,200)&&Number.isFinite(f.at)&&frameValid(f,true)))throw new Error('コースの交差点データを読み取れません。');
    const required=frames.map((f,i)=>engine.baseFrameIsRequired(f,i,frames.length,edits)),pairs=[];
    let previous=0;
    for(let j=1;j<frames.length;j++){
      if(!required[j])continue;
      const target=frames[j];
      if(!engine.skipSimilarityTarget(target,edits)&&target.routeOut.length>=2){
        for(let i=previous+1;i<j;i++){
          const candidate=frames[i];
          pairs.push({id:id+':'+i+':'+j,modelInput:{candidate:modelFrame(candidate),target:modelFrame(target,true)},rulePrediction:engine.similarJunctions(candidate,target)?'keep':'omit',splitGroups:[physicalId(candidate),physicalId(target)],context:{candidateId:candidate.id,targetId:target.id,candidateAt:candidate.at,targetAt:target.at,candidateAllNumber:i+1,targetAllNumber:j+1}});
        }
      }
      previous=j;
    }
    if(!pairs.length)throw new Error('このコースには評価可能な省略候補がありません。別のコースを生成してください。');
    return validateDataset({format:FORMAT,version:VERSION,id,createdAt,source:{courseName:result.name||'名称未設定',sourceDate:result.sourceDate||null,generationVersion:result.generationVersion,ruleVersion:'kyoto-geometry-v3-signal-policy',sampling:'all-omittable-before-next-mandatory-frame',evaluationMode:'diagram',ruleThresholdDegrees:20},pairs,responses:[]});
  }
  function responseKey(response){return JSON.stringify([response.evaluatorId,response.pairId]);}
  function validateDataset(d){
    if(d?.format!==FORMAT||d.version!==VERSION||!text(d.id,200)||!Number.isFinite(Date.parse(d.createdAt))||!d.source||!text(d.source.courseName,200)||!text(d.source.ruleVersion,200)||!Array.isArray(d.pairs)||!d.pairs.length||d.pairs.length>3000||!Array.isArray(d.responses)||d.responses.length>60000)throw new Error('評価データの形式が正しくありません。');
    const only=(value,keys)=>value&&Object.keys(value).every(k=>keys.includes(k));
    if(!only(d,['format','version','id','createdAt','source','pairs','responses','exportedAt','summary'])||!only(d.source,['courseName','sourceDate','generationVersion','ruleVersion','sampling','evaluationMode','ruleThresholdDegrees']))throw new Error('評価セットに不要な情報が含まれています。');
    if(d.source.evaluationMode!=='diagram'||d.source.sampling!=='all-omittable-before-next-mandatory-frame'||!Number.isInteger(d.source.generationVersion)||d.source.ruleThresholdDegrees!==20||(d.source.sourceDate!==null&&!Number.isFinite(Date.parse(d.source.sourceDate))))throw new Error('評価セットの作成条件が正しくありません。');
    const ids=new Set();
    for(const p of d.pairs){
      if(!text(p.id,600)||ids.has(p.id)||!frameValid(p.modelInput?.candidate)||!frameValid(p.modelInput?.target,true)||!['keep','omit'].includes(p.rulePrediction)||!Array.isArray(p.splitGroups)||p.splitGroups.length!==2||!p.splitGroups.every(g=>text(g,200))||!p.context||!text(p.context.candidateId,200)||!text(p.context.targetId,200)||!Number.isFinite(p.context.candidateAt)||!Number.isFinite(p.context.targetAt))throw new Error('交差点ペアのデータが正しくありません。');
      // Prevent imported photos, keys and candidate answers from entering the dataset.
      if(!only(p,['id','modelInput','rulePrediction','splitGroups','context'])||!only(p.modelInput,['candidate','target'])||!only(p.context,['candidateId','targetId','candidateAt','targetAt','candidateAllNumber','targetAllNumber'])||canonical(p.modelInput.target)!==canonical(modelFrame(p.modelInput.target,true)))throw new Error('交差点ペアに不要な情報が含まれています。');
      if(canonical(p.modelInput.candidate)!==canonical(modelFrame(p.modelInput.candidate)))throw new Error('候補交差点に正解ルートなどの不要な情報が含まれています。');
      ids.add(p.id);
    }
    const keys=new Set();
    for(const r of d.responses){
      if(!ids.has(r.pairId)||(!text(r.evaluatorId,40)||r.evaluatorId.trim()!==r.evaluatorId||/[\u0000-\u001f\u007f]/.test(r.evaluatorId))||!ROLES.includes(r.role)||!isChoice(r.choice)||typeof r.notes!=='string'||r.notes.length>500||!Number.isFinite(r.activeViewMs)||r.activeViewMs<0||r.activeViewMs>86400000||!Number.isFinite(r.decisionMs)||r.decisionMs<0||r.decisionMs>r.activeViewMs||!Number.isFinite(Date.parse(r.updatedAt))||!Number.isInteger(r.revision)||r.revision<1||keys.has(responseKey(r)))throw new Error('回答データが正しくありません。');
      if(!only(r,['pairId','evaluatorId','role','choice','notes','activeViewMs','decisionMs','updatedAt','revision','trainingLabel','retentionRecommendation','ruleViewedAt','blindAtDecision'])||(r.ruleViewedAt!==undefined&&!Number.isFinite(Date.parse(r.ruleViewedAt)))||(r.blindAtDecision!==undefined&&typeof r.blindAtDecision!=='boolean'))throw new Error('回答に不要な情報が含まれています。');
      keys.add(responseKey(r));
    }
    return d;
  }
  function saveResponse(d,response){
    if(!d.pairs.some(p=>p.id===response.pairId))throw new Error('評価するペアがありません。');
    const old=d.responses.find(r=>responseKey(r)===responseKey(response));
    const item={...response,revision:(old?.revision||0)+1,trainingLabel:CHOICES[response.choice]?.trainingLabel,retentionRecommendation:CHOICES[response.choice]?.recommendation};
    const next={...d,responses:[...d.responses.filter(r=>responseKey(r)!==responseKey(item)),item]};
    validateDataset(next);return next;
  }
  function summary(d,evaluatorId=null){
    const pairs=new Map(d.pairs.map(p=>[p.id,p]));
    const s={responses:0,evaluated:0,uncertain:0,unblinded:0,trueKeep:0,falseOmit:0,unnecessaryKeep:0,trueOmit:0,borderline:0,borderlineOmitted:0};
    for(const r of d.responses){
      if(evaluatorId!==null&&r.evaluatorId!==evaluatorId)continue;
      s.responses++;if(r.ruleViewedAt&&Date.parse(r.updatedAt)>=Date.parse(r.ruleViewedAt)){s.unblinded++;continue;}if(r.choice==='uncertain'){s.uncertain++;continue;}
      s.evaluated++;const human=CHOICES[r.choice].trainingLabel,rule=pairs.get(r.pairId).rulePrediction;
      if(human==='keep')s[rule==='keep'?'trueKeep':'falseOmit']++;
      else s[rule==='keep'?'unnecessaryKeep':'trueOmit']++;
      if(r.choice==='borderline'){s.borderline++;if(rule==='omit')s.borderlineOmitted++;}
    }
    const rate=(a,b)=>b?a/b:null;
    return {...s,falseOmissionRate:rate(s.falseOmit,s.trueKeep+s.falseOmit),omissionPrecision:rate(s.trueOmit,s.trueOmit+s.falseOmit),unnecessaryKeepRate:rate(s.unnecessaryKeep,s.unnecessaryKeep+s.trueOmit),accuracy:rate(s.trueKeep+s.trueOmit,s.evaluated),borderlineOmissionRate:rate(s.borderlineOmitted,s.borderline)};
  }
  function exportDataset(d){
    validateDataset(d);
    return {...d,responses:d.responses.map(r=>({...r,trainingLabel:CHOICES[r.choice].trainingLabel,retentionRecommendation:CHOICES[r.choice].recommendation,blindAtDecision:!r.ruleViewedAt||Date.parse(r.updatedAt)<Date.parse(r.ruleViewedAt)})),exportedAt:new Date().toISOString(),summary:summary(d)};
  }
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
  function mergeDatasets(current,incoming){
    validateDataset(incoming);if(!current||current.id!==incoming.id)return incoming;
    validateDataset(current);
    if(canonical(current.pairs)!==canonical(incoming.pairs)||canonical(current.source)!==canonical(incoming.source))throw new Error('同じ評価セットIDですが交差点データが異なります。');
    const responses=new Map(current.responses.map(r=>[responseKey(r),r]));
    for(const r of incoming.responses){
      const existing=responses.get(responseKey(r));
      const semantic=row=>{const {trainingLabel,retentionRecommendation,blindAtDecision,...answer}=row;return answer;};
      if(existing&&canonical(semantic(existing))!==canonical(semantic(r)))throw new Error('同じ評価者・ペアの回答が競合しています。現在の回答は変更していません。');
      if(!existing)responses.set(responseKey(r),r);
    }
    return {...current,responses:[...responses.values()]};
  }
  return {FORMAT,VERSION,CHOICES,ROLES,buildDataset,validateDataset,saveResponse,summary,exportDataset,mergeDatasets};
});
