import type { Core } from "cytoscape";

export function selectionViewport(
  box: { x1: number; y1: number; w: number; h: number },
  size: { width: number; height: number },
  currentZoom: number,
  minZoom: number,
  padding = 64,
) {
  const zoom = Math.max(
    minZoom,
    Math.min(
      currentZoom,
      Math.max(1, size.width - padding * 2) / Math.max(1, box.w),
      Math.max(1, size.height - padding * 2) / Math.max(1, box.h),
    ),
  );
  return {
    zoom,
    pan: {
      x: size.width / 2 - (box.x1 + box.w / 2) * zoom,
      y: size.height / 2 - (box.y1 + box.h / 2) * zoom,
    },
  };
}

// Move the camera, not the genes. Include full endpoint labels and the edge
// annotation so opening the inspector cannot clip the selected relationship.
export function frameNetworkSelection(cy: Core) {
  if (cy.destroyed()) return false;
  let selected = cy.elements(":selected");
  if (!selected.length) return false;
  selected = selected.union(selected.edges().connectedNodes());
  const box = selected.boundingBox({
    includeLabels: true,
    includeOverlays: false,
  });
  cy.viewport(
    selectionViewport(
      box,
      { width: cy.width(), height: cy.height() },
      cy.zoom(),
      cy.minZoom(),
    ),
  );
  return true;
}
