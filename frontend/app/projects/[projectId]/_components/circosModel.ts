import { coordinateMatchesReference, normalizeChromosome } from "../_lib/genomeCoordinates";
import type { AggregatedEdge, GenomeReference, NodeInfo } from "../_lib/types";
import { hasDirection } from "./networkVisualEncoding";

export const UNMAPPED_CHROMOSOME = "unmapped";
export type RelationKind = "activation" | "repression" | "undirected" | "uncertain";
export type CircosFocus = { kind: "chromosome"; chromosome: string } | { kind: "bundle"; bundleKey: string };
export const getChromosomeLabel = (chromosome: string) => chromosome === UNMAPPED_CHROMOSOME ? "Unknown" : chromosome.replace(/^chr/, "");
export const getNodeChromosome = (node: NodeInfo | undefined, reference: GenomeReference) => coordinateMatchesReference(node, reference) ? normalizeChromosome(node?.chromosome) : UNMAPPED_CHROMOSOME;
export const getRelationKind = (edge: AggregatedEdge): RelationKind => edge.direction === 0 ? "undirected" : edge.sign > 0 ? "activation" : edge.sign < 0 ? "repression" : "uncertain";
export const getRelationLabel = (relation: RelationKind) => relation === "uncertain" ? "uncertain sign" : relation;
export const getBundleKey = (source: string, target: string, relation: RelationKind) => `${source}|||${target}|||${relation}`;

export function buildCircosSummary(nodes: NodeInfo[], edges: AggregatedEdge[], reference: GenomeReference) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const validEdges = edges.filter(edge => edge.source !== edge.target && nodeMap.has(edge.source) && nodeMap.has(edge.target));
  const ids = new Set(validEdges.flatMap(edge => [edge.source, edge.target]));
  const visibleNodes = nodes.filter(node => ids.has(node.id));
  const chromosomes = new Map<string, { id: string; genes: NodeInfo[]; edges: AggregatedEdge[]; incoming: number; outgoing: number; internal: number; unresolved: number }>();
  const bundles = new Map<string, { key: string; source: string; target: string; relation: RelationKind; edges: AggregatedEdge[] }>();
  const chromosomeOf = new Map(visibleNodes.map(node => [node.id, getNodeChromosome(node, reference)]));
  for (const node of visibleNodes) {
    const id = chromosomeOf.get(node.id)!;
    if (!chromosomes.has(id)) chromosomes.set(id, { id, genes: [], edges: [], incoming: 0, outgoing: 0, internal: 0, unresolved: 0 });
    chromosomes.get(id)!.genes.push(node);
  }
  for (const edge of validEdges) {
    const source = chromosomeOf.get(edge.source)!;
    const target = chromosomeOf.get(edge.target)!;
    const key = getBundleKey(source, target, getRelationKind(edge));
    if (!bundles.has(key)) bundles.set(key, { key, source, target, relation: getRelationKind(edge), edges: [] });
    bundles.get(key)!.edges.push(edge);
    for (const id of new Set([source, target])) {
      const chromosome = chromosomes.get(id)!;
      chromosome.edges.push(edge);
      if (!hasDirection(edge)) chromosome.unresolved++;
      else if (source === target) chromosome.internal++;
      else {
        const outgoing = edge.direction === -1 ? target === id : source === id;
        if (outgoing) chromosome.outgoing++;
        else chromosome.incoming++;
      }
    }
  }
  const mappedCount = visibleNodes.filter(node => chromosomeOf.get(node.id) !== UNMAPPED_CHROMOSOME).length;
  return { nodes: visibleNodes, edges: validEdges, chromosomes, bundles, chromosomeOf, mappedCount, unmappedCount: visibleNodes.length - mappedCount };
}

export type CircosSummary = ReturnType<typeof buildCircosSummary>;

export function circosScope(summary: CircosSummary, focus: CircosFocus | null) {
  const group = focus?.kind === "bundle" ? summary.bundles.get(focus.bundleKey) : focus?.kind === "chromosome" ? summary.chromosomes.get(focus.chromosome) : null;
  if (!group) return { focus: null, nodes: summary.nodes, edges: summary.edges };
  const ids = new Set(group.edges.flatMap(edge => [edge.source, edge.target]));
  return { focus, nodes: summary.nodes.filter(node => ids.has(node.id)), edges: group.edges };
}
