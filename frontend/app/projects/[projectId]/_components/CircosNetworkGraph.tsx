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
  startAngle: number;
  endAngle: number;
  labelAngle: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end";
  labelRotation: number;
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
const LABEL_RADIUS = 282;
const MAX_CIRCOS_NODES = 30;
const MAX_CIRCOS_EDGES = 80;
const GENE_SPACE = Math.PI / 60;
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
  "#f5a623",
  "#a12d5d",
  "#6aa6d8",
  "#6f63c9",
  "#df6f90",
  "#999999",
  "#4db6ac",
  "#d94b4b",
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
  const targetMidAngle = (slot.targetStartAngle + slot.targetEndAngle) / 2;
  const targetTip = polarToCartesian(targetMidAngle, ribbonRadius + TRACK_WIDTH * 0.82);

  const sourceMid = (slot.sourceStartAngle + slot.sourceEndAngle) / 2;
  const targetMid = targetMidAngle;
  const sourceControl = polarToCartesian(sourceMid, RADIUS * 0.16);
  const targetControl = polarToCartesian(targetMid, RADIUS * 0.16);
  const sourceArcLarge = Math.abs(slot.sourceEndAngle - slot.sourceStartAngle) > Math.PI ? 1 : 0;

  return [
    `M ${sourceStart.x} ${sourceStart.y}`,
    `A ${ribbonRadius} ${ribbonRadius} 0 ${sourceArcLarge} 1 ${sourceEnd.x} ${sourceEnd.y}`,
    `C ${sourceControl.x} ${sourceControl.y}, ${targetControl.x} ${targetControl.y}, ${targetEnd.x} ${targetEnd.y}`,
    `L ${targetTip.x} ${targetTip.y}`,
    `L ${targetStart.x} ${targetStart.y}`,
    `C ${targetControl.x} ${targetControl.y}, ${sourceControl.x} ${sourceControl.y}, ${sourceStart.x} ${sourceStart.y}`,
    "Z",
  ].join(" ");
}

