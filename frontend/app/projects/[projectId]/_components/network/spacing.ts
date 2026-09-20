import type { Core } from "cytoscape";

/** Spread node positions, not glyphs or camera zoom. This is deliberately not
 * followed by fit(), which would cancel the extra on-screen separation. */
export function applyNetworkSpacing(cy: Core, next: number) {
  if (cy.destroyed() || cy.nodes().empty()) return;
  const spacing = Math.max(1, Math.min(2.5, next));
  const previous = Number(cy.scratch("publicationSpacing")) || 1;
  const ratio = spacing / previous;
  if (Math.abs(ratio - 1) < 1e-9) return;
  const pan = cy.pan(), zoom = cy.zoom();
  const center = { x: (cy.width() / 2 - pan.x) / zoom, y: (cy.height() / 2 - pan.y) / zoom };
  cy.batch(() => {
    cy.nodes().positions(node => {
      const p = node.position();
      return { x: center.x + (p.x - center.x) * ratio, y: center.y + (p.y - center.y) * ratio };
    });
    cy.edges().forEach(edge => {
      const distances = edge.data("routeDistances") as number[] | undefined;
      if (distances) edge.data("routeDistances", distances.map(d => d * ratio));
    });
  });
  cy.scratch("publicationSpacing", spacing);
  cy.scratch("galaxyCameraTouched", true);
}

/** Keep circular/concentric/layered arrangements intact while reserving the
 * new node diameters. Their legacy coordinate builders assume smaller glyphs. */
export function spacePresetPositions(nodes: Array<{ id: string; diameter: number }>, positions: Record<string, { x: number; y: number }>) {
  let factor = 1;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = positions[nodes[i].id], b = positions[nodes[j].id];
    if (!a || !b) continue;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance > 0) factor = Math.max(factor, ((nodes[i].diameter + nodes[j].diameter) / 2 + 18) / distance);
  }
  return Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, { x: p.x * factor, y: p.y * factor }]));
}
