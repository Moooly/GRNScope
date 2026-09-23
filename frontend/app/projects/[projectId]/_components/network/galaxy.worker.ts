import { buildGalaxy, occludedEdges, routeGalaxy, type GalaxyInput, type Point } from "./galaxyGeometry";

self.onmessage = (event: MessageEvent<{ id: number; input: GalaxyInput; positions?: Record<string, Point> }>) => {
  const { id, input, positions } = event.data;
  try {
    const result = positions
      ? { positions, routes: routeGalaxy(input, positions), components: 0, occluded: occludedEdges(input, positions) }
      : buildGalaxy(input);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Could not arrange this network." });
  }
};
