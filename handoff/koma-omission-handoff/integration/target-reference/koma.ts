import { distanceMeters } from "./graph.ts";
import { bearingDegrees, buildRoadBranches, relativeDegrees } from "./junctions.ts";
import type { JunctionAnalysis, RoadBranch } from "./junctions.ts";
import type { Graph, Point } from "./types.ts";

export const KOMA_VIEW = { width: 300, height: 280, centerX: 150, centerY: 140, radius: 98 };
export type DiagramPoint = { x: number; y: number; nodeId: number | null };
export type SourceSegment = { from: number; to: number; wayIds: number[]; fraction: number };
export type KomaBranch = {
  neighborNodeId: number; points: DiagramPoint[]; sourceSegments: SourceSegment[];
  arrival: boolean; departure: boolean; entry: RoadBranch["entry"]; exit: RoadBranch["exit"];
  endReason: "limit" | "junction" | "end"; pathPixels: number;
};
export type KomaGeometry = {headingDegrees:number;branches:KomaBranch[];issues:string[]};
export type KomaMap = {
  sequence: number; nodeId: number; pathIndex: number; stopIds: string[];
  metersFromStart: number; metersToNext: number | null;
  kind: "start" | "finish" | "return" | "junction";
  headingDegrees: number | null; state: "ready" | "held"; issues: string[];
  branches: KomaBranch[];
  shortGeometry?: KomaGeometry; // Opt-in reference geometry, never an approved navigation diagram.
};

// Local azimuthal projection, followed by rotation. Input heading faces the top of the SVG.
export function projectKomaPoint(center: Point, point: Point, heading: number): { x: number; y: number } {
  if (!Number.isFinite(heading)) throw new Error("Invalid diagram heading");
  const distance = distanceMeters(center, point);
  if (distance === 0) return {x: 0, y: 0};
  const bearing = bearingDegrees(center, point);
  if (bearing === null) throw new Error("Indeterminate diagram point direction");
  const angle = relativeDegrees(heading, bearing) * Math.PI / 180;
  return {x: distance * Math.sin(angle), y: -distance * Math.cos(angle)};
}

function traceBranch(graph: Graph, topology: Map<number, RoadBranch[]>, centerId: number, neighbor: number, limit: number) {
  const center = graph.nodes.get(centerId);
  if (!center) throw new Error("Missing diagram center");
  const points: {point: Point; nodeId: number | null}[] = [{point:center,nodeId:centerId}];
  const sourceSegments: SourceSegment[] = [];
  const visited = new Set([centerId]);
  let from = centerId, to = neighbor, remaining = limit;
  while (true) {
    const a = graph.nodes.get(from), b = graph.nodes.get(to);
    const source = topology.get(from)?.find(branch => branch.neighborNodeId === to);
    if (!a || !b || !source) throw new Error("Missing local road geometry");
    const meters = distanceMeters(a, b);
    if (meters <= 0) throw new Error("Zero-length local road segment");
    const fraction = Math.min(1, remaining / meters);
    const point = fraction < 1 ? {lat:a.lat+(b.lat-a.lat)*fraction,lon:a.lon+(b.lon-a.lon)*fraction} : b;
    points.push({point,nodeId:fraction < 1 ? null : to});
    sourceSegments.push({from,to,wayIds:[...new Set(source.evidence.map(e=>e.wayId))],fraction});
    if (fraction < 1 || meters >= remaining) return {points,sourceSegments,endReason:"limit" as const};
    remaining -= meters;
    if (visited.has(to)) throw new Error("Loop in local branch requires review");
    visited.add(to);
    const branches = topology.get(to) ?? [];
    if (branches.length !== 2) return {points,sourceSegments,endReason:branches.length > 2 ? "junction" as const : "end" as const};
    const next = branches.filter(branch=>branch.neighborNodeId !== from);
    if (next.length !== 1) throw new Error("Ambiguous local branch continuation");
    from = to; to = next[0].neighborNodeId;
  }
}