function getEdgeThickness(score: number, minScore: number, maxScore: number) {
  if (maxScore === minScore) return 1;
  return 0.5 + 1.5 * ((score - minScore) / (maxScore - minScore));
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
    const nodeIds = nodes.map(getNodeId);
    const nodeSet = new Set(nodeIds);

    const rankedEdges = edges
      .filter((edge) => {
        const source = String(edge.source);
        const target = String(edge.target);
        return source !== target && nodeSet.has(source) && nodeSet.has(target);
      })
      .sort((a, b) => getRawEdgeScore(b) - getRawEdgeScore(a))
      .slice(0, MAX_CIRCOS_EDGES);

    const geneSet = new Set<string>();
    rankedEdges.forEach((edge) => {
      geneSet.add(String(edge.source));
      geneSet.add(String(edge.target));
    });

    const sectorLoad = new Map<string, number>();
    geneSet.forEach((geneId) => sectorLoad.set(geneId, 0));

    rankedEdges.forEach((edge) => {
      const source = String(edge.source);
      const target = String(edge.target);
      sectorLoad.set(source, (sectorLoad.get(source) ?? 0) + 1);
      sectorLoad.set(target, (sectorLoad.get(target) ?? 0) + 1);
    });

    const visibleGenes = [...geneSet]
      .sort((a, b) => (sectorLoad.get(b) ?? 0) - (sectorLoad.get(a) ?? 0) || a.localeCompare(b))
      .slice(0, MAX_CIRCOS_NODES);
    const visibleGeneSet = new Set(visibleGenes);

    const visibleEdges = rankedEdges.filter(
      (edge) => visibleGeneSet.has(String(edge.source)) && visibleGeneSet.has(String(edge.target))
    );

    const scores = visibleEdges.map(getRawEdgeScore);
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 1;
    const scoreRange = Math.max(maxScore - minScore, 0.000001);
    const normalizedEdgeScores = new Map<string, number>();

    visibleEdges.forEach((edge) => {
      normalizedEdgeScores.set(getEdgeKey(edge), (getRawEdgeScore(edge) - minScore) / scoreRange);
    });

    const edgeThickness = new Map<string, number>();
    visibleEdges.forEach((edge) => {
      edgeThickness.set(getEdgeKey(edge), getEdgeThickness(getRawEdgeScore(edge), minScore, maxScore));
    });

    const sectorUnits = new Map<string, number>();
    visibleGenes.forEach((geneId) => sectorUnits.set(geneId, 0));
    visibleEdges.forEach((edge) => {
      const source = String(edge.source);
      const target = String(edge.target);
      const thickness = edgeThickness.get(getEdgeKey(edge)) ?? 1;
      sectorUnits.set(source, (sectorUnits.get(source) ?? 0) + thickness);
      sectorUnits.set(target, (sectorUnits.get(target) ?? 0) + thickness);
    });

    visibleGenes.forEach((geneId) => {
      sectorUnits.set(geneId, Math.max(sectorUnits.get(geneId) ?? 0, 1));
    });

    const totalSpace = visibleGenes.length * GENE_SPACE;
    const usableAngle = Math.max(Math.PI / 2, Math.PI * 2 - totalSpace);
    const totalUnits = Math.max(
      1,
      visibleGenes.reduce((sum, geneId) => sum + (sectorUnits.get(geneId) ?? 1), 0)
    );

    const positionedGenes = new Map<string, PositionedGene>();
    let currentAngle = -Math.PI / 2;

    visibleGenes.forEach((geneId, index) => {
      const units = sectorUnits.get(geneId) ?? 1;
      const geneAngle = (usableAngle * units) / totalUnits;
      const startAngle = currentAngle;
      const endAngle = currentAngle + geneAngle;
      const labelAngle = (startAngle + endAngle) / 2;
      const labelPoint = polarToCartesian(labelAngle, LABEL_RADIUS);
      const color = RIBBON_COLORS[index % RIBBON_COLORS.length];

      positionedGenes.set(geneId, {
        id: geneId,
        startAngle,
        endAngle,
        labelAngle,
        labelX: labelPoint.x,
        labelY: labelPoint.y,
        labelAnchor: Math.cos(labelAngle) >= 0 ? "start" : "end",
        labelRotation: getReadableRotation(labelAngle),
        color,
      });

      currentAngle += geneAngle + GENE_SPACE;
    });

    const cursor = new Map<string, number>();
    visibleGenes.forEach((geneId) => cursor.set(geneId, 0));

    const edgeRibbonSlots = new Map<string, EdgeRibbonSlot>();

    visibleEdges
      .slice()
      .reverse()
      .forEach((edge) => {
        const sourceId = String(edge.source);
        const targetId = String(edge.target);
        const sourceGene = positionedGenes.get(sourceId);
        const targetGene = positionedGenes.get(targetId);
        if (!sourceGene || !targetGene) return;

        const thickness = edgeThickness.get(getEdgeKey(edge)) ?? 1;
        const sourceUnits = sectorUnits.get(sourceId) ?? 1;
        const targetUnits = sectorUnits.get(targetId) ?? 1;
        const sourceArcLength = sourceGene.endAngle - sourceGene.startAngle;
        const targetArcLength = targetGene.endAngle - targetGene.startAngle;
        const sourceCursor = cursor.get(sourceId) ?? 0;
        const targetCursor = cursor.get(targetId) ?? 0;
        const sourceSpan = (sourceArcLength * thickness) / sourceUnits;
        const targetSpan = (targetArcLength * thickness) / targetUnits;
        const sourceStartAngle = sourceGene.startAngle + (sourceArcLength * sourceCursor) / sourceUnits;
        const targetStartAngle = targetGene.startAngle + (targetArcLength * targetCursor) / targetUnits;

        edgeRibbonSlots.set(getEdgeKey(edge), {
          sourceStartAngle,
          sourceEndAngle: sourceStartAngle + sourceSpan,
          targetStartAngle,
          targetEndAngle: targetStartAngle + targetSpan,
        });

        cursor.set(sourceId, sourceCursor + thickness);
        cursor.set(targetId, targetCursor + thickness);
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

  if (nodes.length === 0 || edges.length === 0 || visibleEdges.length === 0) {
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
          Circos view is simplified for readability. Showing the top {visibleGenes.length} genes and {visibleEdges.length} strongest edges from the current filters. Outer arc length reflects total edge load, ribbon width reflects edge score, and ribbon color follows the source gene.
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[680px] w-full rounded-[1rem] bg-white"
        role="img"
        aria-label="Component-aware Circos network view"
      >
        {Array.from(positionedGenes.values()).map((gene) => (
          <path
            key={`arc-${gene.id}`}
            d={getArcPath(gene.startAngle, gene.endAngle, RADIUS)}
            fill="none"
            stroke={gene.color}
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="butt"
            opacity="0.95"
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onSelectGene?.(selectedGene === gene.id ? null : gene.id);
            }}
          />
        ))}

        {visibleEdges.slice().reverse().map((edge) => {
          const source = positionedGenes.get(String(edge.source));
          if (!source) return null;

          const score = normalizedEdgeScores.get(getEdgeKey(edge)) ?? 0;
          const edgeKey = getEdgeKey(edge);
          const isActive = edgeKey === selectedEdgeKey;
          const isDimmed = Boolean(
            selectedGene && edge.source !== selectedGene && edge.target !== selectedGene
          );
          const slot = edgeRibbonSlots.get(edgeKey);
          if (!slot) return null;

          return (
            <path
              key={edgeKey}
              d={getSlotRibbonPath(slot)}
              fill={isActive ? "#0f5e8c" : source.color}
              fillOpacity={isDimmed ? 0.1 : isActive ? 0.86 : 0.56}
              stroke={isActive ? "#083f61" : source.color}
              strokeWidth={isActive ? 1.6 : 0.45}
              strokeOpacity={isDimmed ? 0.12 : isActive ? 0.9 : 0.35 + score * 0.2}
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
          const isDimmed = Boolean(selectedGene && gene.id !== selectedGene);

          return (
            <text
              key={`label-${gene.id}`}
              x={gene.labelX}
              y={gene.labelY}
              textAnchor={gene.labelAnchor}
              dominantBaseline="middle"
              transform={`rotate(${gene.labelRotation} ${gene.labelX} ${gene.labelY})`}
              className="select-none fill-slate-950 text-[13px] font-bold"
              opacity={isDimmed ? 0.35 : 1}
              onClick={(event) => {
                event.stopPropagation();
                onSelectGene?.(isSelected ? null : gene.id);
              }}
            >
              {gene.id}
            </text>
          );
        })}
      </svg>
    </div>
  );
}