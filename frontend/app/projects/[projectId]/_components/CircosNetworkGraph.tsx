"use client";

import {
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";
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
  for (let index = 1; index <= 22; index += 1) order[`chr${index}`] = index;
  order.chrX = 23;
  order.chrY = 24;
  order.chrM = 25;
  return order;
})();

const WIDTH = 800;
const HEIGHT = 760;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const CHROMOSOME_INNER_RADIUS = 292;
const CHROMOSOME_OUTER_RADIUS = 318;
const CHROMOSOME_LABEL_RADIUS = 305;
const ACTIVITY_TRACK_INNER_RADIUS = 250;
const ACTIVITY_TRACK_MAX_RADIUS = 284;
const ACTIVITY_TRACK_MIN_THICKNESS = 6;
const RIBBON_RADIUS = 247;
const GENE_LABEL_RADIUS = 334;
const CHROMOSOME_GAP_RADIANS = 0.035;
const SECTOR_INNER_PADDING_RADIANS = 0.012;
const BUNDLE_ENDPOINT_GAP_RADIANS = 0.0022;
const DETAIL_ENDPOINT_MAX_HALF_WIDTH = 0.007;
const TF_MARKER_FILL = "#ffffff";
const TF_MARKER_STROKE = "#475569";

const CHROMOSOME_PALETTE = [
  "#4f7fb8",
  "#36a39a",
  "#77ad4f",
  "#d7a038",
  "#d77655",
  "#986fc0",
  "#3f9bc3",
  "#5eaf7f",
  "#c95f8b",
  "#71859f",
  "#df8b42",
  "#686fc0",
];
const UNMAPPED_CHROMOSOME = "unmapped";
const UNMAPPED_COLOR = "#94a3b8";
const ACTIVE_COLOR = "#d89a28";
const ACTIVE_STROKE = "#8f6218";
const REPRESSION_CAP_COLOR = "#334155";

type RelationKind = "activation" | "repression" | "undirected" | "uncertain";

type ChromosomeLayout = {
  chromosome: string;
  startAngle: number;
  endAngle: number;
  activity: number;
  geneCount: number;
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
  segmentStartAngle: number;
  segmentEndAngle: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end";
  labelRotation: number;
  labelFontSize: number;
  labelPriority: number;
  labelVisible: boolean;
  color: string;
  isUnmapped: boolean;
  isTF: boolean;
  activity: number;
  inDegree: number;
  outDegree: number;
};

type RibbonGeometry = {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
};

type ChromosomeBundle = {
  key: string;
  sourceChromosome: string;
  targetChromosome: string;
  relation: RelationKind;
  edges: AggregatedEdge[];
  count: number;
  averageScore: number;
  color: string;
  geometry: RibbonGeometry;
};

type CircosFocus =
  | { kind: "chromosome"; chromosome: string }
  | { kind: "bundle"; bundleKey: string };

type LabelBox = { left: number; right: number; top: number; bottom: number };

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

function getNodeChromosome(node?: NodeInfo) {
  return hasGenomicCoordinate(node)
    ? normalizeChromosome(node?.chromosome)
    : UNMAPPED_CHROMOSOME;
}

function getChromosomeSortValue(chromosome: string) {
  return chromosome === UNMAPPED_CHROMOSOME
    ? 999
    : CHROMOSOME_ORDER[chromosome] ?? 998;
}

function getChromosomeLabel(chromosome: string) {
  return chromosome === UNMAPPED_CHROMOSOME
    ? "Unknown"
    : chromosome.replace("chr", "");
}

function getEdgeKey(edge: AggregatedEdge) {
  return edge.key || `${edge.source}|||${edge.target}`;
}

function getRawEdgeScore(edge: AggregatedEdge) {
  const candidate =
    typeof edge.score === "number"
      ? edge.score
      : typeof edge.confidence === "number"
        ? edge.confidence
        : 0;
  return Number.isFinite(candidate) ? Math.max(0, Math.min(1, candidate)) : 0;
}

function getRelationKind(edge: AggregatedEdge): RelationKind {
  if (edge.direction === 0) return "undirected";
  if (edge.sign > 0) return "activation";
  if (edge.sign < 0) return "repression";
  return "uncertain";
}

function getRelationLabel(relation: RelationKind) {
  if (relation === "activation") return "activation";
  if (relation === "repression") return "repression";
  if (relation === "undirected") return "undirected";
  return "uncertain sign";
}

function getEvidenceOpacity(score: number, denseNetwork: boolean) {
  if (denseNetwork) {
    if (score >= 0.9) return 0.72;
    if (score >= 0.75) return 0.54;
    return 0.34;
  }
  if (score >= 0.9) return 0.84;
  if (score >= 0.75) return 0.66;
  return 0.44;
}

function getActivityOuterRadius(outDegree: number, maxOutgoingActivity: number) {
  const normalizedOutgoing = outDegree / Math.max(1, maxOutgoingActivity);
  return (
    ACTIVITY_TRACK_INNER_RADIUS +
    ACTIVITY_TRACK_MIN_THICKNESS +
    normalizedOutgoing *
      (ACTIVITY_TRACK_MAX_RADIUS -
        ACTIVITY_TRACK_INNER_RADIUS -
        ACTIVITY_TRACK_MIN_THICKNESS)
  );
}

function polarToCartesian(angle: number, radius: number) {
  return {
    x: CENTER_X + radius * Math.cos(angle),
    y: CENTER_Y + radius * Math.sin(angle),
  };
}

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

