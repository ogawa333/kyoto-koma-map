import { distanceMeters } from "./graph.ts";
import { nodePolicy, wayPolicy } from "./walking-policy.ts";
import type { Edge, Graph, Point, WalkingRoute } from "./types.ts";

export type AccessState = "candidate" | "excluded" | "review";
type BranchEvidence = { wayId: number; highway: string; entry: AccessState; exit: AccessState };
export type RoadBranch = {
  neighborNodeId: number;
  bearingDegrees: number | null;
  evidence: BranchEvidence[];
  entry: AccessState;
  exit: AccessState;
};
export type JunctionCandidate = {
  sequence: number;
  pathIndex: number;
  nodeId: number;
  point: Point;
  reasons: ("start" | "finish" | "stop" | "junction" | "return")[];
  stopIds: string[];
  arrival: { neighborNodeId: number; wayId: number; bearingDegrees: number | null } | null;
  departure: { neighborNodeId: number; wayId: number; bearingDegrees: number | null } | null;
  turnDegrees: number | null;
  branches: (RoadBranch & { relativeDegrees: number | null; arrival: boolean; departure: boolean })[];
  metersFromStart: number;
  metersToNext: number | null;
  issues: string[];
};
export type JunctionAnalysis = { candidates: JunctionCandidate[]; totalMeters: number; pathNodeCount: number };

// Initial great-circle bearing: north=0°, clockwise positive. No direction is invented for coincident points.
export function bearingDegrees(from: Point, to: Point): number | null {
  if (distanceMeters(from, to) === 0) return null;
  const radians = Math.PI / 180;
  const a = from.lat * radians, b = to.lat * radians, dlon = (to.lon - from.lon) * radians;
  const x = Math.sin(dlon) * Math.cos(b);
  const y = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dlon);
  if (Math.hypot(x, y) < 1e-12) return null; // Numerically indeterminate, e.g. antipodal points.
  return (Math.atan2(x, y) / radians + 360) % 360;
}

// [-180, 180): positive=clockwise/right, negative=counterclockwise/left. A reversal is -180.
export function relativeDegrees(arrival: number, outward: number): number {
  if (![arrival, outward].every(Number.isFinite)) throw new Error("Invalid bearing");
  return ((outward - arrival + 180) % 360 + 360) % 360 - 180;
}

function combine(states: AccessState[]): AccessState {
  return states.includes("candidate") ? "candidate" : states.includes("review") ? "review" : "excluded";
}

// Keep physical road branches, including restricted ones, separately from the directed walking graph.
export function buildRoadBranches(graph: Graph): Map<number, RoadBranch[]> {
  const topology = new Map<number, Map<number, BranchEvidence[]>>();
  for (const way of graph.ways.values()) {
    const tags = way.tags ?? {};
    if (tags.area === "yes" || ["construction", "proposed"].includes(tags.highway) || tags.construction || tags.proposed) continue;
    const policy = wayPolicy(tags);
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1], b = way.nodes[i];
      if (a === b) continue;
      if (!graph.nodes.has(a) || !graph.nodes.has(b)) throw new Error("Missing branch node in way/" + way.id);
      const status = (from: number, to: number, directionAllowed: boolean): AccessState => {
        const nodeStates = [nodePolicy(graph.nodes.get(from)!.tags), nodePolicy(graph.nodes.get(to)!.tags)];
        if (policy.state === "excluded" || nodeStates.some(p => p.state === "excluded")) return "excluded";
        if (policy.state === "review" || nodeStates.some(p => p.state === "review")) return "review";
        if (!directionAllowed) return "excluded";
        return graph.adjacency.get(from)?.some(edge => edge.to === to && edge.wayId === way.id) ? "candidate" : "review";
      };
      const forward = status(a, b, policy.forward), backward = status(b, a, policy.backward);
      const add = (center: number, neighbor: number, entry: AccessState, exit: AccessState) => {
        const branches = topology.get(center) ?? new Map<number, BranchEvidence[]>();
        const evidence = branches.get(neighbor) ?? [];
        evidence.push({ wayId: way.id, highway: tags.highway!, entry, exit });
        branches.set(neighbor, evidence);
        topology.set(center, branches);
      };
      add(a, b, backward, forward);
      add(b, a, forward, backward);
    }
  }
  return new Map([...topology].map(([id, neighbors]) => [id, [...neighbors].map(([neighborNodeId, evidence]) => ({
    neighborNodeId,
    bearingDegrees: bearingDegrees(graph.nodes.get(id)!, graph.nodes.get(neighborNodeId)!),
    evidence: evidence.sort((a, b) => a.wayId - b.wayId),
    entry: combine(evidence.map(e => e.entry)),
    exit: combine(evidence.map(e => e.exit)),
  })).sort((a, b) => a.neighborNodeId - b.neighborNodeId)]));
}

