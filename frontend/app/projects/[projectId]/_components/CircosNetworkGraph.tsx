"use client";

import { useMemo } from "react";
import type { AggregatedEdge, NodeInfo } from "../_lib/types";

type CircosNetworkGraphProps = {
  nodes: NodeInfo[];
  edges: AggregatedEdge[];
  selectedGene?: string | null;
  selectedEdgeKey?: string | null;
  onSelectGene?: (geneId: string | null) => void;
  onSelectEdge?: (edgeKey: string | null) => void;
};

type PositionedGene = {
  id: string;
  angle: number;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end";
  labelRotation: number;
  arcStartAngle: number;
  arcEndAngle: number;
  color: string;
};

type ComponentGroup = {
  id: string;
  genes: string[];
  startAngle: number;
  endAngle: number;
  labelAngle: number;
  color: string;
};

type EdgeRibbonSlot = {
  sourceStartAngle: number;
  sourceEndAngle: number;
  targetStartAngle: number;
  targetEndAngle: number;
};

const WIDTH = 780;
const HEIGHT = 680;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 + 18;
const RADIUS = 230;
const LABEL_RADIUS = 280;
const MAX_CIRCOS_NODES = 30;
const MAX_CIRCOS_EDGES = 80;
const COMPONENT_GAP = Math.PI / 24;
const GENE_GAP = Math.PI / 180;
const TRACK_WIDTH = 22;

const RIBBON_COLORS = [
  "#7c6ee6",
  "#f39c25",
  "#d84f7d",
  "#2f8bd7",
  "#e5562f",
  "#8bc34a",
  "#8e8b86",
  "#0b8f72",
  "#a3481c",
  "#e84b55",
  "#0f5e8c",
  "#5b55d6",
];

function getNodeId(node: NodeInfo) {
  return String(node.id);
}

function getEdgeKey(edge: AggregatedEdge) {
  return `${edge.source}|||${edge.target}`;
}

function getReadableRotation(angle: number) {
  const degrees = (angle * 180) / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized > 90 && normalized < 270 ? degrees + 180 : degrees;
}

function getRawEdgeScore(edge: AggregatedEdge) {
  const edgeWithOptionalScores = edge as AggregatedEdge & {
    normalizedScore?: number;
    score?: number;
    confidence?: number;
    weight?: number;
    confidenceScore?: number;
    consensusScore?: number;
    averageScore?: number;
    maxScore?: number;
  };

  const candidate =
    typeof edgeWithOptionalScores.normalizedScore === "number"
      ? edgeWithOptionalScores.normalizedScore
      : typeof edgeWithOptionalScores.consensusScore === "number"
        ? edgeWithOptionalScores.consensusScore
        : typeof edgeWithOptionalScores.averageScore === "number"
          ? edgeWithOptionalScores.averageScore
          : typeof edgeWithOptionalScores.maxScore === "number"
            ? edgeWithOptionalScores.maxScore
            : typeof edgeWithOptionalScores.score === "number"
              ? edgeWithOptionalScores.score
              : typeof edgeWithOptionalScores.confidence === "number"
                ? edgeWithOptionalScores.confidence
                : typeof edgeWithOptionalScores.weight === "number"
                  ? edgeWithOptionalScores.weight
                  : typeof edgeWithOptionalScores.confidenceScore === "number"
                    ? edgeWithOptionalScores.confidenceScore
                    : 0;

  return Number.isFinite(candidate) ? Math.max(0, candidate) : 0;
}

function getEdgeScore(edge: AggregatedEdge) {
  return Math.max(0, Math.min(1, getRawEdgeScore(edge)));
}

function polarToCartesian(angle: number, radius: number) {
  return {
    x: CENTER_X + radius * Math.cos(angle),
    y: CENTER_Y + radius * Math.sin(angle),
  };
}

