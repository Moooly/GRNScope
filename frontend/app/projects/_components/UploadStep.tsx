import type { DragEvent } from "react";
import FileNameDisplay from "./FileNameDisplay";

interface UploadStepProps {
  pseudotimeFileName: string;
  setPseudotimeFile: (file: File | null) => void;
  setPseudotimeFileName: (value: string) => void;
  clusterLabelsFileName: string;
  setClusterLabelsFile: (file: File | null) => void;
  setClusterLabelsFileName: (value: string) => void;
}

export default function UploadStep({
  pseudotimeFileName,
  setPseudotimeFile,
  setPseudotimeFileName,
  clusterLabelsFileName,
  setClusterLabelsFile,
  setClusterLabelsFileName,
}: UploadStepProps) {
  const selectPseudotimeFile = (file: File | null) => {
    setPseudotimeFile(file);
    setPseudotimeFileName(file?.name ?? "");
  };
  const selectClusterLabelsFile = (file: File | null) => {
    setClusterLabelsFile(file);
    setClusterLabelsFileName(file?.name ?? "");
  };

  const handlePseudotimeDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0] ?? null;
    selectPseudotimeFile(file);
  };

  const handleClusterLabelsDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0] ?? null;
    selectClusterLabelsFile(file);
  };

  return (
    <div className="space-y-5">
      <OptionalFileCard
        title="Pseudotime CSV"
        description="Optional CSV file used by trajectory-based algorithms."
        fileName={pseudotimeFileName}
        placeholder="Drop pseudotime CSV here"
        onDrop={handlePseudotimeDrop}
        onSelect={selectPseudotimeFile}
      />
      <OptionalFileCard
        title="Cluster labels CSV"
        description="Optional cell_id, cluster CSV for global plus per-cluster results."
        fileName={clusterLabelsFileName}
        placeholder="Drop cluster labels CSV here"
        onDrop={handleClusterLabelsDrop}
        onSelect={selectClusterLabelsFile}
      />
    </div>
  );
}

interface OptionalFileCardProps {
  title: string;
  description: string;
  fileName: string;
  placeholder: string;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onSelect: (file: File | null) => void;
}

function OptionalFileCard({
  title,
  description,
  fileName,
  placeholder,
  onDrop,
  onSelect,
}: OptionalFileCardProps) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="w-full">
          <div className="flex w-full items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-slate-950">{title}</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Optional
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>

      <div className="mt-5">
        <label
          className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-6 py-10 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]"
          onDragEnter={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onSelect(file);
            }}
          />
          <FileNameDisplay fileName={fileName} placeholder={placeholder} />
          <span className="mt-2 text-sm text-slate-500">
            {fileName ? "Click to replace" : "or click to browse"}
          </span>
        </label>
      </div>
    </div>
  );
}
