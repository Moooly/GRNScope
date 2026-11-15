"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import ResultsInsightsSection from "./ResultsInsightsSection";
import { OutputExportContext, useFileDownloads, type OutputAction, type OutputFile, type OutputExportRegistry } from "./OutputExportContext";
import type { PackageOutput } from "../_lib/projectPackage";
import type { AggregatedEdge } from "../_lib/types";
import NetworkTablePanel from "./network/TablePanel";
import { edgeDistributions } from "./network/distributions";
import DownloadMenu from "./DownloadMenu";

export type ProjectInsightsExportProps = Omit<ComponentProps<typeof ResultsInsightsSection>, "view" | "onTrajectoryGenesChange">;
const ignoreGeneChange = () => {};
const noop = () => {};

function NetworkDistributionExports({ edges, methodCount }: { edges: AggregatedEdge[]; methodCount: number }) {
  const figure = useRef<SVGSVGElement | null>(null);
  const setFigure = useCallback((node: SVGSVGElement | null) => { figure.current = node; }, []);
  const { downloadCsv, downloadSvg, downloadSvgPng } = useFileDownloads();
  const chart = async (format: "png" | "svg") => {
    if (!figure.current) throw new Error("The evidence and confidence chart is unavailable.");
    if (format === "svg") downloadSvg(figure.current, "evidence-confidence.svg");
    else await downloadSvgPng(figure.current, "evidence-confidence.png");
  };
  return <>
    <NetworkTablePanel edges={edges} nodes={[]} methodCount={methodCount} selectedGene={null} selectedEdgeKey={null} onSelectGene={noop} onSelectEdge={noop} onHoverEdge={noop} onHide={noop} onExportFigure={setFigure} />
    <DownloadMenu ariaLabel="Download evidence and confidence" items={[
      { label: "Figure", format: "PNG", onSelect: () => chart("png") },
      { label: "Figure", format: "SVG", onSelect: () => chart("svg") },
      { label: "Distribution table", format: "CSV", onSelect: () => {
        const [evidence, confidence] = edgeDistributions(edges);
        downloadCsv("evidence-confidence.csv", [["bin_start", "bin_end", "evidence_edges", "verified_confidence_edges"], ...evidence.bins.map((bin, index) => [index / evidence.bins.length, (index + 1) / evidence.bins.length, bin.length, confidence.bins[index].length])]);
      } },
    ]} />
  </>;
}

export default function ProjectOutputExports({ insights, networkEdges, onChange, onReady }: {
  insights: ProjectInsightsExportProps;
  networkEdges: AggregatedEdge[];
  onChange: (outputs: PackageOutput[]) => void;
  onReady: () => void;
}) {
  const [actions, setActions] = useState<Map<string, OutputAction[]>>(() => new Map());
  const captureRef = useRef<OutputFile[] | null>(null);
  const registry = useMemo<OutputExportRegistry>(() => ({
    register(id, next) {
      setActions(current => new Map(current).set(id, next));
      return () => setActions(current => { const copy = new Map(current); copy.delete(id); return copy; });
    },
    emit(blob, filename) {
      if (!captureRef.current) throw new Error("The output export has not started.");
      captureRef.current.push({ blob, filename });
    },
  }), []);
  const capture = useCallback(async (action: OutputAction) => {
    if (captureRef.current) throw new Error("Another output is still being prepared.");
    const files: OutputFile[] = [];
    captureRef.current = files;
    try {
      await document.fonts?.ready;
      await action.run();
      return files.map(file => ({ ...file, filename: `analysis_outputs/${action.format === "csv" ? "tables" : "figures"}/${action.section}/${file.filename}` }));
    } finally {
      captureRef.current = null;
    }
  }, []);
  useEffect(() => {
    const all = [...actions.values()].flat();
    const outputs: PackageOutput[] = [];
    // Pair a chart's PNG/SVG choices into one selectable output.
    const figures = new Map<string, OutputAction[]>();
    all.forEach(action => {
      if (action.format === "csv") outputs.push({
        id: action.id,
        label: action.label,
        group: "tables",
        build: async (_format, signal) => { signal.throwIfAborted(); return capture(action); },
      });
      else if (action.format === "png" || action.format === "svg") {
        const key = `${action.section}/${action.label.replace(/ — (Chart image|Vector chart)$/i, " — Figure")}`;
        figures.set(key, [...(figures.get(key) ?? []), action]);
      }
    });
    figures.forEach((choices, id) => outputs.push({
      id,
      label: choices[0].label.replace(/ — (Chart image|Vector chart|Figure|Regulator figure|Agreement matrix)$/i, ""),
      group: "figures",
      formats: choices.map(choice => choice.format),
      build: async (format, signal) => {
        signal.throwIfAborted();
        const choice = choices.find(item => item.format === format);
        if (!choice) throw new Error(`The ${format.toUpperCase()} version is unavailable for ${choices[0].label}.`);
        return capture(choice);
      },
    }));
    onChange(outputs);
  }, [actions, capture, onChange]);
  useEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(onReady); });
    return () => cancelAnimationFrame(frame);
  }, [onReady]);
  const comparisonContext = useMemo(() => ({ registry, section: "comparison" }), [registry]);
  const trajectoryContext = useMemo(() => ({ registry, section: "trajectory" }), [registry]);
  const benchmarkContext = useMemo(() => ({ registry, section: "benchmark" }), [registry]);
  const networkContext = useMemo(() => ({ registry, section: "network" }), [registry]);
  return createPortal(
    <div aria-hidden="true" inert className="pointer-events-none fixed -left-[20000px] top-0 h-px w-[1200px] overflow-hidden opacity-0">
      {insights.activeAlgorithmIds.length > 0 && <OutputExportContext.Provider value={networkContext}>
        <NetworkDistributionExports edges={networkEdges} methodCount={insights.activeAlgorithmIds.length} />
      </OutputExportContext.Provider>}
      {insights.activeAlgorithmIds.length > 0 && <OutputExportContext.Provider value={comparisonContext}>
        <ResultsInsightsSection {...insights} view="agreement" onTrajectoryGenesChange={ignoreGeneChange} />
      </OutputExportContext.Provider>}
      {insights.visualizationContext?.trajectory?.available && <OutputExportContext.Provider value={trajectoryContext}>
        <ResultsInsightsSection {...insights} view="trajectory" onTrajectoryGenesChange={ignoreGeneChange} />
      </OutputExportContext.Provider>}
      {insights.visualizationContext?.ground_truth?.available && <OutputExportContext.Provider value={benchmarkContext}>
        <ResultsInsightsSection {...insights} view="benchmark" onTrajectoryGenesChange={ignoreGeneChange} />
      </OutputExportContext.Provider>}
    </div>, document.body,
  );
}
