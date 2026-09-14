import type { Core, ElementDefinition } from "cytoscape";
import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection, edgeMetric } from "../networkVisualEncoding";
import type { GalaxyInput } from "./galaxyGeometry";

export function galaxySignature(nodes: NetworkNode[], edges: NetworkEdge[], layout: string) {
  return JSON.stringify([layout, nodes.map(n => [n.id, n.isTF]).sort(), edges.map(e => [e.key, e.source, e.target, e.sign, hasDirection(e) ? e.direction : 0]).sort()]);
}

export function galaxyElements(nodes: NetworkNode[], edges: NetworkEdge[]): ElementDefinition[] {
  const degree = new Map<string, number>();
  edges.forEach(e => { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); });
  return [
    ...nodes.map(n => {
      const d = degree.get(n.id) ?? 0;
      return { data: { id: n.id, fullLabel: n.id, label: n.id, degree: d, isTF: n.isTF ? 1 : 0,
        diameter: Math.min(64, 10 + 9 * (Math.sqrt(Math.max(1, d)) - 1)),
        labelSize: Math.min(15, 9 + Math.sqrt(d) * 0.65),
      } };
    }),
    ...edges.map(e => {
      const directed = hasDirection(e);
      const tip = e.sign === -1 ? "tee" : "triangle";
      return { data: { id: e.key, source: e.source, target: e.target, sign: e.sign,
        direction: directed ? e.direction : 0,
        sourceTip: directed && e.direction === -1 ? tip : "none",
        targetTip: directed && e.direction === 1 ? tip : "none",
        arrowFill: e.sign === 0 ? "hollow" : "filled",
        evidence: edgeMetric(e, "evidence", 1) ?? 0,
        confidence: edgeMetric(e, "confidence", 1),
        width: 0.65 + (edgeMetric(e, "evidence", 1) ?? 0) * 0.85,
      } };
    }),
  ];
}

export function galaxyInput(cy: Core): GalaxyInput {
  return {
    nodes: cy.nodes().map(n => ({ id: n.id(), diameter: Number(n.data("diameter")), labelWidth: Math.min(150, String(n.data("fullLabel")).length * 5.7) })),
    edges: cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), sign: Number(e.data("sign")), direction: Number(e.data("direction")) })),
    width: cy.width(), height: cy.height(),
  };
}
