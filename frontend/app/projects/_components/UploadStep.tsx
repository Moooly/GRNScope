interface UploadStepProps {
  pseudotimeFileName: string;
  setPseudotimeFile: (file: File | null) => void;
  setPseudotimeFileName: (value: string) => void;
}

export default function UploadStep({
  pseudotimeFileName,
  setPseudotimeFile,
  setPseudotimeFileName,
}: UploadStepProps) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="w-full">
          <div className="flex w-full items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-slate-950">Pseudotime CSV</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Optional
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Optional CSV file used by trajectory-based algorithms. Upload it only
            if your dataset includes pseudotime values.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-6 py-10 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]">
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setPseudotimeFile(file);
              setPseudotimeFileName(file?.name ?? "");
            }}
          />
          <span className="text-base font-bold text-slate-950">
            {pseudotimeFileName || "Drop pseudotime CSV here"}
          </span>
          <span className="mt-2 text-sm text-slate-500">
            {pseudotimeFileName ? "Click to replace" : "or click to browse"}
          </span>
        </label>
      </div>
    </div>
  );
}