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

/**
 * GRCh38 / hg38 chromosome lengths in base pairs. These size the chromosome
 * sectors on the outer ring proportionally to the actual genome — a chr1
 * sector is ~4.4× wider than a chr22 sector, just like in a standard
 * genomics Circos plot.
 */
const HG38_CHROMOSOME_LENGTHS: Record<string, number> = {
  chrM: 16569,
  chr1: 248956422,
  chr2: 242193529,
  chr3: 198295559,
  chr4: 190214555,
  chr5: 181538259,
  chr6: 170805979,
  chr7: 159345973,
  chr8: 145138636,
  chr9: 138394717,
  chr10: 133797422,
  chr11: 135086622,
  chr12: 133275309,
  chr13: 114364328,
  chr14: 107043718,
  chr15: 101991189,
  chr16: 90338345,
  chr17: 83257441,
  chr18: 80373285,
  chr19: 58617616,
  chr20: 64444167,
  chr21: 46709983,
  chr22: 50818468,
  chrX: 156040895,
  chrY: 57227415,
};

const CHROMOSOME_ORDER: Record<string, number> = (() => {
  const order: Record<string, number> = {};
  for (let i = 1; i <= 22; i += 1) order[`chr${i}`] = i;
  order.chrX = 23;
  order.chrY = 24;
  return order;
})();

const WIDTH = 780;
const HEIGHT = 780;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

const CHROMOSOME_INNER_RADIUS = 248;
const CHROMOSOME_OUTER_RADIUS = 274;
const CHROMOSOME_LABEL_RADIUS =
  (CHROMOSOME_INNER_RADIUS + CHROMOSOME_OUTER_RADIUS) / 2;
const GENE_TICK_INNER_RADIUS = 234;
const GENE_TICK_OUTER_RADIUS = 248;
const RIBBON_RADIUS = GENE_TICK_INNER_RADIUS - 4;
const GENE_LABEL_RADIUS = 296;

const CHROMOSOME_GAP_RADIANS = 0.014; // small gap between adjacent chromosomes
const RIBBON_HALF_WIDTH = 0.005; // angular half-width of each ribbon endpoint

const MAX_CIRCOS_EDGES = 120;
const CIRCOS_ACTIVATION_COLOR = "#0072B2";
const CIRCOS_REPRESSION_COLOR = "#D55E00";
const CIRCOS_UNKNOWN_SIGN_COLOR = "#94a3b8";
const CIRCOS_CHROMOSOME_COLORS = ["#d8e3ed", "#cbd8e4"];

function normalizeChromosome(value?: string | null): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().startsWith("chr") ? trimmed : `chr${trimmed}`;
}

function getNodeId(node: NodeInfo) {
  return String(node.id);
}

function getEdgeKey(edge: AggregatedEdge) {
  return `${edge.source}|||${edge.target}`;
}

function getRawEdgeScore(edge: AggregatedEdge) {
  const e = edge as AggregatedEdge & {
    normalizedScore?: number;
    consensusScore?: number;
    score?: number;
    weight?: number;
  };
  const candidate =
    typeof e.normalizedScore === "number"
      ? e.normalizedScore
      : typeof e.consensusScore === "number"
        ? e.consensusScore
        : typeof e.score === "number"
          ? e.score
          : typeof e.weight === "number"
            ? e.weight
            : 0;
  return Number.isFinite(candidate) ? Math.max(0, candidate) : 0;
}

function getConsensusEdgeColor(edge: AggregatedEdge) {
  if (edge.signConfidence === null || edge.sign === 0 || edge.signCoverage === 0) {
    return CIRCOS_UNKNOWN_SIGN_COLOR;
  }

  return edge.sign > 0 ? CIRCOS_ACTIVATION_COLOR : CIRCOS_REPRESSION_COLOR;
}

function getConsensusEdgeOpacity(edge: AggregatedEdge, score: number) {
  const signConfidence = edge.signConfidence ?? 0;
  const signCoverage = edge.signCoverage ?? 0;
  const confidenceSignal =
    edge.sign === 0 ? 0.42 : Math.max(0.38, signConfidence * signCoverage);

  return Math.min(0.82, 0.16 + score * 0.4 + confidenceSignal * 0.26);
}

function polarToCartesian(angle: number, radius: number) {
  return {
    x: CENTER_X + radius * Math.cos(angle),
    y: CENTER_Y + radius * Math.sin(angle),
  };
}

/**
 * Annular arc band path — a rectangle wrapped around the circle between two
 * radii and two angles. Used to draw each chromosome's coloured ring segment.
 */
