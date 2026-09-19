import type { Core, ElementDefinition } from "cytoscape";
import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection, edgeMetric } from "../networkVisualEncoding";
import type { GalaxyInput } from "./galaxyGeometry";
import { nodeDiameter } from "./presentation";
import { NETWORK_SCALE } from "./theme";

export function galaxySignature(nodes: NetworkNode[], edges: NetworkEdge[], layout: string) {
  return JSON.stringify([layout, nodes.map(n => [n.id, n.isTF]).sort(), edges.map(e => [e.key, e.source, e.target]).sort()]);
}

export function galaxyElements(nodes: NetworkNode[], edges: NetworkEdge[]): ElementDefinition[] {
  const degree = new Map<string, number>();
  edges.forEach(e => { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); });
  return [
    ...nodes.map(n => {
      const d = degree.get(n.id) ?? 0;
      // The widened regulator box is baked into `diameter`, not applied in the
      // stylesheet, because this same value is what the geometry solver uses
      // for collision. Scaling the drawn node without telling the layout would
      // let regulators overlap their neighbours and their own labels.
      const box = nodeDiameter(d, nodes.length, edges.length) * (n.isTF ? NETWORK_SCALE.regulatorScale : 1);
      return { data: { id: n.id, fullLabel: n.id, label: n.id, degree: d, isTF: n.isTF ? 1 : 0,
        diameter: box,
        labelSize: Math.min(15, 9 + Math.sqrt(d) * 0.65),
        labelHalign: "center", labelValign: "bottom", labelOffsetX: 0, labelOffsetY: 4,
      } };
    }),
    ...edges.map(e => {
      const directed = hasDirection(e);
      // Endpoint marks assert direction only when the inference resolved it.
      // Sign remains visible in colour (and dashed undirected negative links).
      const tip = e.sign === -1 ? "tee" : "triangle";
      return { data: { id: e.key, source: e.source, target: e.target, sign: e.sign,
        direction: directed ? e.direction : 0,
        sourceTip: directed && e.direction === -1 ? tip : "none",
        targetTip: directed && e.direction === 1 ? tip : "none",
        arrowFill: e.sign === 0 ? "hollow" : "filled",
        evidence: edgeMetric(e, "evidence", 1) ?? 0,
        confidence: edgeMetric(e, "confidence", 1),
        width: 1.6 + (edgeMetric(e, "evidence", 1) ?? 0) * 1.2,
        arrowScale: 0.78,
        inkOpacity: 0.3,
      } };
    }),
  ];
}

export function galaxyInputFromElements(elements: ElementDefinition[], width: number, height: number): GalaxyInput {
  return {
    nodes: elements.filter(e => e.data.source === undefined).map(({ data: d }) => ({ id: String(d.id), diameter: Number(d.diameter), labelWidth: Math.min(150, String(d.fullLabel).length * 6.5) })),
    edges: elements.filter(e => e.data.source !== undefined).map(({ data: d }) => ({ id: String(d.id), source: String(d.source), target: String(d.target), sign: Number(d.sign), direction: Number(d.direction) })),
    width, height,
  };
}

export function galaxyInput(cy: Core): GalaxyInput {
  return {
    nodes: cy.nodes().map(n => ({ id: n.id(), diameter: Number(n.data("diameter")), labelWidth: Math.min(150, String(n.data("fullLabel")).length * 5.7) })),
    edges: cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), sign: Number(e.data("sign")), direction: Number(e.data("direction")) })),
    width: cy.width(), height: cy.height(),
  };
}
