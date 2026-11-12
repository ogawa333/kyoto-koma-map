import {emptyCorrections,staleCorrections,type RallyCorrections} from "./rally-corrections.ts";
import {draftIssues,draftVisits,decodeRallyDraft,type RallyDraft} from "./rally-draft.ts";
import {prepareExpandedRoadConnections,expandedRoadSource} from "../miura-road-connections.ts";
import {routeThroughStops,shortestPath} from "../route/routing.ts";
import {extractJunctions} from "../route/junctions.ts";
import {createKomaMaps} from "../route/koma.ts";
import {bindKomaCards} from "../route/koma-cards.ts";
import {expandedKomaContext} from "../expanded-context.ts";
import type {ManagedSpot} from "../spots/editing.ts";
import type {Point} from "../route/types.ts";

export function createRallyPreview(input:RallyDraft|null,spots:readonly ManagedSpot[],corrections:RallyCorrections=emptyCorrections()){
 const blocked=(reason:string,message:string)=>({state:"blocked" as const,reason,message});
 if(!input)return blocked("missing","保存済みの下書きがありません。地点を選んで保存してください。");
 const draft=decodeRallyDraft(input);if(!draft)return blocked("invalid","下書きの内容を確認してください。");
 const issues=draftIssues(draft,spots);
 if(issues.length)return blocked("catalog-changed",issues.map(i=>i.label+"「"+i.spot?.name+"」"+(i.state==="missing"?"は削除済み・利用できません。":"は台帳で変更されています。")).join(" ")+" 下書きへ戻り、最新情報を確認して再保存してください。");
 const stale=staleCorrections(draft,spots,corrections);if(stale.length)return blocked("correction-stale","保存した到達点の補正が台帳・道路データと一致しません。到達点の修正画面で再確認するか、自動候補に戻してください。");
 const visits=draftVisits(draft).map(v=>({...v,spot:v.spot!}));
 const prepared=prepareExpandedRoadConnections(visits.map(v=>v.spot),corrections.items),{graph,nodeIdsBySpot,splits}=prepared;
 const stops=visits.map(v=>({id:v.key,name:v.spot.name,nodeId:nodeIdsBySpot.get(v.spot.id)!,note:"未確認の道路上候補。施設までの通路は未検証です。"}));
 let route;
 try{route=routeThroughStops(graph,stops)}
 catch(error){
  if(!(error instanceof Error)||!/No walking path|Stop is missing/.test(error.message))throw error;
  // Identify the failed leg only after generation fails; successful paths run once.
  for(let i=1;i<stops.length;i++){
   try{shortestPath(graph,stops[i-1].nodeId,stops[i].nodeId)}
   catch(cause){
    if(!(cause instanceof Error)||!/No walking path|Stop is missing/.test(cause.message))throw cause;
    return blocked("unreachable","区間"+i+"「"+stops[i-1].name+" → "+stops[i].name+"」の道路上候補を結ぶ経路が見つかりません。道路の接続・歩行制限・候補位置を確認してください。");
   }
  }
  throw error;
 }
 if(route.meters===0)return blocked("zero-route","すべての地点の道路上候補が同じ位置で、移動距離が0mです。地点を変更して保存してください。");
 const analysis=extractJunctions(graph,route),maps=createKomaMaps(graph,analysis,30,{retainShortGeometry:true});
 const cards=bindKomaCards(route,analysis,maps).map(c=>{
  const split=splits.get(c.map.nodeId);
  return {...c,context:expandedKomaContext(graph,c.map),referenceContext:c.map.shortGeometry?expandedKomaContext(graph,c.map,c.map.shortGeometry):null,evidence:split?{kind:"way" as const,id:split.wayId,fromNodeId:split.fromNodeId,toNodeId:split.toNodeId,fraction:split.fraction}:{kind:"node" as const,id:c.map.nodeId}};
 });
 const legs=route.legs.map((l,i)=>({label:"区間"+(i+1),from:l.from.name,to:l.to.name,meters:l.meters,minutes:l.minutes,points:l.nodeIds.map(id=>({lat:graph.nodes.get(id)!.lat,lon:graph.nodes.get(id)!.lon}))}));
 const path=legs.flatMap((l,i)=>i?l.points.slice(1):l.points);
 const south=Math.min(...path.map(p=>p.lat))-.0006,north=Math.max(...path.map(p=>p.lat))+.0006,west=Math.min(...path.map(p=>p.lon))-.0008,east=Math.max(...path.map(p=>p.lon))+.0008;
 const roads=[...graph.ways.values()].map(w=>({id:w.id,points:w.nodes.map(id=>graph.nodes.get(id)!)})).filter(w=>{
  const p=w.points;return Math.min(...p.map(n=>n.lat))<=north&&Math.max(...p.map(n=>n.lat))>=south&&Math.min(...p.map(n=>n.lon))<=east&&Math.max(...p.map(n=>n.lon))>=west;
 }).map(w=>({id:w.id,points:w.points.map(p=>({lat:p.lat,lon:p.lon}))}));
 const connections=new Map(prepared.connections.map(c=>[c.spotId,c]));
 return {state:"ready" as const,correctionRevision:corrections.revision,title:draft.title,draftRevision:draft.revision,draftUpdatedAt:draft.updatedAt,source:expandedRoadSource,
  meters:route.meters,minutes:route.minutes,speedKmh:route.speedKmh,legs,path,roads,cards,
  visits:visits.map((v,i)=>{const c=connections.get(v.spot.id)!;return {id:v.key,label:v.label,name:v.spot.name,spotId:v.spot.id,spotRevision:v.spot.revision,point:c.point as Point,facility:c.facility as Point,gap:c.distanceMeters,mode:corrections.items.some(m=>m.spotId===v.spot.id)?"manual" as const:"auto" as const,komaIndex:cards.findIndex(card=>card.map.stopIds.includes(stops[i].id))}})};
}
export type RallyPreview=Extract<ReturnType<typeof createRallyPreview>,{state:"ready"}>;