function getAnnularArcPath(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
) {
  const startOuter = polarToCartesian(startAngle, outerRadius);
  const endOuter = polarToCartesian(endAngle, outerRadius);
  const startInner = polarToCartesian(startAngle, innerRadius);
  const endInner = polarToCartesian(endAngle, innerRadius);
  const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

/**
 * Bezier ribbon that connects two arc segments through the center. Standard
 * d3-style chord rendering: the source and target spans become the two arcs
 * along the inner ribbon radius, and Bezier curves bend toward the centre.
 */
function getRibbonPath(
  sourceStart: number,
  sourceEnd: number,
  targetStart: number,
  targetEnd: number,
) {
  const sStartPt = polarToCartesian(sourceStart, RIBBON_RADIUS);
  const sEndPt = polarToCartesian(sourceEnd, RIBBON_RADIUS);
  const tStartPt = polarToCartesian(targetStart, RIBBON_RADIUS);
  const tEndPt = polarToCartesian(targetEnd, RIBBON_RADIUS);

  // Bezier control points pulled toward the centre give the ribbon its
  // characteristic chord-diagram curvature.
  const sControl = polarToCartesian(
    (sourceStart + sourceEnd) / 2,
    RIBBON_RADIUS * 0.18,
  );
  const tControl = polarToCartesian(
    (targetStart + targetEnd) / 2,
    RIBBON_RADIUS * 0.18,
  );

  return [
    `M ${sStartPt.x} ${sStartPt.y}`,
    `A ${RIBBON_RADIUS} ${RIBBON_RADIUS} 0 0 1 ${sEndPt.x} ${sEndPt.y}`,
    `Q ${sControl.x} ${sControl.y} ${tStartPt.x} ${tStartPt.y}`,
    `A ${RIBBON_RADIUS} ${RIBBON_RADIUS} 0 0 1 ${tEndPt.x} ${tEndPt.y}`,
    `Q ${tControl.x} ${tControl.y} ${sStartPt.x} ${sStartPt.y}`,
    "Z",
  ].join(" ");
}

function getReadableLabelRotation(angle: number) {
  const degrees = (angle * 180) / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized > 90 && normalized < 270 ? degrees + 180 : degrees;
}

type ChromosomeLayout = {
  chromosome: string;
  startAngle: number;
  endAngle: number;
  length: number;
  color: string;
  labelX: number;
  labelY: number;
};

type GenePlacement = {
  id: string;
  chromosome: string;
  start: number;
  end: number;
  angle: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end";
  labelRotation: number;
  color: string;
};

export default function CircosNetworkGraph({
  nodes,
  edges,
  selectedGene = null,
  selectedEdgeKey = null,
  onSelectGene,
  onSelectEdge,
}: CircosNetworkGraphProps) {
  const layout = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [getNodeId(node), node]));

    // Keep edges that connect two genes whose coordinates we know. Sort by
    // edge score and cap to MAX_CIRCOS_EDGES so the visualisation stays
    // readable on dense networks.
    const annotatedEdges = edges
      .filter((edge) => {
        const sourceId = String(edge.source);
        const targetId = String(edge.target);
        if (sourceId === targetId) return false;
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        return (
          !!sourceNode &&
          !!targetNode &&
          !!normalizeChromosome(sourceNode.chromosome) &&
          !!normalizeChromosome(targetNode.chromosome) &&
          typeof sourceNode.start === "number" &&
          typeof targetNode.start === "number"
        );
      })
      .sort((a, b) => getRawEdgeScore(b) - getRawEdgeScore(a))
      .slice(0, MAX_CIRCOS_EDGES);

    // Collect every gene that participates in a kept edge.
    const geneIds = new Set<string>();
    annotatedEdges.forEach((edge) => {
      geneIds.add(String(edge.source));
      geneIds.add(String(edge.target));
    });

    // Group genes by chromosome and figure out which chromosomes appear.
    const chromosomesInUse = new Set<string>();
    geneIds.forEach((id) => {
      const node = nodeMap.get(id);
      const chromosome = normalizeChromosome(node?.chromosome);
      if (chromosome && HG38_CHROMOSOME_LENGTHS[chromosome] !== undefined) {
        chromosomesInUse.add(chromosome);
      }
    });

    const chromosomeList = [...chromosomesInUse].sort(
      (a, b) =>
        (CHROMOSOME_ORDER[a] ?? 999) - (CHROMOSOME_ORDER[b] ?? 999),
    );

    const totalLength = chromosomeList.reduce(
      (sum, chr) => sum + HG38_CHROMOSOME_LENGTHS[chr],
      0,
    );
    const totalGapAngle = chromosomeList.length * CHROMOSOME_GAP_RADIANS;
    const usableAngle = Math.PI * 2 - totalGapAngle;

    const chromosomeLayout = new Map<string, ChromosomeLayout>();
    let cursor = -Math.PI / 2; // start at 12 o'clock

    chromosomeList.forEach((chromosome) => {
      const length = HG38_CHROMOSOME_LENGTHS[chromosome];
      const sectorAngle = totalLength === 0 ? 0 : (usableAngle * length) / totalLength;
      const startAngle = cursor;
      const endAngle = cursor + sectorAngle;
      const labelAngle = (startAngle + endAngle) / 2;
      const labelPt = polarToCartesian(labelAngle, CHROMOSOME_LABEL_RADIUS);

      chromosomeLayout.set(chromosome, {
        chromosome,
        startAngle,
        endAngle,
        length,
        color: CIRCOS_CHROMOSOME_COLORS[
          ((CHROMOSOME_ORDER[chromosome] ?? 1) - 1) %
            CIRCOS_CHROMOSOME_COLORS.length
        ],
        labelX: labelPt.x,
        labelY: labelPt.y,
      });

      cursor = endAngle + CHROMOSOME_GAP_RADIANS;
    });

    // Place each gene at its true genomic position inside its chromosome's
    // sector. position = sectorStart + (geneStart / chromosomeLength) * sector
    const genePlacements = new Map<string, GenePlacement>();
    geneIds.forEach((id) => {
      const node = nodeMap.get(id);
      if (!node) return;
      const chromosome = normalizeChromosome(node.chromosome);
      const chrLayout = chromosomeLayout.get(chromosome);
      if (!chrLayout) return;
      const start = typeof node.start === "number" ? node.start : 0;
      const end = typeof node.end === "number" ? node.end : start;
      const fraction =
        chrLayout.length === 0 ? 0 : Math.min(1, Math.max(0, start / chrLayout.length));
      const angle =
        chrLayout.startAngle + fraction * (chrLayout.endAngle - chrLayout.startAngle);

      const labelPt = polarToCartesian(angle, GENE_LABEL_RADIUS);

      genePlacements.set(id, {
        id,
        chromosome,
        start,
        end,
        angle,
        labelX: labelPt.x,
        labelY: labelPt.y,
        labelAnchor: Math.cos(angle) >= 0 ? "start" : "end",
        labelRotation: getReadableLabelRotation(angle),
        color: chrLayout.color,
      });
    });

    // Edge score normalisation drives ribbon opacity / stroke weight.
    const scores = annotatedEdges.map(getRawEdgeScore);
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 1;
    const scoreRange = Math.max(maxScore - minScore, 1e-6);

    const normalizedScores = new Map<string, number>();
    annotatedEdges.forEach((edge) => {
      const normalized = (getRawEdgeScore(edge) - minScore) / scoreRange;
      normalizedScores.set(getEdgeKey(edge), Math.max(0, Math.min(1, normalized)));
    });

    return {
      chromosomeList,
      chromosomeLayout: Array.from(chromosomeLayout.values()),
      genePlacements,
      annotatedEdges,
      normalizedScores,
      totalGenes: geneIds.size,
      droppedEdges: edges.length - annotatedEdges.length,
      droppedNodes: nodes.length - geneIds.size,
    };
  }, [nodes, edges]);

  if (
    nodes.length === 0 ||
    edges.length === 0 ||
    layout.annotatedEdges.length === 0
  ) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 px-6 text-center text-sm font-medium text-slate-500">
        {nodes.length === 0 || edges.length === 0
          ? "No edges are available for the current filters."
          : "None of the visible genes have known chromosome coordinates, so the Circos genomic view can't be drawn."}
      </div>
    );
  }

  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[680px] w-full rounded-[1rem] bg-white"
        role="img"
        aria-label="Genomic Circos plot of predicted gene regulatory edges"
        onClick={() => {
          onSelectGene?.(null);
          onSelectEdge?.(null);
        }}
      >
        {/* Neutral chromosome bands keep edge color reserved for regulation sign. */}
        {layout.chromosomeLayout.map((chr) => {
          const sectorAngle = chr.endAngle - chr.startAngle;
          // Hide the chromosome number when its sector is too narrow for the
          // glyph to fit cleanly; the colour band still carries the identity.
          const showLabel = sectorAngle * CHROMOSOME_LABEL_RADIUS > 14;
          return (
            <g key={`chr-${chr.chromosome}`}>
              <path
                d={getAnnularArcPath(
                  chr.startAngle,
                  chr.endAngle,
                  CHROMOSOME_INNER_RADIUS,
                  CHROMOSOME_OUTER_RADIUS,
                )}
                fill={chr.color}
                stroke="#ffffff"
                strokeWidth="2"
              >
                <title>
                  {chr.chromosome} · {(chr.length / 1e6).toFixed(1)} Mb
                </title>
              </path>
              {showLabel && (
                <text
                  x={chr.labelX}
                  y={chr.labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none fill-slate-700 text-[12px] font-bold tracking-[0.02em]"
                >
                  {chr.chromosome.replace("chr", "")}
                </text>
              )}
            </g>
          );
        })}

        {/* Gene tick marks */}
        {Array.from(layout.genePlacements.values()).map((gene) => {
          const tickStart = polarToCartesian(gene.angle, GENE_TICK_INNER_RADIUS);
          const tickEnd = polarToCartesian(gene.angle, GENE_TICK_OUTER_RADIUS);
          const isSelected = gene.id === selectedGene;
          const isDimmed = Boolean(selectedGene && !isSelected);

          return (
            <line
              key={`tick-${gene.id}`}
              x1={tickStart.x}
              y1={tickStart.y}
              x2={tickEnd.x}
              y2={tickEnd.y}
              stroke={isSelected ? "#0f172a" : "#475569"}
              strokeWidth={isSelected ? 2.4 : 1.2}
              strokeOpacity={isDimmed ? 0.18 : 1}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelectGene?.(isSelected ? null : gene.id);
              }}
            >
              <title>
                {gene.id} · {gene.chromosome}:
                {gene.start.toLocaleString()}-{gene.end.toLocaleString()}
              </title>
            </line>
          );
        })}

        {/* Ribbons (drawn before labels so labels stay on top) */}
        {layout.annotatedEdges
          .slice()
          .reverse()
          .map((edge) => {
            const sourceId = String(edge.source);
            const targetId = String(edge.target);
            const sourceGene = layout.genePlacements.get(sourceId);
            const targetGene = layout.genePlacements.get(targetId);
            if (!sourceGene || !targetGene) return null;

            const edgeKey = getEdgeKey(edge);
            const isActive = edgeKey === selectedEdgeKey;
            const isDimmed = Boolean(
              selectedGene && sourceId !== selectedGene && targetId !== selectedGene,
            );
            const score = layout.normalizedScores.get(edgeKey) ?? 0;

            const sourceStart = sourceGene.angle - RIBBON_HALF_WIDTH;
            const sourceEnd = sourceGene.angle + RIBBON_HALF_WIDTH;
            const targetStart = targetGene.angle - RIBBON_HALF_WIDTH;
            const targetEnd = targetGene.angle + RIBBON_HALF_WIDTH;

            const ribbonColor = getConsensusEdgeColor(edge);
            const ribbonOpacity = getConsensusEdgeOpacity(edge, score);

            return (
              <path
                key={edgeKey}
                d={getRibbonPath(sourceStart, sourceEnd, targetStart, targetEnd)}
                fill={ribbonColor}
                fillOpacity={isDimmed ? 0.05 : isActive ? 0.88 : ribbonOpacity}
                stroke={ribbonColor}
                strokeWidth={isActive ? 1.9 : 0.45 + score * 1.05}
                strokeOpacity={isDimmed ? 0.1 : isActive ? 0.95 : Math.min(0.72, ribbonOpacity + 0.08)}
                className="cursor-pointer transition"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge?.(isActive ? null : edgeKey);
                }}
              >
                <title>
                  {sourceId} ({sourceGene.chromosome}:
                  {sourceGene.start.toLocaleString()}) → {targetId} (
                  {targetGene.chromosome}:{targetGene.start.toLocaleString()})
                </title>
              </path>
            );
          })}

        {/* Gene labels */}
        {Array.from(layout.genePlacements.values()).map((gene) => {
          const isSelected = gene.id === selectedGene;
          const isDimmed = Boolean(selectedGene && !isSelected);

          return (
            <text
              key={`label-${gene.id}`}
              x={gene.labelX}
              y={gene.labelY}
              textAnchor={gene.labelAnchor}
              dominantBaseline="middle"
              transform={`rotate(${gene.labelRotation} ${gene.labelX} ${gene.labelY})`}
              className="cursor-pointer select-none fill-slate-950 text-[11px] font-semibold"
              opacity={isDimmed ? 0.3 : 1}
              onClick={(event) => {
                event.stopPropagation();
                onSelectGene?.(isSelected ? null : gene.id);
              }}
            >
              <title>
                {gene.id} · {gene.chromosome}:{gene.start.toLocaleString()}-
                {gene.end.toLocaleString()}
              </title>
              {gene.id}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
