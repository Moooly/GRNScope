"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  AggregatedEdge,
  AlgorithmCatalogItem,
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
  networkEdges: AggregatedEdge[];
  analysisEdges: AggregatedEdge[];
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  tasks: ProjectTask[];
  networkNodes: NodeInfo[];
  visualizationContext: VisualizationContext | null;
  isContextLoading: boolean;
  onSelectGene?: (gene: string) => void;
};

const PALETTE = [
  "#087ead",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#059669",
  "#475569",
  "#ca8a04",
  "#0891b2",
];

function edgeKey(source: string, target: string) {
  return `${source}\u0000${target}`;
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds >= 60) return `${formatNumber(seconds / 60, 1)} min`;
  return `${formatNumber(seconds, 1)} s`;
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralForm}`;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center">
      <p className="text-base font-bold text-slate-950">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        {detail}
      </p>
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
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold text-slate-950">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-[#087ead] focus:ring-2 focus:ring-[#087ead]/10"
      >
        {children}
      </select>
    </label>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
              value === option.value
                ? "bg-white text-[#087ead] shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExportButton({
  label = "Export CSV",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-[#087ead]/40 hover:text-[#087ead]"
    >
      {label}
    </button>
  );
}

function HorizontalBars({
  rows,
  valueLabel,
  color = "#087ead",
}: {
  rows: Array<{ label: string; value: number; note?: string }>;
  valueLabel?: (value: number) => string;
  color?: string;
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.value));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">{row.label}</p>
            {row.note ? (
              <p className="truncate text-[11px] text-slate-500">{row.note}</p>
            ) : null}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            {row.value > 0 && maximum > 0 ? (
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: color,
                  width: `${(row.value / maximum) * 100}%`,
                }}
              />
            ) : null}
          </div>
          <span className="min-w-14 text-right text-sm font-bold tabular-nums text-slate-700">
            {valueLabel ? valueLabel(row.value) : formatNumber(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

type RegulatorSort = "targets" | "evidence" | "support";
type EdgeSource = "all" | "network";

function signLabel(sign: AggregatedEdge["sign"]) {
  if (sign > 0) return "Activation";
  if (sign < 0) return "Repression";
  return "Unknown sign";
}

function signTone(sign: AggregatedEdge["sign"]) {
  if (sign > 0) return "border-sky-200 bg-sky-50 text-sky-700";
  if (sign < 0) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function GeneEdgeCard({
  edge,
  gene,
  direction,
}: {
  edge: AggregatedEdge;
  gene: string;
  direction: "incoming" | "outgoing";
}) {
  const otherGene = direction === "incoming" ? edge.source : edge.target;
  const scores = Object.entries(edge.perAlgorithmScores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <details className={`rounded-xl border p-3 ${signTone(edge.sign)}`}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-extrabold">
            {direction === "incoming" ? `${otherGene} → ${gene}` : `${gene} → ${otherGene}`}
          </span>
          <span className="text-xs font-bold tabular-nums">
            {edge.confidence.toFixed(3)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold opacity-80">
          <span>{signLabel(edge.sign)}</span>
          <span>{plural(edge.count, "method")}</span>
          <span>{Math.round(edge.directionCoverage * 100)}% direction coverage</span>
        </div>
      </summary>
      <div className="mt-3 border-t border-current/15 pt-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">
          Per-method evidence
        </p>
        <div className="mt-1.5 space-y-1">
          {scores.length ? (
            scores.map(([algorithmId, score]) => (
              <div
                key={algorithmId}
                className="flex items-center justify-between text-xs font-semibold"
              >
                <span>{algorithmId}</span>
                <span className="tabular-nums">{score.toFixed(3)}</span>
              </div>
            ))
          ) : (
            <p className="text-xs opacity-70">No method-level scores recorded.</p>
          )}
        </div>
      </div>
    </details>
  );
}

function RegulatorView({
  analysisEdges,
  networkEdges,
  networkNodes,
  onSelectGene,
}: {
  analysisEdges: AggregatedEdge[];
  networkEdges: AggregatedEdge[];
  networkNodes: NodeInfo[];
  onSelectGene?: (gene: string) => void;
}) {
  const [edgeSource, setEdgeSource] = useState<EdgeSource>("all");
  const [sortBy, setSortBy] = useState<RegulatorSort>("targets");
  const [topN, setTopN] = useState(20);
  const selectedEdges = edgeSource === "all" ? analysisEdges : networkEdges;
  const networkNodeMap = useMemo(
    () => new Map(networkNodes.map((node) => [node.id, node])),
    [networkNodes],
  );
  const regulatorRows = useMemo(() => {
    const stats = new Map<
      string,
      {
        targets: Set<string>;
        confidences: number[];
        supports: number[];
        activation: number;
        repression: number;
        unknown: number;
      }
    >();
    selectedEdges.forEach((edge) => {
      const item = stats.get(edge.source) ?? {
        targets: new Set<string>(),
        confidences: [],
        supports: [],
        activation: 0,
        repression: 0,
        unknown: 0,
      };
      item.targets.add(edge.target);
      item.confidences.push(edge.confidence);
      item.supports.push(edge.count);
      if (edge.sign > 0) item.activation += 1;
      else if (edge.sign < 0) item.repression += 1;
      else item.unknown += 1;
      stats.set(edge.source, item);
    });
    return [...stats.entries()]
      .map(([gene, item]) => ({
        gene,
        targets: item.targets.size,
        evidence:
          item.confidences.reduce((sum, value) => sum + value, 0) /
          Math.max(1, item.confidences.length),
        support: median(item.supports),
        activation: item.activation,
        repression: item.repression,
        unknown: item.unknown,
        isTF: networkNodeMap.get(gene)?.isTF ?? false,
      }))
      .sort((a, b) => {
        if (sortBy === "evidence") {
          return b.evidence - a.evidence || b.targets - a.targets;
        }
        if (sortBy === "support") {
          return b.support - a.support || b.targets - a.targets;
        }
        return b.targets - a.targets || b.evidence - a.evidence;
      });
  }, [networkNodeMap, selectedEdges, sortBy]);

  const genes = useMemo(() => {
    const values = new Set<string>();
    selectedEdges.forEach((edge) => {
      values.add(edge.source);
      values.add(edge.target);
    });
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [selectedEdges]);
  const [requestedGene, setRequestedGene] = useState("");
  const selectedGene = genes.includes(requestedGene)
    ? requestedGene
    : (regulatorRows[0]?.gene ?? genes[0] ?? "");
  const visibleRows = regulatorRows.slice(0, topN);
  const maxTargets = Math.max(1, ...visibleRows.map((row) => row.targets));

  const geneEdges = useMemo(() => {
    const outgoing = selectedEdges
      .filter((edge) => edge.source === selectedGene)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    const incoming = selectedEdges
      .filter((edge) => edge.target === selectedGene)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    return { outgoing, incoming };
  }, [selectedEdges, selectedGene]);

  const selectGene = (gene: string) => {
    setRequestedGene(gene);
    onSelectGene?.(gene);
  };

  if (!analysisEdges.length && !networkEdges.length) {
    return (
      <EmptyState
        title="No inferred edges"
        detail="Select a completed algorithm to rank regulators."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Regulator ranking"
        description="Compare regulatory reach, evidence, support, and predicted sign without inheriting hidden Network display thresholds."
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SegmentedControl
              label="Edge universe"
              value={edgeSource}
              onChange={setEdgeSource}
              options={[
                { value: "all", label: "All inferred edges" },
                { value: "network", label: "Displayed network" },
              ]}
            />
            <SelectControl
              label="Sort"
              value={sortBy}
              onChange={(value) => setSortBy(value as RegulatorSort)}
            >
              <option value="targets">Target count</option>
              <option value="evidence">Mean evidence</option>
              <option value="support">Median support</option>
            </SelectControl>
            <SelectControl
              label="Show"
              value={topN}
              onChange={(value) => setTopN(Number(value))}
            >
              {[10, 20, 50, 100].map((value) => (
                <option key={value} value={value}>
                  Top {value}
                </option>
              ))}
            </SelectControl>
            <ExportButton
              onClick={() =>
                downloadCsv("regulator-ranking.csv", [
                  [
                    "rank",
                    "gene",
                    "targets",
                    "mean_evidence",
                    "median_support",
                    "activation",
                    "repression",
                    "unknown_sign",
                  ],
                  ...visibleRows.map((row, index) => [
                    index + 1,
                    row.gene,
                    row.targets,
                    row.evidence.toFixed(3),
                    row.support.toFixed(3),
                    row.activation,
                    row.repression,
                    row.unknown,
                  ]),
                ])
              }
            />
          </div>
        }
      >
        {selectedEdges.length ? (
          <div>
            <div className="hidden grid-cols-[3rem_minmax(8rem,12rem)_1fr_7rem_8rem_11rem] gap-3 border-b border-slate-200 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 md:grid">
              <span>Rank</span>
              <span>Regulator</span>
              <span>Targets</span>
              <span className="text-right">Evidence</span>
              <span className="text-right">Median support</span>
              <span className="text-right">Sign profile</span>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleRows.map((row, index) => (
                <button
                  key={row.gene}
                  type="button"
                  onClick={() => selectGene(row.gene)}
                  className={`grid w-full items-center gap-3 py-3 text-left transition md:grid-cols-[3rem_minmax(8rem,12rem)_1fr_7rem_8rem_11rem] ${
                    selectedGene === row.gene
                      ? "bg-sky-50/70"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-bold tabular-nums text-slate-400">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-slate-900">
                      {row.gene}
                    </span>
                    {row.isTF ? (
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#087ead]">
                        Known TF
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-[#087ead]"
                        style={{ width: `${(row.targets / maxTargets) * 100}%` }}
                      />
                    </span>
                    <span className="min-w-16 text-right text-sm font-bold tabular-nums text-slate-700">
                      {plural(row.targets, "target")}
                    </span>
                  </span>
                  <span className="text-right text-sm font-bold tabular-nums text-slate-700">
                    {row.evidence.toFixed(3)}
                  </span>
                  <span className="text-right text-sm font-bold tabular-nums text-slate-700">
                    {row.support.toFixed(1)}
                  </span>
                  <span className="flex justify-end gap-1" title="Activation / repression / unknown">
                    <span className="rounded-md bg-sky-100 px-1.5 py-1 text-[10px] font-bold text-sky-700">
                      +{row.activation}
                    </span>
                    <span className="rounded-md bg-orange-100 px-1.5 py-1 text-[10px] font-bold text-orange-700">
                      −{row.repression}
                    </span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-1 text-[10px] font-bold text-slate-600">
                      ?{row.unknown}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            title="The displayed Network has no edges"
            detail="Choose “All inferred edges” here or relax the Network tab’s result settings."
          />
        )}
      </Panel>

      {selectedEdges.length ? (
        <Panel
          title="Gene-focused regulation"
          description="Select a gene to inspect incoming and outgoing predictions. Open any edge for per-method evidence."
          aside={
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Gene
              <input
                list="regulator-gene-options"
                value={requestedGene || selectedGene}
                onChange={(event) => {
                  const gene = event.target.value;
                  setRequestedGene(gene);
                  if (genes.includes(gene)) onSelectGene?.(gene);
                }}
                onBlur={() => {
                  if (!genes.includes(requestedGene)) {
                    setRequestedGene(selectedGene);
                  }
                }}
                placeholder="Search genes"
                className="min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-[#087ead]"
              />
              <datalist id="regulator-gene-options">
                {genes.map((gene) => (
                  <option key={gene} value={gene} />
                ))}
              </datalist>
            </label>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_11rem_1fr] lg:items-start">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">
                  Incoming regulation
                </h4>
                <span className="text-xs text-slate-400">
                  {geneEdges.incoming.length} shown
                </span>
              </div>
              <div className="space-y-2">
                {geneEdges.incoming.length ? (
                  geneEdges.incoming.map((edge) => (
                    <GeneEdgeCard
                      key={edge.key}
                      edge={edge}
                      gene={selectedGene}
                      direction="incoming"
                    />
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
                    No incoming edges.
                  </p>
                )}
              </div>
            </div>
            <div className="flex min-h-28 items-center justify-center lg:pt-8">
              <div className="relative w-full rounded-2xl border-2 border-[#087ead]/25 bg-sky-50 px-4 py-5 text-center">
                <span className="absolute -left-3 top-1/2 hidden -translate-y-1/2 text-xl text-slate-300 lg:block">
                  →
                </span>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#087ead]">
                  Selected gene
                </p>
                <p className="mt-1 truncate text-base font-extrabold text-slate-950">
                  {selectedGene}
                </p>
                <span className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-xl text-slate-300 lg:block">
                  →
                </span>
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">
                  Outgoing regulation
                </h4>
                <span className="text-xs text-slate-400">
                  {geneEdges.outgoing.length} shown
                </span>
              </div>
              <div className="space-y-2">
                {geneEdges.outgoing.length ? (
                  geneEdges.outgoing.map((edge) => (
                    <GeneEdgeCard
                      key={edge.key}
                      edge={edge}
                      gene={selectedGene}
                      direction="outgoing"
                    />
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
                    No outgoing edges.
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              Activation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
              Repression
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
              Unknown sign
            </span>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

type ComparisonMode = "topology" | "direction" | "sign";
type AgreementMetric = "jaccard" | "rbo" | "spearman";
type SupportMode = "exact" | "at-least";

function comparisonKey(edge: AggregatedEdge, mode: ComparisonMode) {
  if (mode === "topology") {
    return [edge.source, edge.target].sort().join(" — ");
  }
  if (mode === "sign") {
    return `${edge.source} → ${edge.target} | ${
      edge.sign > 0 ? "+" : edge.sign < 0 ? "−" : "?"
    }`;
  }
  return `${edge.source} → ${edge.target}`;
}

function uniqueRankedKeys(
  rows: AggregatedEdge[],
  mode: ComparisonMode,
  topK: number,
) {
  const seen = new Set<string>();
  const keys: string[] = [];
  [...rows]
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
    .some((edge) => {
      const key = comparisonKey(edge, mode);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
      return keys.length >= topK;
    });
  return keys;
}

function jaccardSimilarity(a: string[], b: string[]) {
  const first = new Set(a);
  const second = new Set(b);
  const intersection = [...first].filter((key) => second.has(key)).length;
  const union = new Set([...first, ...second]).size;
  return union ? intersection / union : 0;
}

function rankBiasedOverlap(a: string[], b: string[], persistence = 0.9) {
  const depth = Math.max(a.length, b.length);
  if (!depth) return 0;
  const first = new Set<string>();
  const second = new Set<string>();
  let weighted = 0;
  let overlapAtDepth = 0;
  for (let index = 0; index < depth; index += 1) {
    if (a[index]) first.add(a[index]);
    if (b[index]) second.add(b[index]);
    overlapAtDepth = [...first].filter((key) => second.has(key)).length;
    weighted +=
      (1 - persistence) *
      (overlapAtDepth / (index + 1)) *
      persistence ** index;
  }
  return weighted + (overlapAtDepth / depth) * persistence ** depth;
}

function spearmanSimilarity(a: string[], b: string[]) {
  const union = [...new Set([...a, ...b])];
  if (union.length < 2) return union.length ? 1 : 0;
  const firstRanks = new Map(a.map((key, index) => [key, index + 1]));
  const secondRanks = new Map(b.map((key, index) => [key, index + 1]));
  const missingRank = Math.max(a.length, b.length) + 1;
  const x = union.map((key) => firstRanks.get(key) ?? missingRank);
  const y = union.map((key) => secondRanks.get(key) ?? missingRank);
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const numerator = x.reduce(
    (sum, value, index) => sum + (value - meanX) * (y[index] - meanY),
    0,
  );
  const denominator = Math.sqrt(
    x.reduce((sum, value) => sum + (value - meanX) ** 2, 0) *
      y.reduce((sum, value) => sum + (value - meanY) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
}

function AgreementView({
  algorithmEdgeRows,
  algorithmMetaMap,
  activeAlgorithmIds,
}: {
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  activeAlgorithmIds: string[];
}) {
  const [topK, setTopK] = useState(100);
  const [metric, setMetric] = useState<AgreementMetric>("jaccard");
  const [mode, setMode] = useState<ComparisonMode>("topology");
  const [supportMode, setSupportMode] = useState<SupportMode>("exact");
  const [selectedSupport, setSelectedSupport] = useState<number | null>(null);
  const [requestedPair, setRequestedPair] = useState<[string, string] | null>(null);

  const eligibleAlgorithmIds = useMemo(
    () =>
      activeAlgorithmIds.filter((algorithmId) => {
        const metadata = algorithmMetaMap.get(algorithmId);
        if (mode === "direction") return metadata?.directed ?? true;
        if (mode === "sign") return metadata?.signed ?? false;
        return true;
      }),
    [activeAlgorithmIds, algorithmMetaMap, mode],
  );
  const omittedAlgorithmIds = activeAlgorithmIds.filter(
    (algorithmId) => !eligibleAlgorithmIds.includes(algorithmId),
  );
  const rankedKeys = useMemo(() => {
    const values = new Map<string, string[]>();
    eligibleAlgorithmIds.forEach((algorithmId) => {
      values.set(
        algorithmId,
        uniqueRankedKeys(algorithmEdgeRows[algorithmId] ?? [], mode, topK),
      );
    });
    return values;
  }, [algorithmEdgeRows, eligibleAlgorithmIds, mode, topK]);

  const similarity = (firstId: string, secondId: string) => {
    const first = rankedKeys.get(firstId) ?? [];
    const second = rankedKeys.get(secondId) ?? [];
    if (metric === "rbo") return rankBiasedOverlap(first, second);
    if (metric === "spearman") return spearmanSimilarity(first, second);
    return jaccardSimilarity(first, second);
  };

  const selectedPair = useMemo(
    () =>
      requestedPair &&
      eligibleAlgorithmIds.includes(requestedPair[0]) &&
      eligibleAlgorithmIds.includes(requestedPair[1])
        ? requestedPair
        : eligibleAlgorithmIds.length >= 2
          ? ([
              eligibleAlgorithmIds[0],
              eligibleAlgorithmIds[1],
            ] as [string, string])
          : null,
    [eligibleAlgorithmIds, requestedPair],
  );

  const pairDetails = useMemo(() => {
    if (!selectedPair) return null;
    const [firstId, secondId] = selectedPair;
    const first = rankedKeys.get(firstId) ?? [];
    const second = rankedKeys.get(secondId) ?? [];
    const firstSet = new Set(first);
    const secondSet = new Set(second);
    return {
      firstId,
      secondId,
      shared: first.filter((key) => secondSet.has(key)),
      firstOnly: first.filter((key) => !secondSet.has(key)),
      secondOnly: second.filter((key) => !firstSet.has(key)),
    };
  }, [rankedKeys, selectedPair]);

  const support = useMemo(() => {
    const counts = new Map<string, number>();
    rankedKeys.forEach((keys) =>
      new Set(keys).forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1)),
    );
    return counts;
  }, [rankedKeys]);
  const supportRows = eligibleAlgorithmIds.map((_, index) => {
    const level = index + 1;
    const edgeCount = [...support.values()].filter((value) =>
      supportMode === "exact" ? value === level : value >= level,
    ).length;
    return { level, edgeCount };
  });
  const supportEdges =
    selectedSupport === null
      ? []
      : [...support.entries()]
          .filter(([, value]) =>
            supportMode === "exact"
              ? value === selectedSupport
              : value >= selectedSupport,
          )
          .sort((a, b) => b[1] - a[1]);
  const maxSupportCount = Math.max(0, ...supportRows.map((row) => row.edgeCount));

  if (activeAlgorithmIds.length < 2) {
    return (
      <EmptyState
        title="Select at least two algorithms"
        detail="Agreement compares equally sized ranked edge sets from multiple completed methods."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Algorithm agreement"
        description="Compare equally sized top-ranked results. The metric and biological interpretation are explicit and independent of Network display filters."
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SelectControl
              label="Top edges"
              value={topK}
              onChange={(value) => setTopK(Number(value))}
            >
              {[50, 100, 250, 500, 1000].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectControl>
            <SelectControl
              label="Metric"
              value={metric}
              onChange={(value) => setMetric(value as AgreementMetric)}
            >
              <option value="jaccard">Jaccard</option>
              <option value="rbo">Rank-biased overlap</option>
              <option value="spearman">Spearman rank</option>
            </SelectControl>
            <SelectControl
              label="Compare"
              value={mode}
              onChange={(value) => setMode(value as ComparisonMode)}
            >
              <option value="topology">Adjacency</option>
              <option value="direction">Direction</option>
              <option value="sign">Direction + sign</option>
            </SelectControl>
          </div>
        }
      >
        {eligibleAlgorithmIds.length >= 2 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] border-separate border-spacing-1.5">
                <thead>
                  <tr>
                    <th />
                    {eligibleAlgorithmIds.map((algorithmId) => (
                      <th
                        key={algorithmId}
                        className="max-w-28 truncate pb-2 text-center text-xs font-bold text-slate-500"
                        title={algorithmId}
                      >
                        {algorithmId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eligibleAlgorithmIds.map((rowId, rowIndex) => (
                    <tr key={rowId}>
                      <th className="max-w-32 truncate pr-3 text-left text-xs font-bold text-slate-600">
                        {rowId}
                      </th>
                      {eligibleAlgorithmIds.map((columnId, columnIndex) => {
                        if (columnIndex > rowIndex) {
                          return (
                            <td
                              key={columnId}
                              className="h-12 min-w-16 rounded-lg bg-slate-50 text-center text-slate-300"
                              aria-hidden="true"
                            >
                              —
                            </td>
                          );
                        }
                        const value =
                          rowId === columnId ? 1 : similarity(rowId, columnId);
                        const normalized =
                          metric === "spearman" ? (value + 1) / 2 : value;
                        return (
                          <td key={columnId}>
                            <button
                              type="button"
                              disabled={rowId === columnId}
                              onClick={() => setRequestedPair([columnId, rowId])}
                              className={`h-12 w-full min-w-16 rounded-lg text-center text-xs font-extrabold transition ${
                                rowId === columnId
                                  ? "cursor-default"
                                  : "ring-offset-2 hover:ring-2 hover:ring-[#087ead]/40"
                              }`}
                              style={{
                                backgroundColor: `rgba(8, 126, 173, ${
                                  0.08 + Math.max(0, normalized) * 0.84
                                })`,
                                color: normalized > 0.55 ? "white" : "#334155",
                              }}
                              title={`${rowId} vs ${columnId}: ${value.toFixed(3)}`}
                            >
                              {value.toFixed(3)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-xs leading-5 text-slate-500">
                {metric === "jaccard"
                  ? "Jaccard = shared edges ÷ unique edges."
                  : metric === "rbo"
                    ? "Rank-biased overlap emphasizes agreement near the top of each ranking (p = 0.9)."
                    : "Spearman compares ranks across the union; missing edges receive the next rank."}
              </p>
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                <span>{metric === "spearman" ? "−1" : "0"}</span>
                <span className="h-2.5 w-28 rounded-full bg-gradient-to-r from-sky-50 via-sky-400 to-[#087ead]" />
                <span>1</span>
              </div>
            </div>
            {omittedAlgorithmIds.length ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Not included in this mode: {omittedAlgorithmIds.join(", ")}.{" "}
                {mode === "sign"
                  ? "These methods do not report edge signs."
                  : "These methods do not report direction."}
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState
            title={`Not enough ${mode === "sign" ? "signed" : "directed"} methods`}
            detail="Choose another comparison mode or select more compatible algorithms."
          />
        )}
      </Panel>

      {pairDetails ? (
        <Panel
          title={`${pairDetails.firstId} vs ${pairDetails.secondId}`}
          description={`Open comparison for the selected top-${topK} ${mode === "topology" ? "adjacencies" : mode === "direction" ? "directed edges" : "signed directed edges"}.`}
          aside={
            <ExportButton
              onClick={() =>
                downloadCsv("algorithm-pair-comparison.csv", [
                  ["group", "edge"],
                  ...pairDetails.shared.map((key) => ["shared", key]),
                  ...pairDetails.firstOnly.map((key) => [
                    `${pairDetails.firstId}_only`,
                    key,
                  ]),
                  ...pairDetails.secondOnly.map((key) => [
                    `${pairDetails.secondId}_only`,
                    key,
                  ]),
                ])
              }
            />
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                label: "Shared",
                values: pairDetails.shared,
                tone: "border-teal-200 bg-teal-50",
              },
              {
                label: `${pairDetails.firstId} only`,
                values: pairDetails.firstOnly,
                tone: "border-sky-200 bg-sky-50",
              },
              {
                label: `${pairDetails.secondId} only`,
                values: pairDetails.secondOnly,
                tone: "border-violet-200 bg-violet-50",
              },
            ].map((group) => (
              <div key={group.label} className={`rounded-xl border p-4 ${group.tone}`}>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-extrabold text-slate-900">
                    {group.label}
                  </h4>
                  <span className="text-xs font-bold tabular-nums text-slate-600">
                    {group.values.length}
                  </span>
                </div>
                <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto">
                  {group.values.length ? (
                    group.values.slice(0, 50).map((key) => (
                      <p
                        key={key}
                        className="truncate text-xs font-semibold text-slate-700"
                        title={key}
                      >
                        {key}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No edges.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Edge support"
        description={`Support is calculated from the same top-${topK} edge universe and comparison interpretation used above.`}
        aside={
          <SegmentedControl
            label="Count"
            value={supportMode}
            onChange={(value) => {
              setSupportMode(value);
              setSelectedSupport(null);
            }}
            options={[
              { value: "exact", label: "Exactly N" },
              { value: "at-least", label: "At least N" },
            ]}
          />
        }
      >
        <div className="space-y-2">
          {supportRows.map((row) => {
            const percentage = support.size
              ? (row.edgeCount / support.size) * 100
              : 0;
            return (
              <button
                key={row.level}
                type="button"
                onClick={() =>
                  setSelectedSupport(
                    selectedSupport === row.level ? null : row.level,
                  )
                }
                className={`grid w-full grid-cols-[7rem_1fr_7.5rem] items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                  selectedSupport === row.level
                    ? "bg-sky-50 ring-1 ring-sky-200"
                    : "hover:bg-slate-50"
                }`}
              >
                <span className="text-sm font-bold text-slate-700">
                  {row.level} {row.level === 1 ? "method" : "methods"}
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  {row.edgeCount > 0 && maxSupportCount > 0 ? (
                    <span
                      className="block h-full rounded-full bg-[#087ead]"
                      style={{
                        width: `${(row.edgeCount / maxSupportCount) * 100}%`,
                      }}
                    />
                  ) : null}
                </span>
                <span className="text-right text-xs font-bold tabular-nums text-slate-700">
                  {row.edgeCount.toLocaleString()}{" "}
                  <span className="font-semibold text-slate-400">
                    ({percentage.toFixed(1)}%)
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {selectedSupport !== null ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-extrabold text-slate-900">
                {supportMode === "exact" ? "Exactly" : "At least"} {selectedSupport}{" "}
                {selectedSupport === 1 ? "method" : "methods"}
              </h4>
              <span className="text-xs font-bold text-slate-500">
                {plural(supportEdges.length, "edge")}
              </span>
            </div>
            <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {supportEdges.length ? (
                supportEdges.map(([key, count]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs"
                  >
                    <span className="truncate font-semibold text-slate-700" title={key}>
                      {key}
                    </span>
                    <span className="font-bold tabular-nums text-[#087ead]">{count}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">No edges at this support level.</p>
              )}
            </div>
          </div>
        ) : null}
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
  const xPosition = (value: number) =>
    left +
    ((value - xMin) / Math.max(1e-9, xMax - xMin)) *
      (width - left - right);
  const yPosition = (value: number) =>
    top +
    (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) *
      (height - top - bottom);

  if (!points.length) {
    return (
      <EmptyState
        title="No curve data"
        detail="The selected algorithms do not contain ranked edges for this scope."
      />
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = top + tick * (height - top - bottom);
          return (
            <line
              key={tick}
              x1={left}
              x2={width - right}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          );
        })}
        <line
          x1={left}
          x2={left}
          y1={top}
          y2={height - bottom}
          stroke="#94a3b8"
        />
        <line
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
          stroke="#94a3b8"
        />
        {series.map((item, index) => {
          const color = PALETTE[index % PALETTE.length];
          const path = item.points
            .map(
              (point, pointIndex) =>
                `${pointIndex ? "L" : "M"} ${xPosition(point.x)} ${yPosition(point.y)}`,
            )
            .join(" ");
          return (
            <path
              key={item.name}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
        >
          {xLabel}
        </text>
        <text
          x="14"
          y={(top + height - bottom) / 2}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
          transform={`rotate(-90 14 ${(top + height - bottom) / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {series.map((item, index) => (
          <span
            key={item.name}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
            />
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

  if (loading) {
    return (
      <EmptyState
        title="Preparing trajectory"
        detail="Reading the project pseudotime and expression matrix."
      />
    );
  }
  if (!context?.trajectory?.available || !lineage) {
    return (
      <EmptyState
        title="Trajectory is unavailable"
        detail={
          context?.trajectory?.reason ??
          "This project does not include usable pseudotime."
        }
      />
    );
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
      aside={
        lineages.length > 1 ? (
          <select
            value={lineage.name}
            onChange={(event) => setRequestedLineageName(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
          >
            {lineages.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-semibold text-slate-500">
            {lineage.cell_count.toLocaleString()} cells
          </span>
        )
      }
    >
      <LineChart series={series} xLabel="Pseudotime" yLabel="Scaled expression" />
    </Panel>
  );
}

type CurvePoint = { x: number; y: number };
type BenchmarkRow = {
  algorithmId: string;
  evaluatedEdges: number;
  auprc: number;
  auroc: number;
  precisionAtK: number;
  earlyPrecisionRatio: number;
  pr: CurvePoint[];
  roc: CurvePoint[];
};

function benchmarkAlgorithm(
  algorithmId: string,
  edges: AggregatedEdge[],
  truth: Set<string>,
  possibleEdges: number,
  evaluationDepth: number,
): BenchmarkRow {
  const ranked = [...edges]
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
    .slice(0, evaluationDepth > 0 ? evaluationDepth : undefined);
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
    auroc +=
      (falsePositiveRate - previousFpr) *
      ((previousTpr + truePositiveRate) / 2);
    previousRecall = recall;
    previousFpr = falsePositiveRate;
    previousTpr = truePositiveRate;
    if (
      index === ranked.length - 1 ||
      index % Math.max(1, Math.floor(ranked.length / 180)) === 0
    ) {
      pr.push({ x: recall, y: precision });
      roc.push({ x: falsePositiveRate, y: truePositiveRate });
    }
  });
  const precisionAtK = k ? trueAtK / k : 0;
  const baseRate = truth.size / Math.max(1, possibleEdges);
  return {
    algorithmId,
    evaluatedEdges: ranked.length,
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
  algorithmEdgeRows,
  activeAlgorithmIds,
}: {
  context: VisualizationContext | null;
  loading: boolean;
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  activeAlgorithmIds: string[];
}) {
  const [evaluationDepth, setEvaluationDepth] = useState(0);
  const rows = useMemo(() => {
    const truthEdges = context?.ground_truth?.edges ?? [];
    if (!truthEdges.length) return [];
    const truth = new Set(
      truthEdges.map((edge) => edgeKey(edge.source, edge.target)),
    );
    const genes = new Set<string>();
    truthEdges.forEach((edge) => {
      genes.add(edge.source);
      genes.add(edge.target);
    });
    activeAlgorithmIds.forEach((algorithmId) => {
      (algorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
        genes.add(edge.source);
        genes.add(edge.target);
      });
    });
    const possibleEdges = Math.max(1, genes.size * Math.max(1, genes.size - 1));
    return activeAlgorithmIds.map((algorithmId) =>
      benchmarkAlgorithm(
        algorithmId,
        algorithmEdgeRows[algorithmId] ?? [],
        truth,
        possibleEdges,
        evaluationDepth,
      ),
    );
  }, [activeAlgorithmIds, algorithmEdgeRows, context, evaluationDepth]);

  if (loading) {
    return (
      <EmptyState
        title="Preparing benchmark"
        detail="Reading the project reference network."
      />
    );
  }
  if (!context?.ground_truth?.available) {
    return (
      <EmptyState
        title="Reference network required"
        detail={
          context?.ground_truth?.reason ??
          "Add a ground-truth network to evaluate predictions."
        }
      />
    );
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <SelectControl
        label="Evaluation depth"
        value={evaluationDepth}
        onChange={(value) => setEvaluationDepth(Number(value))}
      >
        <option value={0}>All ranked edges</option>
        {[100, 250, 500, 1000, 2500].map((value) => (
          <option key={value} value={value}>
            Top {value}
          </option>
        ))}
      </SelectControl>
      <span className="text-xs font-semibold text-slate-500">
        {context.ground_truth.edge_count?.toLocaleString()} reference edges
      </span>
    </div>
  );

  return (
    <div className="space-y-5">
      <Panel
        title="Precision–recall benchmark"
        description="Precision–recall is the primary view for sparse regulatory networks. Evaluation depth is controlled here, independently of Network display settings."
        aside={controls}
      >
        <LineChart
          series={rows.map((row) => ({
            name: row.algorithmId,
            points: row.pr,
          }))}
          xLabel="Recall"
          yLabel="Precision"
        />
      </Panel>
      <Panel
        title="Benchmark metrics"
        description="Early precision complements the full ranking; ROC is included as a secondary metric."
        aside={
          <ExportButton
            onClick={() =>
              downloadCsv("benchmark-metrics.csv", [
                [
                  "algorithm",
                  "evaluated_edges",
                  "auprc",
                  "precision_at_k",
                  "early_precision_ratio",
                  "auroc",
                ],
                ...rows.map((row) => [
                  row.algorithmId,
                  row.evaluatedEdges,
                  row.auprc.toFixed(3),
                  row.precisionAtK.toFixed(3),
                  row.earlyPrecisionRatio.toFixed(3),
                  row.auroc.toFixed(3),
                ]),
              ])
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="pb-3">Algorithm</th>
                <th className="pb-3 text-right">Edges evaluated</th>
                <th className="pb-3 text-right">AUPRC</th>
                <th className="pb-3 text-right">Precision@K</th>
                <th className="pb-3 text-right">Early precision ratio</th>
                <th className="pb-3 text-right">AUROC</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => b.auprc - a.auprc)
                .map((row) => (
                  <tr
                    key={row.algorithmId}
                    className="border-b border-slate-100 text-sm"
                  >
                    <td className="py-3 font-extrabold text-slate-900">
                      {row.algorithmId}
                    </td>
                    <td className="py-3 text-right tabular-nums text-slate-700">
                      {row.evaluatedEdges.toLocaleString()}
                    </td>
                    <td className="py-3 text-right font-bold tabular-nums text-[#087ead]">
                      {row.auprc.toFixed(3)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-slate-700">
                      {row.precisionAtK.toFixed(3)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-slate-700">
                      {row.earlyPrecisionRatio.toFixed(3)}×
                    </td>
                    <td className="py-3 text-right tabular-nums text-slate-700">
                      {row.auroc.toFixed(3)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="ROC curves"
        description="A secondary view; sparse networks can make ROC performance look optimistic."
      >
        <LineChart
          series={rows.map((row) => ({
            name: row.algorithmId,
            points: row.roc,
          }))}
          xLabel="False-positive rate"
          yLabel="True-positive rate"
        />
      </Panel>
    </div>
  );
}

function DiagnosticsView({
  analysisEdges,
  algorithmResults,
  algorithmEdgeRows,
  activeAlgorithmIds,
  tasks,
}: {
  analysisEdges: AggregatedEdge[];
  algorithmResults: Record<string, AlgorithmStoredResult>;
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  activeAlgorithmIds: string[];
  tasks: ProjectTask[];
}) {
  const [structureDepth, setStructureDepth] = useState(500);
  const structureEdges = useMemo(
    () =>
      [...analysisEdges]
        .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
        .slice(0, structureDepth > 0 ? structureDepth : undefined),
    [analysisEdges, structureDepth],
  );
  const motifRows = useMemo(() => {
    const adjacency = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    structureEdges.forEach((edge) => {
      const outgoing = adjacency.get(edge.source) ?? new Set<string>();
      outgoing.add(edge.target);
      adjacency.set(edge.source, outgoing);
      const incoming = reverse.get(edge.target) ?? new Set<string>();
      incoming.add(edge.source);
      reverse.set(edge.target, incoming);
    });
    let reciprocal = 0;
    let feedForward = 0;
    structureEdges.forEach((edge) => {
      if (adjacency.get(edge.target)?.has(edge.source)) reciprocal += 1;
      adjacency.get(edge.source)?.forEach((third) => {
        if (
          third !== edge.target &&
          adjacency.get(edge.target)?.has(third)
        ) {
          feedForward += 1;
        }
      });
    });
    return [
      {
        label: "Feed-forward loops",
        value: feedForward,
        note: "A→B, A→C, B→C",
      },
      {
        label: "Reciprocal pairs",
        value: Math.floor(reciprocal / 2),
        note: "A↔B",
      },
      {
        label: "Fan-out hubs",
        value: [...adjacency.values()].filter((targets) => targets.size >= 3)
          .length,
        note: "At least 3 targets",
      },
      {
        label: "Fan-in hubs",
        value: [...reverse.values()].filter((sources) => sources.size >= 3)
          .length,
        note: "At least 3 regulators",
      },
    ];
  }, [structureEdges]);
  const maxMotif = Math.max(0, ...motifRows.map((row) => row.value));

  const runtimeRows = useMemo(
    () =>
      activeAlgorithmIds
        .map((algorithmId) => {
          const task = tasks.find(
            (item) =>
              item.algorithm_id.toUpperCase() === algorithmId.toUpperCase(),
          );
          const seconds = Number(
            algorithmResults[algorithmId]?.elapsed_seconds ??
              task?.elapsed_seconds ??
              0,
          );
          return {
            label: algorithmId,
            value: Number.isFinite(seconds) ? seconds : 0,
            note: `${(
              algorithmEdgeRows[algorithmId] ?? []
            ).length.toLocaleString()} ranked edges in this scope`,
          };
        })
        .sort((a, b) => b.value - a.value),
    [
      activeAlgorithmIds,
      algorithmEdgeRows,
      algorithmResults,
      tasks,
    ],
  );
  const positiveRuntimes = runtimeRows
    .map((row) => row.value)
    .filter((value) => value > 0);
  const totalRuntime = positiveRuntimes.reduce((sum, value) => sum + value, 0);
  const medianRuntime = median(positiveRuntimes);
  const fastestRuntime = positiveRuntimes.length
    ? Math.min(...positiveRuntimes)
    : 0;

  return (
    <div className="space-y-5">
      <Panel
        title="Network structure"
        description="Structural patterns are calculated from a view-local top-edge universe, not from the Network tab’s display filters. Counts are descriptive, not enrichment p-values."
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <SelectControl
              label="Profile"
              value={structureDepth}
              onChange={(value) => setStructureDepth(Number(value))}
            >
              {[100, 250, 500, 1000, 2000].map((value) => (
                <option key={value} value={value}>
                  Top {value} edges
                </option>
              ))}
              <option value={0}>All inferred edges</option>
            </SelectControl>
            <ExportButton
              onClick={() =>
                downloadCsv("network-structure.csv", [
                  ["pattern", "count", "per_1000_edges"],
                  ...motifRows.map((row) => [
                    row.label,
                    row.value,
                    structureEdges.length
                      ? ((row.value / structureEdges.length) * 1000).toFixed(3)
                      : 0,
                  ]),
                ])
              }
            />
          </div>
        }
      >
        {structureEdges.length ? (
          <div className="space-y-3">
            {motifRows.map((row) => {
              const normalized = (row.value / structureEdges.length) * 1000;
              return (
                <div
                  key={row.label}
                  className="grid grid-cols-[minmax(9rem,13rem)_1fr_5rem_7rem] items-center gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {row.label}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {row.note}
                    </p>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    {row.value > 0 && maxMotif > 0 ? (
                      <div
                        className="h-full rounded-full bg-[#087ead]"
                        style={{ width: `${(row.value / maxMotif) * 100}%` }}
                      />
                    ) : null}
                  </div>
                  <span className="text-right text-sm font-bold tabular-nums text-slate-700">
                    {row.value.toLocaleString()}
                  </span>
                  <span className="text-right text-xs tabular-nums text-slate-400">
                    {normalized.toFixed(1)}/1k
                  </span>
                </div>
              );
            })}
            <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
              Based on {plural(structureEdges.length, "edge")}. Zero counts are
              shown without a misleading minimum bar.
            </p>
          </div>
        ) : (
          <EmptyState
            title="No edges to profile"
            detail="Select a completed algorithm or another result scope."
          />
        )}
      </Panel>

      <Panel
        title="Run performance"
        description="Recorded wall-clock time for selected completed algorithms. Runtime is independent of every result threshold."
        aside={
          <ExportButton
            onClick={() =>
              downloadCsv("algorithm-runtimes.csv", [
                ["algorithm", "elapsed_seconds", "ranked_edges"],
                ...runtimeRows.map((row) => [
                  row.label,
                  row.value.toFixed(3),
                  (algorithmEdgeRows[row.label] ?? []).length,
                ]),
              ])
            }
          />
        }
      >
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Total selected runtime", value: formatDuration(totalRuntime) },
            { label: "Median method runtime", value: formatDuration(medianRuntime) },
            { label: "Fastest method", value: formatDuration(fastestRuntime) },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3"
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-500">
                {item.label}
              </p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">
                {item.value}
              </p>
            </div>
          ))}
        </div>
        <HorizontalBars
          rows={runtimeRows}
          valueLabel={formatDuration}
          color="#7c3aed"
        />
      </Panel>
    </div>
  );
}

export default function ResultsInsightsSection({
  view,
  networkEdges,
  analysisEdges,
  algorithmEdgeRows,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  tasks,
  networkNodes,
  visualizationContext,
  isContextLoading,
  onSelectGene,
}: ResultsInsightsSectionProps) {
  if (view === "regulators") {
    return (
      <RegulatorView
        analysisEdges={analysisEdges}
        networkEdges={networkEdges}
        networkNodes={networkNodes}
        onSelectGene={onSelectGene}
      />
    );
  }
  if (view === "agreement") {
    return (
      <AgreementView
        algorithmEdgeRows={algorithmEdgeRows}
        algorithmMetaMap={algorithmMetaMap}
        activeAlgorithmIds={activeAlgorithmIds}
      />
    );
  }
  if (view === "trajectory") {
    return (
      <TrajectoryView
        context={visualizationContext}
        loading={isContextLoading}
      />
    );
  }
  if (view === "benchmark") {
    return (
      <BenchmarkView
        context={visualizationContext}
        loading={isContextLoading}
        algorithmEdgeRows={algorithmEdgeRows}
        activeAlgorithmIds={activeAlgorithmIds}
      />
    );
  }
  return (
    <DiagnosticsView
      analysisEdges={analysisEdges}
      algorithmResults={algorithmResults}
      algorithmEdgeRows={algorithmEdgeRows}
      activeAlgorithmIds={activeAlgorithmIds}
      tasks={tasks}
    />
  );
}
