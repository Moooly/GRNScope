"use client";

import { useId, useMemo, type Ref } from "react";
import type { AggregatedEdge, NodeInfo } from "../_lib/types";
import { isDenseNetwork } from "./networkGraphLayouts";

type CircosNetworkGraphProps = {
  nodes: NodeInfo[];
  edges: AggregatedEdge[];
  selectedGene?: string | null;
  selectedEdgeKey?: string | null;
  onSelectGene?: (geneId: string | null) => void;
  onSelectEdge?: (edgeKey: string | null) => void;
  svgRef?: Ref<SVGSVGElement>;
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

const WIDTH = 680;
const HEIGHT = 680;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

const CHROMOSOME_INNER_RADIUS = 276;
const CHROMOSOME_OUTER_RADIUS = 306;
const CHROMOSOME_LABEL_RADIUS =
  (CHROMOSOME_INNER_RADIUS + CHROMOSOME_OUTER_RADIUS) / 2;
const GENE_TICK_INNER_RADIUS = 261;
const GENE_TICK_OUTER_RADIUS = 276;
const RIBBON_RADIUS = GENE_TICK_INNER_RADIUS - 4;
const GENE_LABEL_RADIUS = 316;

const CHROMOSOME_GAP_RADIANS = 0.014; // small gap between adjacent chromosomes
const RIBBON_HALF_WIDTH = 0.005; // angular half-width of each ribbon endpoint

const CIRCOS_ACTIVATION_COLOR = "#168f98";
const CIRCOS_REPRESSION_COLOR = "#d66c4d";
const CIRCOS_UNKNOWN_SIGN_COLOR = "#8290a3";
const CIRCOS_CHROMOSOME_COLORS = ["#dfeaf1", "#d2e1ea"];
const UNMAPPED_CHROMOSOME = "unmapped";
const UNMAPPED_VISUAL_LENGTH = 90000000;

function normalizeChromosome(value?: string | null): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().startsWith("chr") ? trimmed : `chr${trimmed}`;
}

function getNodeId(node: NodeInfo) {
  return String(node.id);
}

function hasGenomicCoordinate(node?: NodeInfo) {
  if (!node) return false;
  const chromosome = normalizeChromosome(node.chromosome);
  return (
    chromosome !== "" &&
    HG38_CHROMOSOME_LENGTHS[chromosome] !== undefined &&
    typeof node.start === "number" &&
    Number.isFinite(node.start)
  );
}

function getDisplayChromosomeLength(chromosome: string) {
  return chromosome === UNMAPPED_CHROMOSOME
    ? UNMAPPED_VISUAL_LENGTH
    : HG38_CHROMOSOME_LENGTHS[chromosome];
}

function getChromosomeSortValue(chromosome: string) {
  return chromosome === UNMAPPED_CHROMOSOME
    ? 25
    : CHROMOSOME_ORDER[chromosome] ?? 999;
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
  if (edge.sign === 0) {
    return CIRCOS_UNKNOWN_SIGN_COLOR;
  }

  return edge.sign > 0 ? CIRCOS_ACTIVATION_COLOR : CIRCOS_REPRESSION_COLOR;
}

