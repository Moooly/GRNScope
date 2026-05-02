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
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-black">
            Pseudotime CSV
          </h3>
        </div>
      </div>

      <div className="mt-5">
        <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-8 text-center transition hover:border-[#1b75a6]/35 hover:bg-[#f7fbff]">
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
          <span className="text-sm font-bold text-slate-950">
            {pseudotimeFileName || "Choose pseudotime CSV"}
          </span>
          {pseudotimeFileName && (
            <span className="mt-2 text-sm text-slate-500">Click to replace</span>
          )}
        </label>
      </div>
    </div>
  );
}