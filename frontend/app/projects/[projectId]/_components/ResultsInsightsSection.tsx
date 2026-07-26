"use client";

import { useMemo, useState } from "react";
import type {
  AggregatedEdge,
  AlgorithmResultEdge,
  AlgorithmStoredResult,
  NodeInfo,
  ProjectTask,
} from "../_lib/types";
import type { ResultsHubView } from "./ResultsHubViewSelector";

export type VisualizationContext = {
  trajectory?: {
    available: boolean;
    reason?: string;
    genes?: string[];
    lineages?: Array<{
      name: string;
      cell_count: number;
      bins: Array<{
        pseudotime: number;
        cell_count: number;
        raw_expression: Record<string, number>;
        scaled_expression: Record<string, number | null>;
      }>;
    }>;
  };
  ground_truth?: {
    available: boolean;
    reason?: string;
    filename?: string;
    edge_count?: number;
    edges?: Array<{ source: string; target: string; sign?: string }>;
  };
};

type InsightView = Exclude<ResultsHubView, "network" | "perturbation">;

type ResultsInsightsSectionProps = {
  view: InsightView;
  activeEdges: AggregatedEdge[];
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  tasks: ProjectTask[];
  networkNodes: NodeInfo[];
  visualizationContext: VisualizationContext | null;
  isContextLoading: boolean;
};

const PALETTE = ["#087ead", "#7c3aed", "#db2777", "#ea580c", "#059669", "#475569", "#ca8a04", "#0891b2"];

function edgeKey(source: string, target: string) {
  return `${source}\u0000${target}`;
}

function resultEdges(result?: AlgorithmStoredResult): AlgorithmResultEdge[] {
  if (!result) return [];
  if (result.scopes?.global?.status === "Completed") {
    return result.scopes.global.top_edges ?? [];
  }
  return result.top_edges ?? result.edges ?? result.ranked_edges ?? [];
}