export function createKomaMaps(graph: Graph, analysis: JunctionAnalysis, maxBranchMeters = 30, options:{retainShortGeometry?:boolean} = {}): KomaMap[] {
  if (!Number.isFinite(maxBranchMeters) || maxBranchMeters <= 0) throw new Error("Invalid local drawing extent");
  const topology = buildRoadBranches(graph);
  const scale = KOMA_VIEW.radius / maxBranchMeters;
  return analysis.candidates.map(candidate => {
    const model: KomaMap = {
      sequence:candidate.sequence,nodeId:candidate.nodeId,pathIndex:candidate.pathIndex,stopIds:candidate.stopIds,
      metersFromStart:candidate.metersFromStart,metersToNext:candidate.metersToNext,
      kind:candidate.reasons.includes("start") ? "start" : candidate.reasons.includes("finish") ? "finish" : candidate.reasons.includes("return") ? "return" : "junction",
      headingDegrees:candidate.arrival?.bearingDegrees ?? candidate.departure?.bearingDegrees ?? null,
      state:"ready",issues:[],branches:[],
    };
    try {
      const center = graph.nodes.get(candidate.nodeId);
      const sourceBranches = topology.get(candidate.nodeId) ?? [];
      if (!center || !sourceBranches.length || model.headingDegrees === null) throw new Error("Missing local diagram direction/geometry");
      if (candidate.issues.some(issue => issue.includes("indeterminate"))) throw new Error("Unresolved source direction");
      if ((candidate.arrival && candidate.arrival.bearingDegrees === null) || (candidate.departure && candidate.departure.bearingDegrees === null)) throw new Error("Unresolved route direction");
      const expected = candidate.branches.map(b=>b.neighborNodeId).sort((a,b)=>a-b);
      const actual = sourceBranches.map(b=>b.neighborNodeId).sort((a,b)=>a-b);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Source branch set mismatch");
      for (const branch of candidate.branches) {
        const traced = traceBranch(graph,topology,candidate.nodeId,branch.neighborNodeId,maxBranchMeters);
        const points = traced.points.map(item=>{
          const p = projectKomaPoint(center,item.point,model.headingDegrees!);
          return {x:KOMA_VIEW.centerX+p.x*scale,y:KOMA_VIEW.centerY+p.y*scale,nodeId:item.nodeId};
        });
        const pathPixels = points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
        model.branches.push({
          neighborNodeId:branch.neighborNodeId,points,sourceSegments:traced.sourceSegments,
          arrival:branch.arrival,departure:branch.departure,entry:branch.entry,exit:branch.exit,
          endReason:traced.endReason,pathPixels,
        });
      }
      if ((candidate.arrival && !model.branches.some(b=>b.arrival)) || (candidate.departure && !model.branches.some(b=>b.departure))) throw new Error("Selected route arm missing");
      // Rendering clearance for the inlet dot and arrowhead, not a geographic accuracy threshold.
      if (model.branches.some(b=>(b.arrival||b.departure)&&b.pathPixels<30)) {
        if(options.retainShortGeometry)model.shortGeometry={headingDegrees:model.headingDegrees,branches:model.branches,issues:candidate.issues.length?["Source access or extract needs review"]:[]};
        throw new Error("Selected arms too short to distinguish symbols");
      }
      if (candidate.issues.length) model.issues.push("Source access or extract needs review");
    } catch (error) {
      model.state = "held";
      model.issues.push(error instanceof Error ? error.message : "Unresolved local geometry");
      model.branches = []; // Never show an incomplete intersection as a complete diagram.
    }
    return model;
  });
}

// Returns a real subpath of the projected source branch for a symbolic exit arrow.
export function arrowPath(points: DiagramPoint[], fraction = 0.76): DiagramPoint[] {
  if (!(fraction > 0 && fraction <= 1) || points.length < 2) throw new Error("Invalid arrow path");
  const lengths = points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  let remaining = lengths.reduce((sum,n)=>sum+n,0)*fraction;
  const result = [points[0]];
  for(let i=0;i<lengths.length;i++){
    if(lengths[i]<=0)continue;
    if(remaining<=lengths[i]){
      const t=remaining/lengths[i],a=points[i],b=points[i+1];
      result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,nodeId:null});
      return result;
    }
    result.push(points[i+1]);remaining-=lengths[i];
  }
  return result;
}
