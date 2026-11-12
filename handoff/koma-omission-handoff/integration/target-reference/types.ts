export type Tags = Record<string, string>;
export type Point = { lat: number; lon: number };
export type OsmNode = Point & { type: "node"; id: number; tags?: Tags };
export type OsmWay = { type: "way"; id: number; nodes: number[]; tags?: Tags };
export type OsmRelation = { type: "relation"; id: number; members: { type: string; ref: number; role: string }[]; tags?: Tags };
export type Snapshot = {
  schemaVersion: number;
  bounds: { south: number; west: number; north: number; east: number };
  elements: (OsmNode | OsmWay | OsmRelation)[];
};
export type Edge = { from: number; to: number; wayId: number; meters: number };
export type Diagnostic = { type: "node" | "way"; id: number; state: "excluded" | "review"; reason: string };
export type Graph = {
  nodes: Map<number, OsmNode>;
  ways: Map<number, OsmWay>;
  adjacency: Map<number, Edge[]>;
  diagnostics: Diagnostic[];
};
export type Stop = { id: string; name: string; nodeId: number; note: string };
export type Leg = { from: Stop; to: Stop; nodeIds: number[]; edges: Edge[]; meters: number; minutes: number };
export type WalkingRoute = { stops: Stop[]; legs: Leg[]; meters: number; minutes: number; speedKmh: number };
