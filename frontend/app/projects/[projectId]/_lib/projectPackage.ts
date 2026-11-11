import { downloadCsv } from "./downloads";
import type { AggregatedEdge } from "./types";
import type { OutputFile } from "../_components/OutputExportContext";

export type PackageOutput = {
  id: string;
  label: string;
  group: "network" | "tables" | "figures" | "perturbations";
  formats?: string[];
  build: (format: "svg" | "png", signal: AbortSignal) => Promise<OutputFile[]>;
};

export function edgeOutputFile(filename: string, edges: AggregatedEdge[]): OutputFile {
  let result: OutputFile | undefined;
  downloadCsv(filename, [
    ["rank", "source", "target", "evidence", "confidence", "raw_score", "evidence_ci_lower", "evidence_ci_upper", "runs_recovered", "bootstrap_runs", "direction", "direction_confidence", "sign", "sign_confidence", "support", "supporting_methods"],
    ...edges.map(edge => [edge.rank, edge.source, edge.target, edge.score, edge.confidence,
      Object.entries(edge.perAlgorithmRawScores ?? {}).map(([id, score]) => `${id}:${score}`).join(";"),
      edge.evidenceCiLower, edge.evidenceCiUpper, edge.bootstrapSelectedRuns, edge.bootstrapRunCount,
      edge.direction, edge.directionConfidence, edge.sign, edge.signConfidence, edge.count, edge.supportingAlgorithms.join(";")]),
  ], (blob, name) => { result = { blob, filename: name }; });
  return result!;
}

export function safeOutputPath(path: string) {
  const parts = path.split("/");
  if (!path || path.includes("\\") || parts.some(part => !part || part === "." || part === ".." || /[\x00-\x1f]/.test(part))) {
    throw new Error("An output has an invalid filename.");
  }
  return path;
}

export async function buildProjectPackage({ base, outputs, format, settings, signal, onProgress }: {
  base: ArrayBuffer;
  outputs: PackageOutput[];
  format: "svg" | "png";
  settings: Record<string, unknown>;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}) {
  const { default: JSZip } = await import("jszip");
  signal.throwIfAborted();
  const zip = await JSZip.loadAsync(base);
  const manifestPath = Object.keys(zip.files).find(path => path.endsWith("/project_manifest.json"));
  if (!manifestPath) throw new Error("The project package is missing its configuration. Please try again.");
  const root = manifestPath.slice(0, -"project_manifest.json".length);
  const manifest = JSON.parse(await zip.file(manifestPath)!.async("string"));
  const inventory: Array<Record<string, unknown>> = [];
  for (const [index, output] of outputs.entries()) {
    signal.throwIfAborted();
    onProgress(`Preparing output ${index + 1} of ${outputs.length}…`);
    const files = await output.build(format, signal);
    signal.throwIfAborted();
    if (!files.length) throw new Error(`${output.label} could not be generated. Please try again.`);
    for (const file of files) {
      const path = safeOutputPath(file.filename);
      if (!path.startsWith("analysis_outputs/")) throw new Error("An output is outside the output folder.");
      if (zip.file(root + path)) throw new Error(`Two outputs use the same filename: ${path}`);
      const bytes = await file.blob.arrayBuffer();
      const sha256 = globalThis.crypto?.subtle
        ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("")
        : undefined;
      zip.file(root + path, bytes);
      inventory.push({ id: output.id, path, size_bytes: bytes.byteLength, ...(sha256 ? { sha256 } : {}) });
    }
  }
  manifest.export_settings = settings;
  manifest.analysis_outputs = { figure_format: format, files: inventory };
  zip.file(manifestPath, JSON.stringify(manifest, null, 2));
  const readme = zip.file(root + "README.txt");
  zip.file(root + "README.txt", (readme ? await readme.async("string") : "") +
    "\nanalysis_outputs/ contains the selected network results, analysis tables, figures and saved perturbation files.\nProject configuration is always included. See project_manifest.json for export settings and the output inventory.\nMethod networks contain all loaded edges for the recorded scope, without display filters. Filtered network exports are explicitly named.\nAnalysis tables and figures use standard view settings (comparison: top 100, topology, Jaccard; trajectory: first lineage and supplied genes; benchmark: default view). They do not enumerate every possible chart setting.\nOutput checksums are included when the browser supports SHA-256.\n");
  signal.throwIfAborted();
  onProgress("Compressing ZIP…");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } }, () => signal.throwIfAborted());
  signal.throwIfAborted();
  return blob;
}