function getArcPath(startAngle: number, endAngle: number, radius: number) {
  const start = polarToCartesian(startAngle, radius);
  const end = polarToCartesian(endAngle, radius);
  const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function getSlotRibbonPath(slot: EdgeRibbonSlot) {
  const ribbonRadius = RADIUS - TRACK_WIDTH - 2;
  const sourceStart = polarToCartesian(slot.sourceStartAngle, ribbonRadius);
  const sourceEnd = polarToCartesian(slot.sourceEndAngle, ribbonRadius);
  const targetStart = polarToCartesian(slot.targetStartAngle, ribbonRadius);
  const targetEnd = polarToCartesian(slot.targetEndAngle, ribbonRadius);

  const sourceMid = (slot.sourceStartAngle + slot.sourceEndAngle) / 2;
  const targetMid = (slot.targetStartAngle + slot.targetEndAngle) / 2;
  const sourceControl = polarToCartesian(sourceMid, RADIUS * 0.14);
  const targetControl = polarToCartesian(targetMid, RADIUS * 0.14);
  const sourceArcLarge = Math.abs(slot.sourceEndAngle - slot.sourceStartAngle) > Math.PI ? 1 : 0;
  const targetArcLarge = Math.abs(slot.targetEndAngle - slot.targetStartAngle) > Math.PI ? 1 : 0;

  return [
    `M ${sourceStart.x} ${sourceStart.y}`,
    `A ${ribbonRadius} ${ribbonRadius} 0 ${sourceArcLarge} 1 ${sourceEnd.x} ${sourceEnd.y}`,
    `C ${sourceControl.x} ${sourceControl.y}, ${targetControl.x} ${targetControl.y}, ${targetEnd.x} ${targetEnd.y}`,
    `A ${ribbonRadius} ${ribbonRadius} 0 ${targetArcLarge} 0 ${targetStart.x} ${targetStart.y}`,
    `C ${targetControl.x} ${targetControl.y}, ${sourceControl.x} ${sourceControl.y}, ${sourceStart.x} ${sourceStart.y}`,
    "Z",
  ].join(" ");
}


function buildComponents(geneIds: string[], edges: AggregatedEdge[]) {
  const geneSet = new Set(geneIds);
  const adjacency = new Map<string, Set<string>>();

  geneIds.forEach((geneId) => adjacency.set(geneId, new Set()));

  edges.forEach((edge) => {
    const source = String(edge.source);
    const target = String(edge.target);

    if (!geneSet.has(source) || !geneSet.has(target)) return;

    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  });

  const visited = new Set<string>();
  const components: string[][] = [];

  geneIds.forEach((geneId) => {
    if (visited.has(geneId)) return;

    const stack = [geneId];
    const component: string[] = [];
    visited.add(geneId);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      component.push(current);
      adjacency.get(current)?.forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }

    components.push(component);
  });

  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function sortGenesByDegree(genes: string[], edges: AggregatedEdge[]) {
  const degree = new Map<string, number>();
  genes.forEach((gene) => degree.set(gene, 0));

  edges.forEach((edge) => {
    const source = String(edge.source);
    const target = String(edge.target);
    if (degree.has(source)) degree.set(source, (degree.get(source) ?? 0) + 1);
    if (degree.has(target)) degree.set(target, (degree.get(target) ?? 0) + 1);
  });

  return [...genes].sort(
    (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b)
  );
}

export default function CircosNetworkGraph({
  nodes,
  edges,
  selectedGene = null,
  selectedEdgeKey = null,
  onSelectGene,
  onSelectEdge,
}: CircosNetworkGraphProps) {
  const {
    visibleGenes,
    visibleEdges,
    positionedGenes,
    edgeRibbonSlots,
    normalizedEdgeScores,
    isSimplified,
  } = useMemo(() => {
    const degree = new Map<string, number>();
    const nodeIds = nodes.map(getNodeId);

    nodeIds.forEach((id) => degree.set(id, 0));

    edges.forEach((edge) => {
      const source = String(edge.source);
      const target = String(edge.target);
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    });

    const rankedGenes = [...nodeIds].sort(
      (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b)
    );
    const visibleGenes = rankedGenes.slice(0, MAX_CIRCOS_NODES);
    const visibleGeneSet = new Set(visibleGenes);

    const visibleEdges = edges
      .filter((edge) => visibleGeneSet.has(String(edge.source)) && visibleGeneSet.has(String(edge.target)))
      .sort((a, b) => getEdgeScore(b) - getEdgeScore(a))
      .slice(0, MAX_CIRCOS_EDGES);

    const rawScores = visibleEdges.map(getRawEdgeScore);
    const minScore = rawScores.length > 0 ? Math.min(...rawScores) : 0;
    const maxScore = rawScores.length > 0 ? Math.max(...rawScores) : 1;
    const scoreRange = Math.max(maxScore - minScore, 0.000001);
    const normalizedEdgeScores = new Map<string, number>();

    visibleEdges.forEach((edge) => {
      const normalizedScore = (getRawEdgeScore(edge) - minScore) / scoreRange;
      normalizedEdgeScores.set(getEdgeKey(edge), Math.max(0, Math.min(1, normalizedScore)));
    });

    const getVisualEdgeWeight = (edge: AggregatedEdge) => {
      const normalizedScore = normalizedEdgeScores.get(getEdgeKey(edge)) ?? 0;
      return 0.08 + Math.pow(normalizedScore, 1.6) * 1.92;
    };

    const visibleWeightedDegree = new Map<string, number>();
    visibleGenes.forEach((geneId) => {
      visibleWeightedDegree.set(geneId, 0);
    });

    visibleEdges.forEach((edge) => {
      const source = String(edge.source);
      const target = String(edge.target);
      const weight = getVisualEdgeWeight(edge);

      visibleWeightedDegree.set(source, (visibleWeightedDegree.get(source) ?? 0) + weight);
      visibleWeightedDegree.set(target, (visibleWeightedDegree.get(target) ?? 0) + weight);
    });

    const components = buildComponents(visibleGenes, visibleEdges).map((component) =>
      sortGenesByDegree(component, visibleEdges)
    );

    const totalGenes = Math.max(visibleGenes.length, 1);
    const totalComponentGap = components.length * COMPONENT_GAP;
    const totalGeneGap = Math.max(0, totalGenes - components.length) * GENE_GAP;
    const usableAngle = Math.max(Math.PI / 2, Math.PI * 2 - totalComponentGap - totalGeneGap);
    const geneWeights = new Map<string, number>();

    visibleGenes.forEach((geneId) => {
      geneWeights.set(geneId, Math.max(0.35, visibleWeightedDegree.get(geneId) ?? 0));
    });

    const totalGeneWeight = Math.max(
      1,
      visibleGenes.reduce((sum, geneId) => sum + (geneWeights.get(geneId) ?? 1), 0)
    );
    let currentAngle = -Math.PI / 2;

    const positionedGenes = new Map<string, PositionedGene>();

    components.forEach((component) => {
      component.forEach((geneId) => {
        const geneWeight = geneWeights.get(geneId) ?? 1;
        const geneAngle = (usableAngle * geneWeight) / totalGeneWeight;
        const arcStartAngle = currentAngle;
        const arcEndAngle = currentAngle + geneAngle;
        const angle = (arcStartAngle + arcEndAngle) / 2;
        const point = polarToCartesian(angle, RADIUS);
        const labelPoint = polarToCartesian(angle, LABEL_RADIUS);
        const color = RIBBON_COLORS[positionedGenes.size % RIBBON_COLORS.length];

        positionedGenes.set(geneId, {
          id: geneId,
          angle,
          x: point.x,
          y: point.y,
          labelX: labelPoint.x,
          labelY: labelPoint.y,
          labelAnchor: Math.cos(angle) >= 0 ? "start" : "end",
          labelRotation: getReadableRotation(angle),
          arcStartAngle: arcStartAngle + GENE_GAP / 2,
          arcEndAngle: arcEndAngle - GENE_GAP / 2,
          color,
        });

        currentAngle += geneAngle + GENE_GAP;
      });

      currentAngle += COMPONENT_GAP;
    });

    const edgeRibbonSlots = new Map<string, EdgeRibbonSlot>();
    const edgesByGene = new Map<string, AggregatedEdge[]>();

    visibleGenes.forEach((geneId) => edgesByGene.set(geneId, []));

    visibleEdges.forEach((edge) => {
      edgesByGene.get(String(edge.source))?.push(edge);
      edgesByGene.get(String(edge.target))?.push(edge);
    });

    visibleGenes.forEach((geneId) => {
      const gene = positionedGenes.get(geneId);
      const incidentEdges = edgesByGene.get(geneId) ?? [];
      if (!gene || incidentEdges.length === 0) return;

      const usableGeneArc = Math.max(0.0001, gene.arcEndAngle - gene.arcStartAngle);
      const totalIncidentWeight = Math.max(
        0.0001,
        incidentEdges.reduce((sum, edge) => sum + getVisualEdgeWeight(edge), 0)
      );
      let cursor = gene.arcStartAngle;

      incidentEdges
        .sort((a, b) => getRawEdgeScore(b) - getRawEdgeScore(a))
        .forEach((edge) => {
          const edgeKey = getEdgeKey(edge);
          const weight = getVisualEdgeWeight(edge);
          const span = (usableGeneArc * weight) / totalIncidentWeight;
          const startAngle = cursor;
          const endAngle = cursor + span;
          const existing = edgeRibbonSlots.get(edgeKey) ?? {
            sourceStartAngle: startAngle,
            sourceEndAngle: endAngle,
            targetStartAngle: startAngle,
            targetEndAngle: endAngle,
          };

          if (String(edge.source) === geneId) {
            existing.sourceStartAngle = startAngle;
            existing.sourceEndAngle = endAngle;
          }

          if (String(edge.target) === geneId) {
            existing.targetStartAngle = startAngle;
            existing.targetEndAngle = endAngle;
          }

          edgeRibbonSlots.set(edgeKey, existing);
          cursor = endAngle;
        });
    });

    return {
      visibleGenes,
      visibleEdges,
      positionedGenes,
      edgeRibbonSlots,
      normalizedEdgeScores,
      isSimplified: nodes.length > MAX_CIRCOS_NODES || edges.length > MAX_CIRCOS_EDGES,
    };
  }, [edges, nodes]);

  if (nodes.length === 0 || edges.length === 0) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 text-sm font-medium text-slate-500">
        No edges are available for the current filters.
      </div>
    );
  }

  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
      {isSimplified ? (
        <div className="mb-3 rounded-[1rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
          Circos view is simplified for readability. Showing the top {visibleGenes.length} genes and {visibleEdges.length} strongest edges from the current filters. Outer arc length reflects total weighted degree, and ribbon width reflects edge score. Ribbon color follows the source gene.
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[680px] w-full rounded-[1rem] bg-white"
        role="img"
        aria-label="Component-aware Circos network view"
      >
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={RADIUS}
          fill="none"
          stroke="#cbd5e1"
          strokeWidth="1"
        />

        {Array.from(positionedGenes.values()).map((gene) => (
          <path
            key={`arc-${gene.id}`}
            d={getArcPath(gene.arcStartAngle, gene.arcEndAngle, RADIUS)}
            fill="none"
            stroke={gene.color}
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="butt"
            opacity="0.92"
          />
        ))}

        {visibleEdges.map((edge) => {
          const source = positionedGenes.get(String(edge.source));
          const target = positionedGenes.get(String(edge.target));
          if (!source || !target) return null;

          const score = normalizedEdgeScores.get(getEdgeKey(edge)) ?? 0;
          const edgeKey = getEdgeKey(edge);
          const isActive = edgeKey === selectedEdgeKey;
          const isDimmed = selectedGene && edge.source !== selectedGene && edge.target !== selectedGene;

          const color = source.color;
          const slot = edgeRibbonSlots.get(edgeKey);
          if (!slot) return null;

          const ribbonFill = isActive ? "#0f5e8c" : color;
          const ribbonOpacity = isDimmed ? 0.1 : isActive ? 0.82 : 0.46 + score * 0.24;

          return (
            <path
              key={edgeKey}
              d={getSlotRibbonPath(slot)}
              fill={ribbonFill}
              fillOpacity={ribbonOpacity}
              stroke={isActive ? "#083f61" : color}
              strokeWidth={isActive ? 1.6 : 0.45}
              strokeOpacity={isDimmed ? 0.12 : isActive ? 0.88 : 0.28 + score * 0.16}
              className="cursor-pointer transition"
              onClick={(event) => {
                event.stopPropagation();
                onSelectEdge?.(edgeKey === selectedEdgeKey ? null : edgeKey);
              }}
            />
          );
        })}

        {Array.from(positionedGenes.values()).map((gene) => {
          const isSelected = gene.id === selectedGene;
          const isDimmed = selectedGene && gene.id !== selectedGene;

          return (
            <g
              key={gene.id}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelectGene?.(isSelected ? null : gene.id);
              }}
            >
              <text
                x={gene.labelX}
                y={gene.labelY}
                textAnchor={gene.labelAnchor}
                dominantBaseline="middle"
                transform={`rotate(${gene.labelRotation} ${gene.labelX} ${gene.labelY})`}
                className="select-none fill-slate-950 text-[13px] font-bold"
                opacity={isDimmed ? 0.35 : 1}
              >
                {gene.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}