function getRibbonPath(geometry: RibbonGeometry, relation: RelationKind) {
  const sourceStartPoint = polarToCartesian(geometry.sourceStart, RIBBON_RADIUS);
  const sourceEndPoint = polarToCartesian(geometry.sourceEnd, RIBBON_RADIUS);
  const targetMidpoint = (geometry.targetStart + geometry.targetEnd) / 2;
  const targetHalfSpan = (geometry.targetEnd - geometry.targetStart) / 2;
  const taperedHalfSpan =
    relation === "activation"
      ? Math.min(Math.max(targetHalfSpan * 0.1, 0.0008), 0.0022)
      : targetHalfSpan;
  const targetStart = targetMidpoint - taperedHalfSpan;
  const targetEnd = targetMidpoint + taperedHalfSpan;
  const targetStartPoint = polarToCartesian(targetStart, RIBBON_RADIUS);
  const targetEndPoint = polarToCartesian(targetEnd, RIBBON_RADIUS);
  const sourceControl = polarToCartesian(
    (geometry.sourceStart + geometry.sourceEnd) / 2,
    RIBBON_RADIUS * 0.16,
  );
  const targetControl = polarToCartesian(targetMidpoint, RIBBON_RADIUS * 0.16);
  return [
    `M ${sourceStartPoint.x} ${sourceStartPoint.y}`,
    `A ${RIBBON_RADIUS} ${RIBBON_RADIUS} 0 0 1 ${sourceEndPoint.x} ${sourceEndPoint.y}`,
    `Q ${sourceControl.x} ${sourceControl.y} ${targetStartPoint.x} ${targetStartPoint.y}`,
    `A ${RIBBON_RADIUS} ${RIBBON_RADIUS} 0 0 1 ${targetEndPoint.x} ${targetEndPoint.y}`,
    `Q ${targetControl.x} ${targetControl.y} ${sourceStartPoint.x} ${sourceStartPoint.y}`,
    "Z",
  ].join(" ");
}

function getRepressionCapPath(geometry: RibbonGeometry) {
  const midpoint = (geometry.targetStart + geometry.targetEnd) / 2;
  const halfSpan = Math.max(
    (geometry.targetEnd - geometry.targetStart) / 2,
    0.006,
  );
  const start = polarToCartesian(midpoint - halfSpan, RIBBON_RADIUS);
  const end = polarToCartesian(midpoint + halfSpan, RIBBON_RADIUS);
  return `M ${start.x} ${start.y} A ${RIBBON_RADIUS} ${RIBBON_RADIUS} 0 0 1 ${end.x} ${end.y}`;
}

function getReadableLabelRotation(angle: number) {
  const degrees = (angle * 180) / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized > 90 && normalized < 270 ? degrees + 180 : degrees;
}

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

function getOverlapArea(first: LabelBox, second: LabelBox) {
  const overlapX = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const overlapY = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  return overlapX * overlapY;
}

function buildAlternatingOffsets(maxSteps: number) {
  const offsets = [0];
  for (let step = 1; step <= maxSteps; step += 1) offsets.push(-step, step);
  return offsets;
}

function resolveGeneLabelCollisions(genePlacements: Map<string, GenePlacement>) {
  const genes = Array.from(genePlacements.values())
    .filter((gene) => gene.labelVisible)
    .sort((first, second) => {
      if (second.labelPriority !== first.labelPriority) {
        return second.labelPriority - first.labelPriority;
      }
      return (
        getNormalizedAngle(first.angle) - getNormalizedAngle(second.angle) ||
        first.id.localeCompare(second.id)
      );
    });
  const labelFontSize = genes.length > 24 ? 9 : genes.length > 14 ? 9.8 : 10.6;
  const angularNudgeStep = genes.length > 24 ? 0.017 : 0.013;
  const offsets = buildAlternatingOffsets(genes.length > 24 ? 8 : 5);
  const placedBoxes: LabelBox[] = [];
  genes.forEach((gene) => {
    gene.labelFontSize = labelFontSize;
    gene.labelVisible = false;
    for (const offset of offsets) {
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
      const labelPoint = polarToCartesian(candidateAngle, GENE_LABEL_RADIUS);
      gene.labelX = labelPoint.x;
      gene.labelY = labelPoint.y;
      gene.labelAnchor = anchor;
      gene.labelRotation = rotation;
      gene.labelVisible = true;
      placedBoxes.push(box);
      break;
    }
  });
}

