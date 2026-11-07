

"use client";

import DownloadMenu from "./DownloadMenu";

type FileDownloadMenuModalProps = {
  analysisPackage?: { href: string; filename: string; disabled: boolean };
  projectId?: string;
  apiBase: string;
  expressionFilename?: string | null;
  pseudotimeFilename?: string | null;
  hasPseudotime?: boolean | null;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
  evidenceThreshold: number;
  confidenceThreshold: number;
  directionConfidenceThreshold: number;
  signConfidenceThreshold: number;
  consensusThreshold: number;
  onOpenDownload: (label: string, href: string, filename: string) => void;
};

export default function FileDownloadMenuModal({
  analysisPackage,
  projectId,
  apiBase,
  expressionFilename,
  pseudotimeFilename,
  hasPseudotime,
  activeAlgorithmIds,
  selectedResultScopeId,
  evidenceThreshold,
  confidenceThreshold,
  directionConfidenceThreshold,
  signConfidenceThreshold,
  consensusThreshold,
  onOpenDownload,
}: FileDownloadMenuModalProps) {
  const expressionFileLabel = expressionFilename || "ExpressionData.csv";
  const pseudotimeFileLabel = pseudotimeFilename || "PseudoTime.csv";
  const selectedView =
    activeAlgorithmIds.length >= 2
      ? "consensus"
      : activeAlgorithmIds[0] ?? "consensus";
  const metadataQuery = new URLSearchParams({
    selected_view: selectedView,
    selected_result_scope: selectedResultScopeId,
    evidence_threshold: String(evidenceThreshold),
    confidence_threshold: String(confidenceThreshold),
    direction_confidence_threshold: String(directionConfidenceThreshold),
    sign_confidence_threshold: String(signConfidenceThreshold),
    consensus_threshold: String(consensusThreshold),
    selected_algorithms: activeAlgorithmIds.join(","),
  });
  const files = [
    ...(analysisPackage ? [{
      label: "Analysis package",
      description: "Run manifests for this analysis.",
      type: "ZIP",
      ...analysisPackage,
    }] : []),
    {
      label: "Expression matrix",
      description: expressionFileLabel,
      type: "CSV",
      disabled: !projectId,
      href: projectId ? `${apiBase}/projects/${projectId}/download/expression` : "",
      filename: expressionFileLabel,
    },
    {
      label: "Pseudotime file",
      description: hasPseudotime ? pseudotimeFileLabel : "Not provided for this project",
      type: "CSV",
      disabled: !projectId || !hasPseudotime,
      href: projectId ? `${apiBase}/projects/${projectId}/download/pseudotime` : "",
      filename: pseudotimeFileLabel,
    },
    {
      label: "Analysis summary",
      description: "Dataset, preprocessing, algorithms, and current export settings.",
      type: "JSON",
      disabled: !projectId,
      href: projectId
        ? `${apiBase}/projects/${projectId}/download/metadata?${metadataQuery.toString()}`
        : "",
      filename: `${projectId ?? "project"}-analysis-metadata.json`,
    },
  ];

  return (
    <DownloadMenu
      variant="quiet"
      ariaLabel="Download project files"
      items={files.map((file) => ({
        label: file.label,
        description: file.description,
        format: file.type,
        disabled: file.disabled,
        onSelect: () => onOpenDownload(file.label, file.href, file.filename),
      }))}
    />
  );
}
