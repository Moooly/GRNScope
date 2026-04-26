import { Algorithm } from "../_types/algorithm";
import AlgorithmCard from "./AlgorithmCard";

interface DatasetSummary {
  dimensions: string;
  preprocessingSummary: string[];
}

interface ReviewStepProps {
  projectName: string;
  projectDescription: string;
  expressionFileName: string;
  pseudotimeFileName: string;
  datasetSummary: DatasetSummary;
  selectedAlgorithms: Algorithm[];
}

export default function ReviewStep({
  projectName,
  projectDescription,
  expressionFileName,
  pseudotimeFileName,
  datasetSummary,
  selectedAlgorithms,
}: ReviewStepProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
        <div className="border-b border-slate-200 pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
            Final check
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
            Job review and submission
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Review your dataset, preprocessing settings, and selected algorithms before creating the project.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Project
            </p>
            <p className="mt-3 text-lg font-bold text-slate-950">
              {projectName}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {projectDescription || "No description"}
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Expression matrix
            </p>
            <p className="mt-3 text-base font-bold text-slate-950">
              {datasetSummary.dimensions}
            </p>
            <p className="mt-2 truncate text-sm text-slate-500">
              {expressionFileName}
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Pseudotime file
            </p>
            <p className="mt-3 text-base font-bold text-slate-950">
              {pseudotimeFileName ? "Provided" : "Not provided"}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {pseudotimeFileName || "No pseudotime file uploaded"}
            </p>
          </div>

        </div>

        <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Preprocessing parameters
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {datasetSummary.preprocessingSummary.map((item) => (
              <span
                key={item}
                className="rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-4 py-2 text-sm font-bold text-[#1b75a6]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
          <div className="border-b border-slate-200 pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Selected algorithms
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              These algorithms will be submitted as part of this project.
            </p>
          </div>

          {selectedAlgorithms.length > 0 ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {selectedAlgorithms.map((algorithm) => (
                <AlgorithmCard
                  key={algorithm.id}
                  algorithm={algorithm}
                  checked={false}
                  disabled={false}
                  onToggle={() => {}}
                  showCheckbox={false}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No algorithms selected yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}