function flattenRoute(graph: Graph, route: WalkingRoute) {
  if (!route.legs.length || route.stops.length !== route.legs.length + 1) throw new Error("Invalid route stop/leg count");
  const nodeIds: number[] = [];
  const edges: Edge[] = [];
  const cumulative = [0];
  const stops = new Map<number, string[]>([[0, [route.stops[0].id]]]);
  // Numerical consistency of the same geometry, not a geographic accuracy threshold.
  const sameLength = (actual: number, expected: number) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-6;
  for (const [i, leg] of route.legs.entries()) {
    const from = route.stops[i], to = route.stops[i + 1];
    if (leg.from.id !== from.id || leg.from.nodeId !== from.nodeId || leg.to.id !== to.id || leg.to.nodeId !== to.nodeId ||
        leg.nodeIds.length !== leg.edges.length + 1 || leg.nodeIds[0] !== from.nodeId || leg.nodeIds.at(-1) !== to.nodeId ||
        (nodeIds.length && nodeIds.at(-1) !== leg.nodeIds[0])) throw new Error("Inconsistent route leg " + (i + 1));
    if (!nodeIds.length) nodeIds.push(leg.nodeIds[0]);
    let legMeters = 0;
    for (const [j, edge] of leg.edges.entries()) {
      const original = graph.adjacency.get(edge.from)?.find(e => e.to === edge.to && e.wayId === edge.wayId);
      if (edge.from !== leg.nodeIds[j] || edge.to !== leg.nodeIds[j + 1] || !original ||
          !Number.isFinite(edge.meters) || edge.meters <= 0 || !sameLength(edge.meters, original.meters)) {
        throw new Error("Route uses a missing/restricted/mismatched edge in leg " + (i + 1));
      }
      edges.push(original);
      nodeIds.push(original.to);
      legMeters += original.meters;
      cumulative.push(cumulative.at(-1)! + original.meters);
    }
    if (!sameLength(leg.meters, legMeters)) throw new Error("Route leg distance mismatch");
    const at = edges.length;
    stops.set(at, [...(stops.get(at) ?? []), to.id]);
  }
  if (!sameLength(route.meters, cumulative.at(-1)!)) throw new Error("Route total distance mismatch");
  if (nodeIds.some(id => !graph.nodes.has(id))) throw new Error("Route node missing");
  return { nodeIds, edges, cumulative, stops };
}

export function extractJunctions(graph: Graph, route: WalkingRoute): JunctionAnalysis {
  const { nodeIds, edges, cumulative, stops } = flattenRoute(graph, route);
  const topology = buildRoadBranches(graph);
  const candidates: JunctionCandidate[] = [];
  nodeIds.forEach((nodeId, pathIndex) => {
    const incoming = edges[pathIndex - 1], outgoing = edges[pathIndex];
    const stopIds = stops.get(pathIndex) ?? [];
    const branches = topology.get(nodeId) ?? [];
    const reasons: JunctionCandidate["reasons"] = [];
    if (pathIndex === 0) reasons.push("start");
    if (pathIndex === nodeIds.length - 1) reasons.push("finish");
    if (stopIds.length && pathIndex > 0 && pathIndex < nodeIds.length - 1) reasons.push("stop");
    if (branches.length >= 3) reasons.push("junction");
    if (incoming && outgoing && incoming.from === outgoing.to) reasons.push("return");
    if (!reasons.length) return;
    const center = graph.nodes.get(nodeId)!;
    const incomingOutward = incoming ? bearingDegrees(center, graph.nodes.get(incoming.from)!) : null;
    const arrival = incoming ? {
      neighborNodeId: incoming.from, wayId: incoming.wayId,
      bearingDegrees: incomingOutward === null ? null : (incomingOutward + 180) % 360,
    } : null;
    const departure = outgoing ? {
      neighborNodeId: outgoing.to, wayId: outgoing.wayId,
      bearingDegrees: bearingDegrees(center, graph.nodes.get(outgoing.to)!),
    } : null;
    if ((arrival && !branches.some(b => b.neighborNodeId === arrival.neighborNodeId)) ||
        (departure && !branches.some(b => b.neighborNodeId === departure.neighborNodeId))) {
      throw new Error("Route branch missing from source topology at node/" + nodeId);
    }
    const issues: string[] = [];
    if (branches.some(b => b.bearingDegrees === null)) issues.push("indeterminate-branch-bearing");
    if (branches.some(b => b.entry === "review" || b.exit === "review")) issues.push("branch-access-or-extract-unresolved");
    if ((arrival && arrival.bearingDegrees === null) || (departure && departure.bearingDegrees === null)) issues.push("indeterminate-route-bearing");
    candidates.push({
      sequence: candidates.length + 1, pathIndex, nodeId, point: {lat:center.lat,lon:center.lon}, reasons, stopIds,
      arrival, departure,
      turnDegrees: arrival?.bearingDegrees != null && departure?.bearingDegrees != null ? relativeDegrees(arrival.bearingDegrees, departure.bearingDegrees) : null,
      branches: branches.map(branch => ({
        ...branch,
        relativeDegrees: arrival?.bearingDegrees != null && branch.bearingDegrees != null ? relativeDegrees(arrival.bearingDegrees, branch.bearingDegrees) : null,
        arrival: branch.neighborNodeId === arrival?.neighborNodeId,
        departure: branch.neighborNodeId === departure?.neighborNodeId,
      })),
      metersFromStart: cumulative[pathIndex], metersToNext: null, issues,
    });
  });
  candidates.forEach((candidate, i) => {
    const next = candidates[i + 1];
    candidate.metersToNext = next ? next.metersFromStart - candidate.metersFromStart : null;
  });
  return { candidates, totalMeters: cumulative.at(-1)!, pathNodeCount: nodeIds.length };
}
