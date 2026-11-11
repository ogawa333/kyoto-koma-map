(function(root){
  'use strict';
  function geometry(frame){
    const heading=frame.heading,center=frame.center,cos=Math.cos(center.lat*Math.PI/180),scale=2.6;
    const point=p=>{const east=(p.lon-center.lon)*111320*cos,north=(p.lat-center.lat)*111320;return {x:110+(east*Math.cos(heading)-north*Math.sin(heading))*scale,y:105-(east*Math.sin(heading)+north*Math.cos(heading))*scale};};
    const path=points=>points.map((p,i)=>{const q=point(p);return `${i?'L':'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;}).join('');
    return {point,path};
  }
  const endLabels={junction:'次の交差点で描画を省略。道は先へ続きます',limit:'表示範囲のため描画を省略。道は先へ続きます',loop:'接続する道が続くため描画を省略', 'dead-end':'行き止まり登録のある端点',unknown:'端点の状態は未確認'};
  function endingMarks(frame){
    if(!Array.isArray(frame.branchEnds)||frame.branchEnds.length!==frame.branches.length)return '';
    const {point}=geometry(frame);
    return frame.branches.map((branch,i)=>{
      const end=frame.branchEnds[i],kind=Object.hasOwn(endLabels,end)?end:'unknown';
      const tip=point(branch.at(-1)),before=[...branch].reverse().slice(1).map(point).find(p=>Math.hypot(p.x-tip.x,p.y-tip.y)>.001);
      if(!before)return '';
      const rotation=Math.atan2(tip.y-before.y,tip.x-before.x)*180/Math.PI;
      let symbol;
      if(kind==='dead-end')symbol='<path d="M0,-4L0,4" stroke="#474d42" stroke-width="2"/>';
      else if(kind==='unknown')symbol=`<text x="6" y="-2" transform="rotate(${(-rotation).toFixed(2)} 6 -2)" font-size="9" font-weight="700" fill="#6f6655" stroke="none">?</text>`;
      else symbol='<path d="M0,0L9,0" stroke="#64828b" stroke-width="1.2" stroke-dasharray="1.6 2"/><path d="M1,-3L4,3M5,-3L8,3" stroke="#64828b" stroke-width="1.1"/>';
      // End glyphs are annotation, never extra road geometry or navigation arrows.
      return `<g class="branch-ending branch-ending-${kind}" data-branch-end="${kind}" transform="translate(${tip.x.toFixed(2)} ${tip.y.toFixed(2)}) rotate(${rotation.toFixed(2)})" fill="none"><title>${endLabels[kind]}</title>${symbol}</g>`;
    }).join('');
  }
  function endingLegend(){return '<span>道路端：</span><span><b style="color:#64828b">//</b> 先へ続く（描画省略）</span><span><b>⊥</b> 行き止まり登録</span><span><b>?</b> 端点未確認</span>';}
  // No labels, route arrow or route highlighting are included on a candidate.
  function render(frame,showRoute=false){
    const {path}=geometry(frame);
    const roads=frame.branches.map(points=>`<path d="${path(points)}"/>`).join('');
    const route=showRoute?`<defs><marker id="evaluationArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0L7,3L0,6Z" fill="#20251f"/></marker></defs><path class="evaluation-route-in" d="${path(frame.routeIn||[])}" fill="none" stroke="#20251f" stroke-width="3.2"/><path class="evaluation-route-out" d="${path(frame.routeOut||[])}" fill="none" stroke="#20251f" stroke-width="3.2" marker-end="url(#evaluationArrow)"/>`:'';
    return `<svg class="evaluation-diagram" viewBox="0 0 220 200" role="img" aria-label="${showRoute?'次のコマの道路形状と進む方向':'手前の交差点の道路形状。進む方向は非表示'}"><g stroke="#474d42" stroke-width="1.35" fill="none" stroke-linecap="round" stroke-linejoin="round">${roads}</g>${route}${endingMarks(frame)}<text x="110" y="${frame.branchEnds?196:188}" text-anchor="middle" fill="#768078" font-size="8">進入方向（下から入る）</text></svg>`;
  }
  const api={geometry,endingMarks,endingLegend,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KomaDiagram=api;
})(typeof window==='undefined'?globalThis:window);
