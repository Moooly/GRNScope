import type { Core } from "cytoscape";
import type {
  NetworkGraphExportOptions,
  NetworkGraphHandle,
} from "./networkGraphTypes";

export function createCytoscapeNetworkGraphHandle(
  cy: Core,
): NetworkGraphHandle {
  return {
    kind: "cytoscape",
    zoom: () => cy.zoom(),
    minZoom: () => cy.minZoom(),
    maxZoom: () => cy.maxZoom(),
    width: () => cy.width(),
    height: () => cy.height(),
    stop: () => cy.stop(true, false),
    setZoom: (level) => {
      cy.zoom({
        level,
        renderedPosition: {
          x: cy.width() / 2,
          y: cy.height() / 2,
        },
      });
    },
    on: (event, listener) => {
      cy.on(event, listener as never);
    },
    off: (event, listener) => {
      cy.off(event, listener as never);
    },
    destroyed: () => cy.destroyed(),
    png: (options: NetworkGraphExportOptions = {}) =>
      cy.png({
        full: options.full ?? false,
        scale: options.scale ?? 1,
        bg: options.bg ?? "#eef4fb",
      }),
    svg: (options: NetworkGraphExportOptions = {}) =>
      cy.svg({
        full: options.full ?? false,
        scale: options.scale ?? 1,
        bg: options.bg ?? "#eef4fb",
      }),
  };
}
