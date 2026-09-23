import type { Core, ElementDefinition } from "cytoscape";
import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection, edgeMetric } from "../networkVisualEncoding";
import type { GalaxyInput } from "./galaxyGeometry";
import { nodeDiameter } from "./presentation";
import { CONFIDENCE_OPACITY, WIDTH_STEPS, confidenceBand, evidenceStep, supportStep, type EdgeWidthBy, type NodeSizeBy } from "./encoding";

export type GalaxyOptions = { sizeBy?: NodeSizeBy; widthBy?: EdgeWidthBy; methodCount?: number };

export function galaxySignature(nodes: NetworkNode[], edges: NetworkEdge[], layout: string, sizeBy: NodeSizeBy = "all") {
  return JSON.stringify([layout, sizeBy, nodes.map(n => [n.id, n.isTF]).sort(), edges.map(e => [e.key, e.source, e.target]).sort()]);
}

/** Directed links count towards "targets" (out) and "regulators" (in) at the
 * regulating and regulated end respectively; links whose direction no method
 * resolved count only towards all connections. */
export function nodeDegrees(edges: NetworkEdge[]) {
  const all = new Map<string, number>(), out = new Map<string, number>(), inn = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const e of edges) {
    bump(all, e.source); if (e.target !== e.source) bump(all, e.target);
    if (!hasDirection(e)) continue;
    const [from, to] = e.direction === -1 ? [e.target, e.source] : [e.source, e.target];
    bump(out, from); bump(inn, to);
  }
  return { all, out, in: inn };
}

export function galaxyElements(nodes: NetworkNode[], edges: NetworkEdge[], options: GalaxyOptions = {}): ElementDefinition[] {
  const sizeBy = options.sizeBy ?? "all", widthBy = options.widthBy ?? "evidence", methodCount = options.methodCount ?? 1;
  const degrees = nodeDegrees(edges);
  const sized = degrees[sizeBy];
  const values = nodes.map(n => sized.get(n.id) ?? 0);
  const minValue = values.length ? Math.min(...values) : 0, maxValue = values.length ? Math.max(...values) : 0;
  return [
    ...nodes.map(n => {
      const d = degrees.all.get(n.id) ?? 0, value = sized.get(n.id) ?? 0;
      const box = nodeDiameter(value, minValue, maxValue);
      return { data: { id: n.id, fullLabel: n.id, label: n.id, degree: d,
        degreeOut: degrees.out.get(n.id) ?? 0, degreeIn: degrees.in.get(n.id) ?? 0, sizeValue: value,
        isTF: n.isTF ? 1 : 0,
        diameter: box,
        labelSize: 11,
        labelHalign: "center", labelValign: "center", labelOffsetX: 0, labelOffsetY: 0,
      } };
    }),
    ...edges.map(e => {
      const directed = hasDirection(e);
      // Tip = direction (at the regulated end); tip shape and colour = sign.
      // Unsigned-but-directed gets a hollow arrowhead; undirected gets no tip.
      const tip = e.sign === -1 ? "tee" : "triangle";
      const evidence = edgeMetric(e, "evidence", 1) ?? 0;
      const confidence = edgeMetric(e, "confidence", 1);
      const widthStep = widthBy === "support" ? supportStep(e.count, methodCount) : evidenceStep(evidence);
      const band = confidenceBand(confidence);
      return { data: { id: e.key, source: e.source, target: e.target, sign: e.sign,
        direction: directed ? e.direction : 0,
        sourceTip: directed && e.direction === -1 ? tip : "none",
        targetTip: directed && e.direction === 1 ? tip : "none",
        arrowFill: e.sign === 0 ? "hollow" : "filled",
        evidence, confidence, support: e.count,
        widthStep, confidenceBand: band,
        width: WIDTH_STEPS[widthStep],
        arrowScale: 0.8,
        inkOpacity: CONFIDENCE_OPACITY[band],
        // Weakest first, strongest on top.
        zIndex: 1 + (2 - band) * 4 + widthStep,
      } };
    }),
  ];
}

export function galaxyInputFromElements(elements: ElementDefinition[], width: number, height: number, curved = false): GalaxyInput {
  return {
    curved,
    nodes: elements.filter(e => e.data.source === undefined).map(({ data: d }) => ({ id: String(d.id), diameter: Number(d.diameter), labelWidth: Math.min(150, String(d.fullLabel).length * 6.5) })),
    edges: elements.filter(e => e.data.source !== undefined).map(({ data: d }) => ({ id: String(d.id), source: String(d.source), target: String(d.target), sign: Number(d.sign), direction: Number(d.direction), weight: Number(d.evidence) || 0 })),
    width, height,
  };
}

export function galaxyInput(cy: Core): GalaxyInput {
  return {
    curved: cy.scratch("curvedLinks") === true,
    nodes: cy.nodes().map(n => ({ id: n.id(), diameter: Number(n.data("diameter")), labelWidth: Math.min(150, String(n.data("fullLabel")).length * 5.7) })),
    edges: cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), sign: Number(e.data("sign")), direction: Number(e.data("direction")), weight: Number(e.data("evidence")) || 0 })),
    width: cy.width(), height: cy.height(),
  };
}