function getEvidenceOpacity(score: number, denseNetwork: boolean) {
  if (denseNetwork) {
    if (score >= 0.9) return 0.46;
    if (score >= 0.75) return 0.28;
    return 0.16;
  }
  if (score >= 0.9) return 0.92;
  if (score >= 0.75) return 0.7;
  return 0.46;
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

function getCenteredArcTextPath(
  startAngle: number,
  endAngle: number,
  radius: number,
) {
  const sectorSpan = Math.max(0, endAngle - startAngle);
  const midpoint = startAngle + sectorSpan / 2;
  const labelSpan = Math.min(sectorSpan * 0.82, 0.58);
  const labelStartAngle = midpoint - labelSpan / 2;
  const labelEndAngle = midpoint + labelSpan / 2;
  const reverseForReadability = Math.sin(midpoint) > 0;
  const pathStartAngle = reverseForReadability
    ? labelEndAngle
    : labelStartAngle;
  const pathEndAngle = reverseForReadability ? labelStartAngle : labelEndAngle;
  const start = polarToCartesian(pathStartAngle, radius);
  const end = polarToCartesian(pathEndAngle, radius);
  const largeArc = Math.abs(pathEndAngle - pathStartAngle) > Math.PI ? 1 : 0;
  const sweep = reverseForReadability ? 0 : 1;

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
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
  labelFontSize: number;
  labelPriority: number;
  labelVisible: boolean;
  color: string;
  isUnmapped: boolean;
};

type LabelBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function getNormalizedAngle(angle: number) {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function estimateLabelWidth(label: string, fontSize: number) {
  return Math.max(18, label.length * fontSize * 0.72);
}

function getLabelBox(
  label: string,
  angle: number,
  radius: number,
  anchor: "start" | "end",
  rotation: number,
  fontSize: number,
) {
  const point = polarToCartesian(angle, radius);
  const width = estimateLabelWidth(label, fontSize);
  const height = fontSize + 6;
  const minX = anchor === "end" ? -width : 0;
  const maxX = anchor === "end" ? 0 : width;
  const minY = -height / 2;
  const maxY = height / 2;
  const rotationRadians = (rotation * Math.PI) / 180;
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ].map(([x, y]) => ({
    x: point.x + x * cos - y * sin,
    y: point.y + x * sin + y * cos,
  }));

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const padding = 4;

  return {
    left: Math.min(...xs) - padding,
    right: Math.max(...xs) + padding,
    top: Math.min(...ys) - padding,
    bottom: Math.max(...ys) + padding,
  };
}

function getOverlapArea(a: LabelBox, b: LabelBox) {
  const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlapX * overlapY;
}

function buildAlternatingOffsets(maxSteps: number) {
  const offsets = [0];
  for (let step = 1; step <= maxSteps; step += 1) {
    offsets.push(-step, step);
  }
  return offsets;
}

function resolveGeneLabelCollisions(genePlacements: Map<string, GenePlacement>) {
  const genes = Array.from(genePlacements.values()).sort((a, b) => {
    if (b.labelPriority !== a.labelPriority) {
      return b.labelPriority - a.labelPriority;
    }

    return (
      getNormalizedAngle(a.angle) - getNormalizedAngle(b.angle) ||
      a.id.localeCompare(b.id)
    );
  });
  const geneCount = genes.length;
  const labelFontSize = geneCount > 120 ? 8.8 : geneCount > 70 ? 9.6 : 10.8;
  const angularNudgeStep = geneCount > 120 ? 0.018 : geneCount > 70 ? 0.015 : 0.012;
  const angularNudgeOffsets = buildAlternatingOffsets(
    geneCount > 120 ? 8 : geneCount > 70 ? 6 : 4,
  );
  const placedBoxes: LabelBox[] = [];

  genes.forEach((gene) => {
    gene.labelFontSize = labelFontSize;
    gene.labelVisible = false;

    let bestAngle = gene.angle;
    let bestBox: LabelBox | null = null;
    let bestCost = Number.POSITIVE_INFINITY;

    for (const offset of angularNudgeOffsets) {
      const candidateAngle = gene.angle + offset * angularNudgeStep;
      const anchor = Math.cos(candidateAngle) >= 0 ? "start" : "end";
      const rotation = getReadableLabelRotation(candidateAngle);
      const box = getLabelBox(
        gene.id,
        candidateAngle,
        GENE_LABEL_RADIUS,
        anchor,
        rotation,
        labelFontSize,
      );
      const overlap = placedBoxes.reduce(
        (sum, placedBox) => sum + getOverlapArea(box, placedBox),
        0,
      );
      if (overlap > 0) continue;

      const cost = Math.abs(offset);

      if (cost < bestCost) {
        bestAngle = candidateAngle;
        bestBox = box;
        bestCost = cost;
      }

      if (offset === 0) break;
    }

    if (!bestBox) return;

    const labelPoint = polarToCartesian(bestAngle, GENE_LABEL_RADIUS);
    gene.labelX = labelPoint.x;
    gene.labelY = labelPoint.y;
    gene.labelAnchor = Math.cos(bestAngle) >= 0 ? "start" : "end";
    gene.labelRotation = getReadableLabelRotation(bestAngle);
    gene.labelVisible = true;
    placedBoxes.push(bestBox);
  });
}

export default function CircosNetworkGraph({
  nodes,
  edges,
  selectedGene = null,
  selectedEdgeKey = null,
  onSelectGene,
  onSelectEdge,
  svgRef,
}: CircosNetworkGraphProps) {
  const denseNetwork = isDenseNetwork(nodes.length, edges.length);
  const graphHeightClass =
    denseNetwork
      ? "h-[clamp(700px,78vh,900px)] min-h-[700px]"
      : nodes.length <= 18
      ? "h-[clamp(560px,68vh,700px)] min-h-[560px]"
      : nodes.length <= 60
        ? "h-[clamp(640px,74vh,820px)] min-h-[640px]"
        : "h-[clamp(700px,78vh,920px)] min-h-[700px]";
  const componentId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const unmappedArcLabelId = `${componentId || "circos"}-unmapped-arc-label`;

  const layout = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [getNodeId(node), node]));

    // Keep visible edges even when one endpoint has no genome coordinate.
    // Unmapped endpoints are placed in a dedicated sector instead of causing
    // the whole component to disappear from Circos.
    const annotatedEdges = edges
      .filter((edge) => {
        const sourceId = String(edge.source);
        const targetId = String(edge.target);
        if (sourceId === targetId) return false;
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        return !!sourceNode && !!targetNode;
      })
      .sort((a, b) => getRawEdgeScore(b) - getRawEdgeScore(a));

    // Collect every gene that participates in a kept edge.
    const geneIds = new Set<string>();
    annotatedEdges.forEach((edge) => {
      geneIds.add(String(edge.source));
      geneIds.add(String(edge.target));
    });

    const strongestIncidentEdgeScore = new Map<string, number>();
    annotatedEdges.forEach((edge) => {
      const score = getRawEdgeScore(edge);
      const sourceId = String(edge.source);
      const targetId = String(edge.target);
      strongestIncidentEdgeScore.set(
        sourceId,
        Math.max(strongestIncidentEdgeScore.get(sourceId) ?? 0, score),
      );
      strongestIncidentEdgeScore.set(
        targetId,
        Math.max(strongestIncidentEdgeScore.get(targetId) ?? 0, score),
      );
    });

    // Group genes by chromosome and figure out which chromosomes appear.
    const chromosomesInUse = new Set<string>();
    const unmappedGeneIds: string[] = [];
    geneIds.forEach((id) => {
      const node = nodeMap.get(id);
      if (hasGenomicCoordinate(node)) {
        chromosomesInUse.add(normalizeChromosome(node?.chromosome));
      } else {
        unmappedGeneIds.push(id);
      }
    });
    if (unmappedGeneIds.length > 0) {
      chromosomesInUse.add(UNMAPPED_CHROMOSOME);
    }

    const chromosomeList = [...chromosomesInUse].sort(
      (a, b) => getChromosomeSortValue(a) - getChromosomeSortValue(b),
    );

    const totalLength = chromosomeList.reduce(
      (sum, chr) => sum + getDisplayChromosomeLength(chr),
      0,
    );
    const totalGapAngle = chromosomeList.length * CHROMOSOME_GAP_RADIANS;
    const usableAngle = Math.PI * 2 - totalGapAngle;

    const chromosomeLayout = new Map<string, ChromosomeLayout>();
    let cursor = -Math.PI / 2; // start at 12 o'clock

    chromosomeList.forEach((chromosome) => {
      const length = getDisplayChromosomeLength(chromosome);
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

    const sortedUnmappedGeneIds = [...unmappedGeneIds].sort((a, b) =>
      a.localeCompare(b),
    );
    const unmappedGeneIndex = new Map(
      sortedUnmappedGeneIds.map((id, index) => [id, index]),
    );

    // Place mapped genes at their true genomic position inside their chromosome
    // sector. Unmapped genes are evenly distributed in the synthetic sector.
    const genePlacements = new Map<string, GenePlacement>();
    geneIds.forEach((id) => {
      const node = nodeMap.get(id);
      if (!node) return;
      const isUnmapped = !hasGenomicCoordinate(node);
      const chromosome = isUnmapped
        ? UNMAPPED_CHROMOSOME
        : normalizeChromosome(node.chromosome);
      const chrLayout = chromosomeLayout.get(chromosome);
      if (!chrLayout) return;
      const start = typeof node.start === "number" ? node.start : 0;
      const end = typeof node.end === "number" ? node.end : start;
      const unmappedIndex = unmappedGeneIndex.get(id) ?? 0;
      const fraction = isUnmapped
        ? (unmappedIndex + 1) / (sortedUnmappedGeneIds.length + 1)
        : chrLayout.length === 0
          ? 0
          : Math.min(1, Math.max(0, start / chrLayout.length));
      const angle =
        chrLayout.startAngle + fraction * (chrLayout.endAngle - chrLayout.startAngle);

      const labelPt = polarToCartesian(angle, GENE_LABEL_RADIUS);
      const strongestEdgeScore = strongestIncidentEdgeScore.get(id) ?? 0;
      const labelPriority =
        strongestEdgeScore * 10 +
        node.degree * 0.08 +
        node.outDegree * 0.05 +
        node.inDegree * 0.03 +
        (node.isTF ? 0.35 : 0);

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
        labelFontSize: 10.8,
        labelPriority,
        labelVisible: true,
        color: chrLayout.color,
        isUnmapped,
      });
    });
    resolveGeneLabelCollisions(genePlacements);

    // Keep the 0-1 evidence mapping stable when users change filters.
    const normalizedScores = new Map<string, number>();
    annotatedEdges.forEach((edge) => {
      normalizedScores.set(
        getEdgeKey(edge),
        Math.max(0, Math.min(1, getRawEdgeScore(edge))),
      );
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
      <div className={`flex items-center justify-center border border-dashed border-slate-300 bg-[#f7fafc] px-6 text-center text-sm font-medium text-slate-500 ${graphHeightClass}`}>
        {nodes.length === 0 || edges.length === 0
          ? "No edges are available for the current filters."
          : "None of the visible genes have known chromosome coordinates, so the Circos genomic view can't be drawn."}
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden bg-[#f7fafc] ${graphHeightClass}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_47%,rgba(90,148,185,0.13),transparent_48%),radial-gradient(circle_at_78%_18%,rgba(22,143,152,0.07),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f3f7fa_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(100,116,139,0.2)_0.7px,transparent_0.8px)] bg-[size:28px_28px] opacity-30" />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="relative z-10 h-full w-full"
        role="img"
        aria-label="Genomic Circos plot of predicted gene regulatory edges"
        onClick={() => {
          onSelectGene?.(null);
          onSelectEdge?.(null);
        }}
      >
        {/* Neutral chromosome bands keep edge color reserved for regulation sign. */}
        {layout.chromosomeLayout.map((chr) => {
          const isUnmapped = chr.chromosome === UNMAPPED_CHROMOSOME;
          const sectorAngle = chr.endAngle - chr.startAngle;
          // Hide the chromosome number when its sector is too narrow for the
          // glyph to fit cleanly; the colour band still carries the identity.
          const showLabel =
            isUnmapped || sectorAngle * CHROMOSOME_LABEL_RADIUS > 14;
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
                stroke="#9eb2c0"
                strokeWidth="1.4"
              >
                <title>
                  {isUnmapped
                    ? "Unmapped genes without chromosome coordinates"
                    : `${chr.chromosome} · ${(chr.length / 1e6).toFixed(1)} Mb`}
                </title>
              </path>
              {isUnmapped && (
                <defs>
                  <path
                    id={unmappedArcLabelId}
                    d={getCenteredArcTextPath(
                      chr.startAngle,
                      chr.endAngle,
                      CHROMOSOME_LABEL_RADIUS,
                    )}
                  />
                </defs>
              )}
              {isUnmapped ? (
                <text
                  dominantBaseline="central"
                  dy="0.25em"
                  className="pointer-events-none select-none fill-slate-600 text-[12px] font-bold tracking-[0.02em]"
                >
                  <textPath
                    href={`#${unmappedArcLabelId}`}
                    startOffset="50%"
                    textAnchor="middle"
                  >
                    unmapped
                  </textPath>
                </text>
              ) : showLabel ? (
                <text
                  x={chr.labelX}
                  y={chr.labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none fill-slate-600 text-[12px] font-bold tracking-[0.02em]"
                >
                  {chr.chromosome.replace("chr", "")}
                </text>
              ) : null}
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
              stroke={isSelected ? "#b7791f" : "#64748b"}
              strokeWidth={isSelected ? 4 : 1.2}
              strokeOpacity={isDimmed ? 0.18 : 1}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelectGene?.(isSelected ? null : gene.id);
              }}
            >
              <title>
                {gene.isUnmapped
                  ? `${gene.id} · unmapped`
                  : `${gene.id} · ${gene.chromosome}:${gene.start.toLocaleString()}-${gene.end.toLocaleString()}`}
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
            const ribbonOpacity = getEvidenceOpacity(score, denseNetwork);
            const sourcePosition = sourceGene.isUnmapped
              ? "unmapped"
              : `${sourceGene.chromosome}:${sourceGene.start.toLocaleString()}`;
            const targetPosition = targetGene.isUnmapped
              ? "unmapped"
              : `${targetGene.chromosome}:${targetGene.start.toLocaleString()}`;

            return (
              <path
                key={edgeKey}
                d={getRibbonPath(sourceStart, sourceEnd, targetStart, targetEnd)}
                fill={isActive ? "#d89a28" : ribbonColor}
                fillOpacity={isDimmed ? 0.05 : isActive ? 0.88 : ribbonOpacity}
                stroke={isActive ? "#9a6717" : ribbonColor}
                strokeWidth={isActive ? 3.2 : denseNetwork ? 0.55 : 0.9}
                strokeOpacity={isDimmed ? 0.1 : isActive ? 0.95 : ribbonOpacity}
                className="cursor-pointer transition"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge?.(isActive ? null : edgeKey);
                }}
              >
                <title>
                  {`${sourceId} (${sourcePosition}) → ${targetId} (${targetPosition})`}
                </title>
              </path>
            );
          })}

        {/* Gene labels */}
        {Array.from(layout.genePlacements.values())
          .filter((gene) => gene.labelVisible || gene.id === selectedGene)
          .map((gene) => {
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
                className="cursor-pointer select-none font-semibold"
                fill={isSelected ? "#9a6717" : "#334155"}
                style={{
                  fontSize: gene.labelFontSize,
                  fontWeight: isSelected ? 800 : 600,
                }}
                opacity={isDimmed ? 0.3 : 1}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectGene?.(isSelected ? null : gene.id);
                }}
              >
                <title>
                  {gene.isUnmapped
                    ? `${gene.id} · unmapped`
                    : `${gene.id} · ${gene.chromosome}:${gene.start.toLocaleString()}-${gene.end.toLocaleString()}`}
                </title>
                {gene.id}
              </text>
            );
          })}
      </svg>
    </div>
  );
}
