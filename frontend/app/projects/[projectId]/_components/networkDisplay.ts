import type { NetworkEdge } from "./networkGraphTypes";
export type NetworkDisplayUnit = "relationships" | "genes";
/** A stable gene prefix follows ranked relationships. No genes or edges are invented. */
export function selectNetworkDisplay<
  T extends Pick<NetworkEdge, "source" | "target">,
>(edges: T[], limit: number, unit: NetworkDisplayUnit) {
  const availableGenes = [
    ...new Set(edges.flatMap((e) => [e.source, e.target])),
  ];
  const maximum = unit === "genes" ? availableGenes.length : edges.length;
  const count = limit <= 0 ? maximum : Math.min(maximum, Math.floor(limit));
  if (unit === "relationships") {
    const displayed = edges.slice(0, count);
    return {
      edges: displayed,
      geneIds: new Set(displayed.flatMap((e) => [e.source, e.target])),
      availableGenes: availableGenes.length,
    };
  }
  const geneIds = new Set(availableGenes.slice(0, count));
  return {
    edges: edges.filter((e) => geneIds.has(e.source) && geneIds.has(e.target)),
    geneIds,
    availableGenes: availableGenes.length,
  };
}