function edgeScore(edge: AlgorithmResultEdge) {
  const value = Number(
    edge.normalized_score ??
      edge.confidence ??
      edge.mean_percentile ??
      edge.meanPercentile ??
      edge.score ??
      edge.weight ??
      edge.edge_weight ??
      0,
  );
  return Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-16 text-center">
      <p className="text-base font-bold text-slate-950">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-extrabold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {aside}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function HorizontalBars({
  rows,
  valueLabel,
}: {
  rows: Array<{ label: string; value: number; note?: string }>;
  valueLabel?: (value: number) => string;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">{row.label}</p>
            {row.note ? <p className="truncate text-[11px] text-slate-500">{row.note}</p> : null}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#087ead]"
              style={{ width: `${Math.max(2, (row.value / maximum) * 100)}%` }}
            />
          </div>
          <span className="min-w-12 text-right text-sm font-bold tabular-nums text-slate-700">
            {valueLabel ? valueLabel(row.value) : formatNumber(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RegulatorView({
  activeEdges,
  networkNodes,
}: {
  activeEdges: AggregatedEdge[];
  networkNodes: NodeInfo[];
}) {
  const networkNodeMap = useMemo(
    () => new Map(networkNodes.map((node) => [node.id, node])),
    [networkNodes],
  );
  const regulatorRows = useMemo(() => {
    const stats = new Map<string, { targets: Set<string>; confidence: number; support: number }>();
    activeEdges.forEach((edge) => {
      const item = stats.get(edge.source) ?? {
        targets: new Set<string>(),
        confidence: 0,
        support: 0,
      };
      item.targets.add(edge.target);
      item.confidence += edge.confidence;
      item.support += edge.count;
      stats.set(edge.source, item);
    });
    return [...stats.entries()]
      .map(([gene, item]) => ({
        gene,
        targets: item.targets.size,
        confidence: item.confidence / Math.max(1, item.targets.size),
        support: item.support / Math.max(1, item.targets.size),
        isTF: networkNodeMap.get(gene)?.isTF ?? false,
      }))
      .sort((a, b) => b.targets - a.targets || b.confidence - a.confidence)
      .slice(0, 20);
  }, [activeEdges, networkNodeMap]);

  const geneOptions = useMemo(
    () => networkNodes.map((node) => node.id).sort((a, b) => a.localeCompare(b)),
    [networkNodes],
  );
  const [requestedGene, setRequestedGene] = useState("");
  const selectedGene = geneOptions.includes(requestedGene)
    ? requestedGene
    : (regulatorRows[0]?.gene ?? geneOptions[0] ?? "");

  const geneEdges = useMemo(() => {
    const outgoing = activeEdges
      .filter((edge) => edge.source === selectedGene)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 12);
    const incoming = activeEdges
      .filter((edge) => edge.target === selectedGene)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 12);
    return { outgoing, incoming };
  }, [activeEdges, selectedGene]);

  if (!activeEdges.length) {
    return <EmptyState title="No displayed edges" detail="Relax the result filters or select a completed algorithm to compare regulators." />;
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Regulator ranking"
        description="Regulators ranked by the number of currently displayed target genes."
        aside={<span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-[#087ead]">Current result filters</span>}
      >
        <HorizontalBars
          rows={regulatorRows.map((row) => ({
            label: row.gene,
            value: row.targets,
            note: `${row.isTF ? "Known TF" : "Regulator"} · ${formatNumber(row.confidence, 3)} mean confidence`,
          }))}
          valueLabel={(value) => `${value} targets`}
        />
      </Panel>

      <Panel
        title="Gene-focused regulation"
        description="Inspect the strongest displayed inputs and outputs for one gene."
        aside={
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            Gene
            <select
              value={selectedGene}
              onChange={(event) => setRequestedGene(event.target.value)}
              className="min-w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-[#087ead]"
            >
              {geneOptions.map((gene) => <option key={gene}>{gene}</option>)}
            </select>
          </label>
        }
      >
        <div className="grid gap-5 lg:grid-cols-2">
          {[
            { title: "Regulates", edges: geneEdges.outgoing, getGene: (edge: AggregatedEdge) => edge.target },
            { title: "Regulated by", edges: geneEdges.incoming, getGene: (edge: AggregatedEdge) => edge.source },
          ].map((group) => (
            <div key={group.title} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-slate-900">{group.title}</h4>
                <span className="text-xs font-semibold text-slate-500">{group.edges.length} shown</span>
              </div>
              <div className="mt-3 divide-y divide-slate-100">
                {group.edges.length ? group.edges.map((edge) => (
                  <div key={edge.key} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-bold text-slate-800">{group.getGene(edge)}</span>
                    <span className="text-xs font-semibold tabular-nums text-slate-500">
                      {formatNumber(edge.confidence, 3)} · {edge.count} method{edge.count === 1 ? "" : "s"}
                    </span>
                  </div>
                )) : (
                  <p className="py-6 text-center text-sm text-slate-500">No displayed edges.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function AgreementView({
  algorithmResults,
  activeAlgorithmIds,
}: {
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
}) {
  const edgeSets = useMemo(() => {
    const result = new Map<string, Set<string>>();
    activeAlgorithmIds.forEach((algorithmId) => {
      result.set(
        algorithmId,
        new Set(resultEdges(algorithmResults[algorithmId]).map((edge) => edgeKey(edge.source, edge.target))),
      );
    });
    return result;
  }, [activeAlgorithmIds, algorithmResults]);

  const histogram = useMemo(() => {
    const support = new Map<string, number>();
    edgeSets.forEach((set) => set.forEach((key) => support.set(key, (support.get(key) ?? 0) + 1)));
    return activeAlgorithmIds.map((_, index) => {
      const count = index + 1;
      return { label: `${count} method${count === 1 ? "" : "s"}`, value: [...support.values()].filter((value) => value === count).length };
    });
  }, [activeAlgorithmIds, edgeSets]);

  if (activeAlgorithmIds.length < 2) {
    return <EmptyState title="Select at least two algorithms" detail="Agreement compares ranked edge sets from multiple completed methods." />;
  }

  const jaccard = (first: string, second: string) => {
    const a = edgeSets.get(first) ?? new Set<string>();
    const b = edgeSets.get(second) ?? new Set<string>();
    const intersection = [...a].filter((key) => b.has(key)).length;
    const union = new Set([...a, ...b]).size;
    return union ? intersection / union : 0;
  };

  return (
    <div className="space-y-6">
      <Panel title="Algorithm agreement" description="Pairwise Jaccard similarity between the saved ranked edge sets.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-separate border-spacing-1.5">
            <thead>
              <tr>
                <th />
                {activeAlgorithmIds.map((algorithmId) => (
                  <th key={algorithmId} className="pb-2 text-center text-xs font-bold text-slate-500">{algorithmId}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeAlgorithmIds.map((rowId) => (
                <tr key={rowId}>
                  <th className="pr-3 text-left text-xs font-bold text-slate-600">{rowId}</th>
                  {activeAlgorithmIds.map((columnId) => {
                    const value = jaccard(rowId, columnId);
                    return (
                      <td
                        key={columnId}
                        className="h-14 min-w-14 rounded-xl text-center text-xs font-extrabold"
                        style={{
                          backgroundColor: `rgba(8, 126, 173, ${0.08 + value * 0.85})`,
                          color: value > 0.55 ? "white" : "#334155",
                        }}
                        title={`${rowId} vs ${columnId}: ${value.toFixed(3)}`}
                      >
                        {value.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Edge support" description="How many algorithms recover each unique directed edge.">
        <HorizontalBars rows={histogram} valueLabel={(value) => `${value.toLocaleString()} edges`} />
      </Panel>
    </div>
  );
}

function LineChart({
  series,
  xLabel,
  yLabel,
}: {
  series: Array<{ name: string; points: Array<{ x: number; y: number }> }>;
  xLabel: string;
  yLabel: string;
}) {
  const width = 760;
  const height = 320;
  const left = 58;
  const right = 20;
  const top = 18;
  const bottom = 46;
  const points = series.flatMap((item) => item.points);
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xMin = Math.min(...xValues, 0);
  const xMax = Math.max(...xValues, 1);
  const yMin = Math.min(...yValues, 0);
  const yMax = Math.max(...yValues, 1);
  const xPosition = (value: number) => left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (width - left - right);
  const yPosition = (value: number) => top + (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) * (height - top - bottom);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = top + tick * (height - top - bottom);
          return <line key={tick} x1={left} x2={width - right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
        })}
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="#94a3b8" />
        <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="#94a3b8" />
        {series.map((item, index) => {
          const color = PALETTE[index % PALETTE.length];
          const path = item.points
            .map((point, pointIndex) => `${pointIndex ? "L" : "M"} ${xPosition(point.x)} ${yPosition(point.y)}`)
            .join(" ");
          return <path key={item.name} d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />;
        })}
        <text x={(left + width - right) / 2} y={height - 8} textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="600">{xLabel}</text>
        <text x="14" y={(top + height - bottom) / 2} textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="600" transform={`rotate(-90 14 ${(top + height - bottom) / 2})`}>{yLabel}</text>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {series.map((item, index) => (
          <span key={item.name} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrajectoryView({
  context,
  loading,
}: {
  context: VisualizationContext | null;
  loading: boolean;
}) {
  const lineages = useMemo(
    () => context?.trajectory?.lineages ?? [],
    [context?.trajectory?.lineages],
  );
  const [requestedLineageName, setRequestedLineageName] = useState("");
  const lineage =
    lineages.find((item) => item.name === requestedLineageName) ?? lineages[0];
  const genes = (context?.trajectory?.genes ?? []).slice(0, 8);

  if (loading) return <EmptyState title="Preparing trajectory" detail="Reading the project pseudotime and expression matrix." />;
  if (!context?.trajectory?.available || !lineage) {
    return <EmptyState title="Trajectory is unavailable" detail={context?.trajectory?.reason ?? "This project does not include usable pseudotime."} />;
  }

  const series = genes.map((gene) => ({
    name: gene,
    points: lineage.bins.map((bin) => ({
      x: bin.pseudotime,
      y: Number(bin.scaled_expression[gene] ?? 0),
    })),
  }));

  return (
    <Panel
      title="Expression over pseudotime"
      description="Binned mean expression, scaled independently for each displayed gene."
      aside={lineages.length > 1 ? (
        <select
          value={lineage?.name}
          onChange={(event) => setRequestedLineageName(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
        >
          {lineages.map((item) => <option key={item.name}>{item.name}</option>)}
        </select>
      ) : <span className="text-xs font-semibold text-slate-500">{lineage.cell_count.toLocaleString()} cells</span>}
    >
      <LineChart series={series} xLabel="Pseudotime" yLabel="Scaled expression" />
    </Panel>
  );
}

type CurvePoint = { x: number; y: number };
type BenchmarkRow = {
  algorithmId: string;
  auprc: number;
  auroc: number;
  precisionAtK: number;
  earlyPrecisionRatio: number;
  pr: CurvePoint[];
  roc: CurvePoint[];
};

function benchmarkAlgorithm(
  algorithmId: string,
  edges: AlgorithmResultEdge[],
  truth: Set<string>,
  possibleEdges: number,
): BenchmarkRow {
  const ranked = [...edges].sort((a, b) => edgeScore(b) - edgeScore(a));
  const positiveCount = Math.max(1, truth.size);
  const negativeCount = Math.max(1, possibleEdges - truth.size);
  let truePositive = 0;
  let falsePositive = 0;
  let auprc = 0;
  let auroc = 0;
  let previousRecall = 0;
  let previousFpr = 0;
  let previousTpr = 0;
  const pr: CurvePoint[] = [{ x: 0, y: 1 }];
  const roc: CurvePoint[] = [{ x: 0, y: 0 }];
  let trueAtK = 0;
  const k = Math.min(truth.size, ranked.length);

  ranked.forEach((edge, index) => {
    if (truth.has(edgeKey(edge.source, edge.target))) {
      truePositive += 1;
      if (index < k) trueAtK += 1;
    } else {
      falsePositive += 1;
    }
    const recall = truePositive / positiveCount;
    const precision = truePositive / (index + 1);
    const falsePositiveRate = falsePositive / negativeCount;
    const truePositiveRate = recall;
    auprc += (recall - previousRecall) * precision;
    auroc += (falsePositiveRate - previousFpr) * ((previousTpr + truePositiveRate) / 2);
    previousRecall = recall;
    previousFpr = falsePositiveRate;
    previousTpr = truePositiveRate;
    if (index === ranked.length - 1 || index % Math.max(1, Math.floor(ranked.length / 180)) === 0) {
      pr.push({ x: recall, y: precision });
      roc.push({ x: falsePositiveRate, y: truePositiveRate });
    }
  });
  const precisionAtK = k ? trueAtK / k : 0;
  const baseRate = truth.size / Math.max(1, possibleEdges);
  return {
    algorithmId,
    auprc,
    auroc,
    precisionAtK,
    earlyPrecisionRatio: baseRate ? precisionAtK / baseRate : 0,
    pr,
    roc,
  };
}

function BenchmarkView({
  context,
  loading,
  algorithmResults,
  activeAlgorithmIds,
}: {
  context: VisualizationContext | null;
  loading: boolean;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
}) {
  const rows = useMemo(() => {
    const truthEdges = context?.ground_truth?.edges ?? [];
    if (!truthEdges.length) return [];
    const truth = new Set(truthEdges.map((edge) => edgeKey(edge.source, edge.target)));
    const genes = new Set<string>();
    truthEdges.forEach((edge) => { genes.add(edge.source); genes.add(edge.target); });
    activeAlgorithmIds.forEach((algorithmId) => {
      resultEdges(algorithmResults[algorithmId]).forEach((edge) => {
        genes.add(edge.source);
        genes.add(edge.target);
      });
    });
    const possibleEdges = Math.max(1, genes.size * Math.max(1, genes.size - 1));
    return activeAlgorithmIds.map((algorithmId) =>
      benchmarkAlgorithm(algorithmId, resultEdges(algorithmResults[algorithmId]), truth, possibleEdges),
    );
  }, [activeAlgorithmIds, algorithmResults, context]);

  if (loading) return <EmptyState title="Preparing benchmark" detail="Reading the project reference network." />;
  if (!context?.ground_truth?.available) {
    return <EmptyState title="Reference network required" detail={context?.ground_truth?.reason ?? "Add a ground-truth network to evaluate predictions."} />;
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Precision–recall benchmark"
        description="Precision–recall is the primary view for sparse regulatory networks."
        aside={<span className="text-xs font-semibold text-slate-500">{context.ground_truth.edge_count?.toLocaleString()} reference edges</span>}
      >
        <LineChart
          series={rows.map((row) => ({ name: row.algorithmId, points: row.pr }))}
          xLabel="Recall"
          yLabel="Precision"
        />
      </Panel>
      <Panel title="Benchmark metrics" description="Early precision complements the full ranking; ROC is included as a secondary metric.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.14em] text-slate-500">
                <th className="pb-3">Algorithm</th>
                <th className="pb-3 text-right">AUPRC</th>
                <th className="pb-3 text-right">Precision@K</th>
                <th className="pb-3 text-right">Early precision ratio</th>
                <th className="pb-3 text-right">AUROC</th>
              </tr>
            </thead>
            <tbody>
              {rows.sort((a, b) => b.auprc - a.auprc).map((row) => (
                <tr key={row.algorithmId} className="border-b border-slate-100 text-sm">
                  <td className="py-3 font-extrabold text-slate-900">{row.algorithmId}</td>
                  <td className="py-3 text-right font-bold tabular-nums text-[#087ead]">{row.auprc.toFixed(3)}</td>
                  <td className="py-3 text-right tabular-nums text-slate-700">{row.precisionAtK.toFixed(3)}</td>
                  <td className="py-3 text-right tabular-nums text-slate-700">{row.earlyPrecisionRatio.toFixed(2)}×</td>
                  <td className="py-3 text-right tabular-nums text-slate-700">{row.auroc.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="ROC curves" description="A secondary view; sparse networks can make ROC performance look optimistic.">
        <LineChart
          series={rows.map((row) => ({ name: row.algorithmId, points: row.roc }))}
          xLabel="False-positive rate"
          yLabel="True-positive rate"
        />
      </Panel>
    </div>
  );
}

function DiagnosticsView({
  activeEdges,
  algorithmResults,
  activeAlgorithmIds,
  tasks,
}: {
  activeEdges: AggregatedEdge[];
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  tasks: ProjectTask[];
}) {
  const motifRows = useMemo(() => {
    const edges = activeEdges.slice(0, 2000);
    const adjacency = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    edges.forEach((edge) => {
      const outgoing = adjacency.get(edge.source) ?? new Set<string>();
      outgoing.add(edge.target);
      adjacency.set(edge.source, outgoing);
      const incoming = reverse.get(edge.target) ?? new Set<string>();
      incoming.add(edge.source);
      reverse.set(edge.target, incoming);
    });
    let reciprocal = 0;
    let feedForward = 0;
    edges.forEach((edge) => {
      if (adjacency.get(edge.target)?.has(edge.source)) reciprocal += 1;
      adjacency.get(edge.source)?.forEach((third) => {
        if (third !== edge.target && adjacency.get(edge.target)?.has(third)) feedForward += 1;
      });
    });
    return [
      { label: "Feed-forward loops", value: feedForward, note: "A→B, A→C, B→C" },
      { label: "Reciprocal pairs", value: Math.floor(reciprocal / 2), note: "A↔B" },
      { label: "Fan-out hubs", value: [...adjacency.values()].filter((targets) => targets.size >= 3).length, note: "At least 3 targets" },
      { label: "Fan-in hubs", value: [...reverse.values()].filter((sources) => sources.size >= 3).length, note: "At least 3 regulators" },
    ];
  }, [activeEdges]);

  const runtimeRows = useMemo(() => activeAlgorithmIds.map((algorithmId) => {
    const task = tasks.find((item) => item.algorithm_id.toUpperCase() === algorithmId.toUpperCase());
    const seconds = Number(algorithmResults[algorithmId]?.elapsed_seconds ?? task?.elapsed_seconds ?? 0);
    return {
      label: algorithmId,
      value: Number.isFinite(seconds) ? seconds : 0,
      note: `${resultEdges(algorithmResults[algorithmId]).length.toLocaleString()} ranked edges loaded`,
    };
  }).sort((a, b) => b.value - a.value), [activeAlgorithmIds, algorithmResults, tasks]);

  return (
    <div className="space-y-6">
      <Panel title="Network motif profile" description="Structural patterns in the currently displayed directed network.">
        {activeEdges.length ? (
          <HorizontalBars rows={motifRows} valueLabel={(value) => value.toLocaleString()} />
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">No displayed edges to profile.</p>
        )}
        {activeEdges.length > 2000 ? (
          <p className="mt-4 text-xs text-slate-500">Computed from the strongest 2,000 displayed edges for responsiveness.</p>
        ) : null}
      </Panel>
      <Panel title="Runtime comparison" description="Recorded wall-clock time for the selected completed algorithms.">
        <HorizontalBars
          rows={runtimeRows}
          valueLabel={(value) => value >= 60 ? `${formatNumber(value / 60, 1)} min` : `${formatNumber(value, 1)} s`}
        />
      </Panel>
    </div>
  );
}

export default function ResultsInsightsSection({
  view,
  activeEdges,
  algorithmResults,
  activeAlgorithmIds,
  tasks,
  networkNodes,
  visualizationContext,
  isContextLoading,
}: ResultsInsightsSectionProps) {
  if (view === "regulators") {
    return <RegulatorView activeEdges={activeEdges} networkNodes={networkNodes} />;
  }
  if (view === "agreement") {
    return <AgreementView algorithmResults={algorithmResults} activeAlgorithmIds={activeAlgorithmIds} />;
  }
  if (view === "trajectory") {
    return <TrajectoryView context={visualizationContext} loading={isContextLoading} />;
  }
  if (view === "benchmark") {
    return (
      <BenchmarkView
        context={visualizationContext}
        loading={isContextLoading}
        algorithmResults={algorithmResults}
        activeAlgorithmIds={activeAlgorithmIds}
      />
    );
  }
  return (
    <DiagnosticsView
      activeEdges={activeEdges}
      algorithmResults={algorithmResults}
      activeAlgorithmIds={activeAlgorithmIds}
      tasks={tasks}
    />
  );
}
