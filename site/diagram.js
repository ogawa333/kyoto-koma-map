(function(root){
  'use strict';
  function geometry(frame){
    const heading=frame.heading,center=frame.center,cos=Math.cos(center.lat*Math.PI/180),scale=2.6;
    const point=p=>{const east=(p.lon-center.lon)*111320*cos,north=(p.lat-center.lat)*111320;return {x:110+(east*Math.cos(heading)-north*Math.sin(heading))*scale,y:105-(east*Math.sin(heading)+north*Math.cos(heading))*scale};};
    const path=points=>points.map((p,i)=>{const q=point(p);return `${i?'L':'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;}).join('');
    return {point,path};
  }
  // No labels, route arrow or route highlighting are included on a candidate.
  function render(frame,showRoute=false){
    const {path}=geometry(frame);
    const roads=frame.branches.map(points=>`<path d="${path(points)}"/>`).join('');
    const route=showRoute?`<defs><marker id="evaluationArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0L7,3L0,6Z" fill="#20251f"/></marker></defs><path class="evaluation-route-in" d="${path(frame.routeIn||[])}" fill="none" stroke="#20251f" stroke-width="3.2"/><path class="evaluation-route-out" d="${path(frame.routeOut||[])}" fill="none" stroke="#20251f" stroke-width="3.2" marker-end="url(#evaluationArrow)"/>`:'';
    return `<svg class="evaluation-diagram" viewBox="0 0 220 200" role="img" aria-label="${showRoute?'次のコマの道路形状と進む方向':'手前の交差点の道路形状。進む方向は非表示'}"><g stroke="#474d42" stroke-width="1.35" fill="none" stroke-linecap="round" stroke-linejoin="round">${roads}</g>${route}<text x="110" y="188" text-anchor="middle" fill="#768078" font-size="8">進入方向（下から入る）</text></svg>`;
  }
  const api={geometry,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KomaDiagram=api;
})(typeof window==='undefined'?globalThis:window);
