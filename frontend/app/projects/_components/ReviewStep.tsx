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
  estimatedTotalRuntime: string;
}

export default function ReviewStep({
  projectName,
  projectDescription,
  expressionFileName,
  pseudotimeFileName,
  datasetSummary,
  selectedAlgorithms,
  estimatedTotalRuntime,
}: ReviewStepProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-2xl font-semibold text-white">
          Job review and submission
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Review the project setup before creating the job.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Project
            </p>
            <p className="mt-3 text-lg font-semibold text-white">{projectName}</p>
            {projectDescription && (
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {projectDescription}
              </p>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Expression matrix
            </p>
            <p className="mt-3 text-base font-medium text-white">
              {datasetSummary.dimensions}
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Pseudotime file
            </p>
            <p className="mt-3 text-base font-medium text-white">
              {pseudotimeFileName ? "Provided" : "Not provided"}
            </p>
            {pseudotimeFileName && (
              <p className="mt-2 text-sm text-slate-400">
                One value per cell is included.
              </p>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Runtime
            </p>
            <p className="mt-3 text-lg font-semibold text-white">
              {estimatedTotalRuntime}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Preprocessing parameters
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            {datasetSummary.preprocessingSummary.map((item) => (
              <span
                key={item}
                className="rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm text-teal-100"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Selected algorithms
              </p>
            </div>
          </div>

          {selectedAlgorithms.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {selectedAlgorithms.map((algorithm) => (
                <AlgorithmCard
                  key={algorithm.id}
                  algorithm={algorithm}
                  checked={true}
                  disabled={false}
                  onToggle={() => {}}
                  showCheckbox={false}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-slate-400">No algorithms selected yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}