function handleKeyboardActivation(
  event: ReactKeyboardEvent<SVGElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

function getBundleKey(
  sourceChromosome: string,
  targetChromosome: string,
  relation: RelationKind,
) {
  return `${sourceChromosome}|||${targetChromosome}|||${relation}`;
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
  const graphHeightClass = denseNetwork
    ? "h-[clamp(720px,80vh,940px)] min-h-[720px]"
    : nodes.length <= 18
      ? "h-[clamp(600px,72vh,760px)] min-h-[600px]"
      : nodes.length <= 60
        ? "h-[clamp(680px,76vh,860px)] min-h-[680px]"
        : "h-[clamp(720px,80vh,940px)] min-h-[720px]";
  const [focus, setFocus] = useState<CircosFocus | null>(null);
  const [hoveredGene, setHoveredGene] = useState<string | null>(null);
  const [hoveredBundleKey, setHoveredBundleKey] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  const layout = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [getNodeId(node), node]));
    const annotatedEdges = edges
      .filter((edge) => {
        const sourceId = String(edge.source);
        const targetId = String(edge.target);
        return sourceId !== targetId && nodeMap.has(sourceId) && nodeMap.has(targetId);
      })
      .sort(
        (first, second) =>
          getRawEdgeScore(second) - getRawEdgeScore(first) ||
          getEdgeKey(first).localeCompare(getEdgeKey(second)),
      );
    const geneIds = new Set<string>();
    const strongestIncidentEdgeScore = new Map<string, number>();
    const incidentActivity = new Map<string, number>();
    const incomingActivity = new Map<string, number>();
    const outgoingActivity = new Map<string, number>();
    const chromosomeActivity = new Map<string, number>();

    annotatedEdges.forEach((edge) => {
      const sourceId = String(edge.source);
      const targetId = String(edge.target);
      const sourceChromosome = getNodeChromosome(nodeMap.get(sourceId));
      const targetChromosome = getNodeChromosome(nodeMap.get(targetId));
      const score = getRawEdgeScore(edge);
      geneIds.add(sourceId);
      geneIds.add(targetId);
      strongestIncidentEdgeScore.set(
        sourceId,
        Math.max(strongestIncidentEdgeScore.get(sourceId) ?? 0, score),
      );
      strongestIncidentEdgeScore.set(
        targetId,
        Math.max(strongestIncidentEdgeScore.get(targetId) ?? 0, score),
      );
      incidentActivity.set(sourceId, (incidentActivity.get(sourceId) ?? 0) + 1);
      incidentActivity.set(targetId, (incidentActivity.get(targetId) ?? 0) + 1);
      outgoingActivity.set(sourceId, (outgoingActivity.get(sourceId) ?? 0) + 1);
      incomingActivity.set(targetId, (incomingActivity.get(targetId) ?? 0) + 1);
      chromosomeActivity.set(
        sourceChromosome,
        (chromosomeActivity.get(sourceChromosome) ?? 0) + 1,
      );
      chromosomeActivity.set(
        targetChromosome,
        (chromosomeActivity.get(targetChromosome) ?? 0) + 1,
      );
    });

    const genesByChromosome = new Map<string, string[]>();
    geneIds.forEach((geneId) => {
      const chromosome = getNodeChromosome(nodeMap.get(geneId));
      genesByChromosome.set(chromosome, [
        ...(genesByChromosome.get(chromosome) ?? []),
        geneId,
      ]);
    });
    const chromosomeList = Array.from(genesByChromosome.keys()).sort(
      (first, second) =>
        getChromosomeSortValue(first) - getChromosomeSortValue(second),
    );
    const chromosomeWeights = new Map(
      chromosomeList.map((chromosome) => {
        const activity = chromosomeActivity.get(chromosome) ?? 0;
        const weight = 1 + Math.sqrt(Math.max(1, activity)) * 1.35;
        return [
          chromosome,
          chromosome === UNMAPPED_CHROMOSOME ? Math.min(weight, 2.4) : weight,
        ];
      }),
    );
    const totalWeight = Array.from(chromosomeWeights.values()).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    const usableAngle = Math.max(
      0,
      Math.PI * 2 - chromosomeList.length * CHROMOSOME_GAP_RADIANS,
    );
    const chromosomeLayout = new Map<string, ChromosomeLayout>();
    let cursor = -Math.PI / 2;
    chromosomeList.forEach((chromosome, chromosomeIndex) => {
      const activity = chromosomeActivity.get(chromosome) ?? 0;
      const weight = chromosomeWeights.get(chromosome) ?? 1;
      const sectorAngle = totalWeight === 0 ? 0 : (usableAngle * weight) / totalWeight;
      const startAngle = cursor;
      const endAngle = cursor + sectorAngle;
      const labelPoint = polarToCartesian(
        (startAngle + endAngle) / 2,
        CHROMOSOME_LABEL_RADIUS,
      );
      chromosomeLayout.set(chromosome, {
        chromosome,
        startAngle,
        endAngle,
        activity,
        geneCount: genesByChromosome.get(chromosome)?.length ?? 0,
        color:
          chromosome === UNMAPPED_CHROMOSOME
            ? UNMAPPED_COLOR
            : CHROMOSOME_PALETTE[chromosomeIndex % CHROMOSOME_PALETTE.length],
        labelX: labelPoint.x,
        labelY: labelPoint.y,
      });
      cursor = endAngle + CHROMOSOME_GAP_RADIANS;
    });

    const genePlacements = new Map<string, GenePlacement>();
    chromosomeList.forEach((chromosome) => {
      const chromosomeGenes = [...(genesByChromosome.get(chromosome) ?? [])].sort(
        (firstId, secondId) => {
          const firstNode = nodeMap.get(firstId);
          const secondNode = nodeMap.get(secondId);
          const firstStart =
            typeof firstNode?.start === "number"
              ? firstNode.start
              : Number.POSITIVE_INFINITY;
          const secondStart =
            typeof secondNode?.start === "number"
              ? secondNode.start
              : Number.POSITIVE_INFINITY;
          return firstStart - secondStart || firstId.localeCompare(secondId);
        },
      );
      const chromosomeSector = chromosomeLayout.get(chromosome);
      if (!chromosomeSector || chromosomeGenes.length === 0) return;
      const sectorSpan = chromosomeSector.endAngle - chromosomeSector.startAngle;
      const padding = Math.min(SECTOR_INNER_PADDING_RADIANS, sectorSpan * 0.06);
      const usableStart = chromosomeSector.startAngle + padding;
      const usableEnd = chromosomeSector.endAngle - padding;
      const geneSlotSpan = (usableEnd - usableStart) / chromosomeGenes.length;
      chromosomeGenes.forEach((geneId, geneIndex) => {
        const node = nodeMap.get(geneId);
        if (!node) return;
        const slotStart = usableStart + geneIndex * geneSlotSpan;
        const slotEnd = slotStart + geneSlotSpan;
        const segmentPadding = Math.min(0.0025, geneSlotSpan * 0.12);
        const segmentStartAngle = slotStart + segmentPadding;
        const segmentEndAngle = slotEnd - segmentPadding;
        const angle = (segmentStartAngle + segmentEndAngle) / 2;
        const labelPoint = polarToCartesian(angle, GENE_LABEL_RADIUS);
        const labelPriority =
          (strongestIncidentEdgeScore.get(geneId) ?? 0) * 12 +
          node.outDegree * 0.2 +
          node.degree * 0.08 +
          (node.isTF ? 0.8 : 0);
        genePlacements.set(geneId, {
          id: geneId,
          chromosome,
          start: typeof node.start === "number" ? node.start : 0,
          end:
            typeof node.end === "number"
              ? node.end
              : typeof node.start === "number"
                ? node.start
                : 0,
          angle,
          segmentStartAngle,
          segmentEndAngle,
          labelX: labelPoint.x,
          labelY: labelPoint.y,
          labelAnchor: Math.cos(angle) >= 0 ? "start" : "end",
          labelRotation: getReadableLabelRotation(angle),
          labelFontSize: 10.6,
          labelPriority,
          labelVisible: false,
          color: chromosomeSector.color,
          isUnmapped: chromosome === UNMAPPED_CHROMOSOME,
          isTF: node.isTF,
          activity: incidentActivity.get(geneId) ?? 0,
          inDegree: incomingActivity.get(geneId) ?? 0,
          outDegree: outgoingActivity.get(geneId) ?? 0,
        });
      });
    });
    const overviewLabelLimit = denseNetwork ? 10 : Math.min(16, geneIds.size);
    Array.from(genePlacements.values())
      .sort(
        (first, second) =>
          second.labelPriority - first.labelPriority || first.id.localeCompare(second.id),
      )
      .slice(0, overviewLabelLimit)
      .forEach((gene) => {
        gene.labelVisible = true;
      });
    resolveGeneLabelCollisions(genePlacements);

    const bundleDrafts = new Map<
      string,
      Omit<ChromosomeBundle, "geometry" | "averageScore" | "count"> & {
        scoreTotal: number;
      }
    >();
    annotatedEdges.forEach((edge) => {
      const sourceGene = genePlacements.get(String(edge.source));
      const targetGene = genePlacements.get(String(edge.target));
      if (!sourceGene || !targetGene) return;
      const relation = getRelationKind(edge);
      const key = getBundleKey(
        sourceGene.chromosome,
        targetGene.chromosome,
        relation,
      );
      const existing = bundleDrafts.get(key);
      if (existing) {
        existing.edges.push(edge);
        existing.scoreTotal += getRawEdgeScore(edge);
      } else {
        bundleDrafts.set(key, {
          key,
          sourceChromosome: sourceGene.chromosome,
          targetChromosome: targetGene.chromosome,
          relation,
          edges: [edge],
          scoreTotal: getRawEdgeScore(edge),
          color: sourceGene.color,
        });
      }
    });
    const bundleDraftList = Array.from(bundleDrafts.values()).sort(
      (first, second) =>
        getChromosomeSortValue(first.sourceChromosome) -
          getChromosomeSortValue(second.sourceChromosome) ||
        getChromosomeSortValue(first.targetChromosome) -
          getChromosomeSortValue(second.targetChromosome) ||
        first.relation.localeCompare(second.relation),
    );
    const endpointReferences = new Map<
      string,
      Array<{ endpointKey: string; weight: number; order: number }>
    >();
    bundleDraftList.forEach((bundle) => {
      endpointReferences.set(bundle.sourceChromosome, [
        ...(endpointReferences.get(bundle.sourceChromosome) ?? []),
        {
          endpointKey: `${bundle.key}|||source`,
          weight: bundle.edges.length,
          order: getChromosomeSortValue(bundle.targetChromosome),
        },
      ]);
      endpointReferences.set(bundle.targetChromosome, [
        ...(endpointReferences.get(bundle.targetChromosome) ?? []),
        {
          endpointKey: `${bundle.key}|||target`,
          weight: bundle.edges.length,
          order: getChromosomeSortValue(bundle.sourceChromosome),
        },
      ]);
    });
    const endpointSpans = new Map<string, { start: number; end: number }>();
    endpointReferences.forEach((references, chromosome) => {
      const chromosomeSector = chromosomeLayout.get(chromosome);
      if (!chromosomeSector) return;
      const sortedReferences = [...references].sort(
        (first, second) =>
          first.order - second.order || first.endpointKey.localeCompare(second.endpointKey),
      );
      const totalEndpointWeight = sortedReferences.reduce(
        (sum, reference) => sum + reference.weight,
        0,
      );
      const sectorStart = chromosomeSector.startAngle + SECTOR_INNER_PADDING_RADIANS;
      const sectorEnd = chromosomeSector.endAngle - SECTOR_INNER_PADDING_RADIANS;
      const availableSpan = Math.max(0, sectorEnd - sectorStart);
      let endpointCursor = sectorStart;
      sortedReferences.forEach((reference) => {
        const endpointSpan =
          totalEndpointWeight === 0
            ? 0
            : (availableSpan * reference.weight) / totalEndpointWeight;
        const gap = Math.min(BUNDLE_ENDPOINT_GAP_RADIANS, endpointSpan * 0.18);
        endpointSpans.set(reference.endpointKey, {
          start: endpointCursor + gap,
          end: endpointCursor + endpointSpan - gap,
        });
        endpointCursor += endpointSpan;
      });
    });
    const bundles: ChromosomeBundle[] = bundleDraftList
      .map((bundle) => {
        const sourceSpan = endpointSpans.get(`${bundle.key}|||source`);
        const targetSpan = endpointSpans.get(`${bundle.key}|||target`);
        if (!sourceSpan || !targetSpan) return null;
        return {
          key: bundle.key,
          sourceChromosome: bundle.sourceChromosome,
          targetChromosome: bundle.targetChromosome,
          relation: bundle.relation,
          edges: bundle.edges,
          count: bundle.edges.length,
          averageScore: bundle.scoreTotal / bundle.edges.length,
          color: bundle.color,
          geometry: {
            sourceStart: sourceSpan.start,
            sourceEnd: sourceSpan.end,
            targetStart: targetSpan.start,
            targetEnd: targetSpan.end,
          },
        };
      })
      .filter((bundle): bundle is ChromosomeBundle => bundle !== null)
      .sort(
        (first, second) =>
          second.count - first.count ||
          second.averageScore - first.averageScore ||
          first.key.localeCompare(second.key),
      );
    return {
      annotatedEdges,
      chromosomeLayout,
      genePlacements,
      bundles,
      bundleMap: new Map(bundles.map((bundle) => [bundle.key, bundle])),
      maxOutgoingActivity: Math.max(1, ...Array.from(outgoingActivity.values())),
    };
  }, [denseNetwork, edges, nodes]);

  const activeFocus = useMemo(() => {
    if (!focus) return null;
    if (focus.kind === "bundle") {
      return layout.bundleMap.has(focus.bundleKey) ? focus : null;
    }
    return layout.chromosomeLayout.has(focus.chromosome) ? focus : null;
  }, [focus, layout.bundleMap, layout.chromosomeLayout]);

  const detailEdges = useMemo(() => {
    if (activeFocus?.kind === "bundle") {
      return layout.bundleMap.get(activeFocus.bundleKey)?.edges ?? [];
    }
    if (activeFocus?.kind === "chromosome") {
      return layout.annotatedEdges.filter((edge) => {
        const sourceGene = layout.genePlacements.get(String(edge.source));
        const targetGene = layout.genePlacements.get(String(edge.target));
        return (
          sourceGene?.chromosome === activeFocus.chromosome ||
          targetGene?.chromosome === activeFocus.chromosome
        );
      });
    }
    if (selectedGene) {
      return layout.annotatedEdges.filter(
        (edge) =>
          String(edge.source) === selectedGene || String(edge.target) === selectedGene,
      );
    }
    if (selectedEdgeKey) {
      const selected = layout.annotatedEdges.find(
        (edge) => getEdgeKey(edge) === selectedEdgeKey,
      );
      return selected ? [selected] : [];
    }
    return [];
  }, [activeFocus, layout, selectedEdgeKey, selectedGene]);
  const isDetailMode =
    detailEdges.length > 0 &&
    Boolean(activeFocus || selectedGene || selectedEdgeKey);
  const detailGeneIds = useMemo(() => {
    const geneIds = new Set<string>();
    detailEdges.forEach((edge) => {
      geneIds.add(String(edge.source));
      geneIds.add(String(edge.target));
    });
    return geneIds;
  }, [detailEdges]);
  const detailChromosomes = useMemo(() => {
    const chromosomes = new Set<string>();
    detailGeneIds.forEach((geneId) => {
      const chromosome = layout.genePlacements.get(geneId)?.chromosome;
      if (chromosome) chromosomes.add(chromosome);
    });
    return chromosomes;
  }, [detailGeneIds, layout.genePlacements]);

  const detailEdgeGeometry = useMemo(() => {
    const incidentEdgeKeys = new Map<string, string[]>();
    detailEdges.forEach((edge) => {
      const edgeKey = getEdgeKey(edge);
      for (const geneId of [String(edge.source), String(edge.target)]) {
        incidentEdgeKeys.set(geneId, [
          ...(incidentEdgeKeys.get(geneId) ?? []),
          edgeKey,
        ]);
      }
    });
    incidentEdgeKeys.forEach((edgeKeys) => edgeKeys.sort());
    const getEndpointSpan = (geneId: string, edgeKey: string) => {
      const gene = layout.genePlacements.get(geneId);
      const edgeKeys = incidentEdgeKeys.get(geneId) ?? [];
      if (!gene || edgeKeys.length === 0) return null;
      const segmentSpan = gene.segmentEndAngle - gene.segmentStartAngle;
      const edgeIndex = Math.max(0, edgeKeys.indexOf(edgeKey));
      const slotSpan = segmentSpan / edgeKeys.length;
      const midpoint = gene.segmentStartAngle + slotSpan * (edgeIndex + 0.5);
      const halfWidth = Math.min(DETAIL_ENDPOINT_MAX_HALF_WIDTH, slotSpan * 0.36);
      return { start: midpoint - halfWidth, end: midpoint + halfWidth };
    };
    const geometries = new Map<string, RibbonGeometry>();
    detailEdges.forEach((edge) => {
      const edgeKey = getEdgeKey(edge);
      const sourceSpan = getEndpointSpan(String(edge.source), edgeKey);
      const targetSpan = getEndpointSpan(String(edge.target), edgeKey);
      if (!sourceSpan || !targetSpan) return;
      geometries.set(edgeKey, {
        sourceStart: sourceSpan.start,
        sourceEnd: sourceSpan.end,
        targetStart: targetSpan.start,
        targetEnd: targetSpan.end,
      });
    });
    return geometries;
  }, [detailEdges, layout.genePlacements]);

  const displayGenePlacements = useMemo(() => {
    const placements = new Map(
      Array.from(layout.genePlacements.entries()).map(([geneId, gene]) => [
        geneId,
        { ...gene, labelVisible: false },
      ]),
    );
    const detailGenes = Array.from(detailGeneIds)
      .map((geneId) => placements.get(geneId))
      .filter((gene): gene is GenePlacement => Boolean(gene))
      .sort(
        (first, second) =>
          second.labelPriority - first.labelPriority || first.id.localeCompare(second.id),
      );
    const labelIds = new Set<string>();
    if (isDetailMode) {
      detailGenes
        .slice(0, detailGeneIds.size <= 24 ? 24 : 18)
        .forEach((gene) => labelIds.add(gene.id));
    } else {
      Array.from(layout.genePlacements.values())
        .filter((gene) => gene.labelVisible)
        .forEach((gene) => labelIds.add(gene.id));
    }
    if (selectedGene) labelIds.add(selectedGene);
    if (hoveredGene) labelIds.add(hoveredGene);
    labelIds.forEach((geneId) => {
      const gene = placements.get(geneId);
      if (gene) gene.labelVisible = true;
    });
    resolveGeneLabelCollisions(placements);
    return placements;
  }, [detailGeneIds, hoveredGene, isDetailMode, layout, selectedGene]);

  const modeLabel = useMemo(() => {
    if (activeFocus?.kind === "bundle") {
      const bundle = layout.bundleMap.get(activeFocus.bundleKey);
      if (bundle) {
        return `${getChromosomeLabel(bundle.sourceChromosome)} → ${getChromosomeLabel(bundle.targetChromosome)} · ${getRelationLabel(bundle.relation)}`;
      }
    }
    if (activeFocus?.kind === "chromosome") {
      return `${getChromosomeLabel(activeFocus.chromosome)} regulatory neighborhood`;
    }
    if (selectedGene) return `${selectedGene} regulatory neighborhood`;
    if (selectedEdgeKey && detailEdges[0]) {
      return `${detailEdges[0].source} → ${detailEdges[0].target}`;
    }
    return "Chromosome flow";
  }, [activeFocus, detailEdges, layout.bundleMap, selectedEdgeKey, selectedGene]);

  const returnToOverview = () => {
    setFocus(null);
    setHoveredGene(null);
    setHoveredBundleKey(null);
    setHoveredEdgeKey(null);
    onSelectGene?.(null);
    onSelectEdge?.(null);
  };

  if (
    nodes.length === 0 ||
    edges.length === 0 ||
    layout.annotatedEdges.length === 0
  ) {
    return (
      <div
        className={`flex items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center text-sm font-medium text-slate-500 ${graphHeightClass}`}
      >
        No regulations are available for the current filters.
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden bg-white ${graphHeightClass}`}>
      {isDetailMode ? (
        <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={returnToOverview}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-[#eef6fa] px-2.5 text-[11px] font-bold text-[#176f9e] transition hover:bg-[#e2f0f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/30"
          >
            <span aria-hidden="true">←</span>
            Overview
          </button>
          <span className="truncate text-[11px] font-bold text-slate-700">
            {modeLabel}
          </span>
          <span className="shrink-0 text-[10px] font-semibold text-slate-400">
            {`${detailEdges.length} regulation${detailEdges.length === 1 ? "" : "s"}`}
          </span>
        </div>
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="relative z-10 h-full w-full"
        role="img"
        aria-label={
          isDetailMode
            ? `Gene-level Circos view for ${modeLabel}`
            : "Chromosome-level Circos overview of regulatory flow"
        }
        onClick={returnToOverview}
        onKeyDown={(event) => {
          if (event.key === "Escape" && isDetailMode) {
            event.stopPropagation();
            returnToOverview();
          }
        }}
      >
        <title>
          {isDetailMode
            ? `Gene-level Circos view for ${modeLabel}`
            : "Chromosome-level regulatory flow. Select a chromosome or ribbon to inspect individual gene regulations."}
        </title>
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={RIBBON_RADIUS}
          fill="#fbfdfe"
          stroke="#e8eef3"
          strokeWidth="1"
        />

        {!isDetailMode
          ? layout.bundles.map((bundle) => {
              const isHovered = bundle.key === hoveredBundleKey;
              const isDimmed = Boolean(
                hoveredBundleKey && hoveredBundleKey !== bundle.key,
              );
              const opacity = getEvidenceOpacity(bundle.averageScore, denseNetwork);
              const activateBundle = () => {
                setFocus((currentFocus) =>
                  currentFocus?.kind === "bundle" &&
                  currentFocus.bundleKey === bundle.key
                    ? null
                    : { kind: "bundle", bundleKey: bundle.key },
                );
                setHoveredBundleKey(null);
                onSelectGene?.(null);
                onSelectEdge?.(null);
              };
              return (
                <g key={`bundle-${bundle.key}`}>
                  <path
                    d={getRibbonPath(bundle.geometry, bundle.relation)}
                    fill={bundle.color}
                    fillOpacity={isDimmed ? 0.06 : isHovered ? 0.9 : opacity}
                    stroke={bundle.color}
                    strokeWidth={isHovered ? 2.2 : 0.8}
                    strokeOpacity={isDimmed ? 0.08 : isHovered ? 1 : opacity}
                    className="cursor-pointer transition"
                    role="button"
                    tabIndex={0}
                    aria-label={`${getChromosomeLabel(bundle.sourceChromosome)} to ${getChromosomeLabel(bundle.targetChromosome)}, ${bundle.count} ${getRelationLabel(bundle.relation)} regulations`}
                    onMouseEnter={() => setHoveredBundleKey(bundle.key)}
                    onMouseLeave={() => setHoveredBundleKey(null)}
                    onFocus={() => setHoveredBundleKey(bundle.key)}
                    onBlur={() => setHoveredBundleKey(null)}
                    onClick={(event) => {
                      event.stopPropagation();
                      activateBundle();
                    }}
                    onKeyDown={(event) => handleKeyboardActivation(event, activateBundle)}
                  >
                    <title>
                      {`${getChromosomeLabel(bundle.sourceChromosome)} → ${getChromosomeLabel(bundle.targetChromosome)} · ${bundle.count} ${getRelationLabel(bundle.relation)} regulation${bundle.count === 1 ? "" : "s"}`}
                    </title>
                  </path>
                  {bundle.relation === "repression" ? (
                    <path
                      d={getRepressionCapPath(bundle.geometry)}
                      fill="none"
                      stroke={REPRESSION_CAP_COLOR}
                      strokeWidth={isHovered ? 3.4 : 2.5}
                      strokeLinecap="round"
                      opacity={isDimmed ? 0.08 : Math.min(1, opacity + 0.18)}
                      className="pointer-events-none"
                    />
                  ) : null}
                </g>
              );
            })
          : detailEdges
              .slice()
              .reverse()
              .map((edge) => {
                const edgeKey = getEdgeKey(edge);
                const geometry = detailEdgeGeometry.get(edgeKey);
                const sourceGene = layout.genePlacements.get(String(edge.source));
                const targetGene = layout.genePlacements.get(String(edge.target));
                if (!geometry || !sourceGene || !targetGene) return null;
                const relation = getRelationKind(edge);
                const isActive = edgeKey === selectedEdgeKey;
                const isHovered = edgeKey === hoveredEdgeKey;
                const isDimmed = Boolean(
                  selectedGene &&
                    String(edge.source) !== selectedGene &&
                    String(edge.target) !== selectedGene,
                );
                const opacity = getEvidenceOpacity(getRawEdgeScore(edge), denseNetwork);
                const activateEdge = () => {
                  onSelectEdge?.(isActive ? null : edgeKey);
                };
                return (
                  <g key={`edge-${edgeKey}`}>
                    <path
                      d={getRibbonPath(geometry, relation)}
                      fill={isActive ? ACTIVE_COLOR : sourceGene.color}
                      fillOpacity={
                        isDimmed
                          ? 0.05
                          : isActive
                            ? 0.92
                            : isHovered
                              ? Math.min(1, opacity + 0.18)
                              : opacity
                      }
                      stroke={isActive ? ACTIVE_STROKE : sourceGene.color}
                      strokeWidth={isActive ? 2.8 : isHovered ? 1.7 : 0.7}
                      strokeOpacity={isDimmed ? 0.08 : 0.9}
                      className="cursor-pointer transition"
                      role="button"
                      tabIndex={0}
                      aria-pressed={isActive}
                      aria-label={`${edge.source} to ${edge.target}, ${getRelationLabel(relation)} regulation`}
                      onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                      onMouseLeave={() => setHoveredEdgeKey(null)}
                      onFocus={() => setHoveredEdgeKey(edgeKey)}
                      onBlur={() => setHoveredEdgeKey(null)}
                      onClick={(event) => {
                        event.stopPropagation();
                        activateEdge();
                      }}
                      onKeyDown={(event) => handleKeyboardActivation(event, activateEdge)}
                    >
                      <title>
                        {`${edge.source} → ${edge.target} · ${getRelationLabel(relation)}`}
                      </title>
                    </path>
                    {relation === "repression" ? (
                      <path
                        d={getRepressionCapPath(geometry)}
                        fill="none"
                        stroke={isActive ? ACTIVE_STROKE : REPRESSION_CAP_COLOR}
                        strokeWidth={isActive ? 3.2 : 2.2}
                        strokeLinecap="round"
                        opacity={isDimmed ? 0.08 : Math.min(1, opacity + 0.2)}
                        className="pointer-events-none"
                      />
                    ) : null}
                  </g>
                );
              })}

        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={ACTIVITY_TRACK_INNER_RADIUS}
          fill="none"
          stroke="#e4ebf1"
          strokeWidth="1"
        />
        {Array.from(layout.genePlacements.values()).map((gene) => {
          const activityOuterRadius = getActivityOuterRadius(
            gene.outDegree,
            layout.maxOutgoingActivity,
          );
          const isSelected = gene.id === selectedGene;
          const isHovered = gene.id === hoveredGene;
          const isDimmed = isDetailMode && !detailGeneIds.has(gene.id);
          const activateGene = () => {
            onSelectGene?.(isSelected ? null : gene.id);
          };
          return (
            <path
              key={`activity-${gene.id}`}
              d={getAnnularArcPath(
                gene.segmentStartAngle,
                gene.segmentEndAngle,
                ACTIVITY_TRACK_INNER_RADIUS,
                activityOuterRadius,
              )}
              fill={isSelected ? ACTIVE_COLOR : gene.color}
              fillOpacity={
                isDimmed ? 0.14 : isSelected ? 0.96 : isHovered ? 1 : 0.8
              }
              stroke={isSelected ? ACTIVE_STROKE : "white"}
              strokeWidth={isSelected ? 2.2 : isHovered ? 1.5 : 0.8}
              className="cursor-pointer transition"
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${gene.id}, ${gene.isTF ? "transcription factor" : "gene"}, ${gene.outDegree} outgoing regulations`}
              onMouseEnter={() => setHoveredGene(gene.id)}
              onMouseLeave={() => setHoveredGene(null)}
              onFocus={() => setHoveredGene(gene.id)}
              onBlur={() => setHoveredGene(null)}
              onClick={(event) => {
                event.stopPropagation();
                activateGene();
              }}
              onKeyDown={(event) => handleKeyboardActivation(event, activateGene)}
            >
              <title>
                {gene.isUnmapped
                  ? `${gene.id} · unmapped · ${gene.outDegree} outgoing / ${gene.inDegree} incoming`
                  : `${gene.id} · ${gene.chromosome}:${gene.start.toLocaleString()}-${gene.end.toLocaleString()} · ${gene.outDegree} outgoing / ${gene.inDegree} incoming`}
              </title>
            </path>
          );
        })}
        {Array.from(layout.genePlacements.values())
          .filter((gene) => gene.isTF)
          .map((gene) => {
            const activityOuterRadius = getActivityOuterRadius(
              gene.outDegree,
              layout.maxOutgoingActivity,
            );
            const markerPoint = polarToCartesian(
              gene.angle,
              activityOuterRadius - ACTIVITY_TRACK_MIN_THICKNESS / 2,
            );
            const isSelected = gene.id === selectedGene;
            const isDimmed = isDetailMode && !detailGeneIds.has(gene.id);
            return (
              <rect
                key={`tf-${gene.id}`}
                x={markerPoint.x - 3.4}
                y={markerPoint.y - 3.4}
                width="6.8"
                height="6.8"
                rx="0.8"
                fill={isSelected ? ACTIVE_COLOR : TF_MARKER_FILL}
                stroke={isSelected ? ACTIVE_STROKE : TF_MARKER_STROKE}
                strokeWidth="1.5"
                opacity={isDimmed ? 0.22 : 1}
                transform={`rotate(45 ${markerPoint.x} ${markerPoint.y})`}
                className="pointer-events-none"
              >
                <title>{`${gene.id} · transcription factor`}</title>
              </rect>
            );
          })}
        {Array.from(layout.chromosomeLayout.values()).map((chromosome) => {
          const isFocused =
            activeFocus?.kind === "chromosome" &&
            activeFocus.chromosome === chromosome.chromosome;
          const isDimmed = isDetailMode && !detailChromosomes.has(chromosome.chromosome);
          const activateChromosome = () => {
            setFocus((currentFocus) =>
              currentFocus?.kind === "chromosome" &&
              currentFocus.chromosome === chromosome.chromosome
                ? null
                : { kind: "chromosome", chromosome: chromosome.chromosome },
            );
            onSelectGene?.(null);
            onSelectEdge?.(null);
          };
          const showLabel =
            (chromosome.endAngle - chromosome.startAngle) * CHROMOSOME_LABEL_RADIUS > 18;
          return (
            <g key={`chromosome-${chromosome.chromosome}`}>
              <path
                d={getAnnularArcPath(
                  chromosome.startAngle,
                  chromosome.endAngle,
                  CHROMOSOME_INNER_RADIUS,
                  CHROMOSOME_OUTER_RADIUS,
                )}
                fill={isFocused ? ACTIVE_COLOR : chromosome.color}
                fillOpacity={isDimmed ? 0.18 : 0.96}
                stroke={isFocused ? ACTIVE_STROKE : "white"}
                strokeWidth={isFocused ? 3 : 3.6}
                className="cursor-pointer transition"
                role="button"
                tabIndex={0}
                aria-pressed={isFocused}
                aria-label={`${getChromosomeLabel(chromosome.chromosome)} chromosome sector, ${chromosome.geneCount} genes and ${chromosome.activity} regulatory endpoints`}
                onClick={(event) => {
                  event.stopPropagation();
                  activateChromosome();
                }}
                onKeyDown={(event) =>
                  handleKeyboardActivation(event, activateChromosome)
                }
              >
                <title>
                  {`${getChromosomeLabel(chromosome.chromosome)} · ${chromosome.geneCount} gene${chromosome.geneCount === 1 ? "" : "s"} · ${chromosome.activity} regulatory endpoints`}
                </title>
              </path>
              {showLabel ? (
                <text
                  x={chromosome.labelX}
                  y={chromosome.labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  opacity={isDimmed ? 0.38 : 1}
                  className="pointer-events-none select-none text-[11px] font-extrabold tracking-[0.02em]"
                >
                  {getChromosomeLabel(chromosome.chromosome)}
                </text>
              ) : null}
            </g>
          );
        })}
        {Array.from(displayGenePlacements.values())
          .filter((gene) => gene.labelVisible)
          .map((gene) => {
            const isSelected = gene.id === selectedGene;
            const isHovered = gene.id === hoveredGene;
            const isDimmed = isDetailMode && !detailGeneIds.has(gene.id);
            return (
              <text
                key={`label-${gene.id}`}
                x={gene.labelX}
                y={gene.labelY}
                textAnchor={gene.labelAnchor}
                dominantBaseline="middle"
                transform={`rotate(${gene.labelRotation} ${gene.labelX} ${gene.labelY})`}
                fill={
                  isSelected ? ACTIVE_STROKE : isHovered ? "#0f4f73" : "#334155"
                }
                opacity={isDimmed ? 0.22 : 1}
                className="cursor-pointer select-none font-semibold"
                style={{
                  fontSize: gene.labelFontSize,
                  fontWeight: isSelected || isHovered ? 800 : 650,
                }}
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
