import { Algorithm } from "../_types/algorithm";

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
          Review dataset details, preprocessing settings, selected algorithms, and total runtime before submission.
        </p>

        <div className="mt-6 space-y-5 text-sm text-slate-300">
          <div>
            <p className="font-medium text-white">Project</p>
            <p className="mt-2">{projectName}</p>
            {projectDescription && (
              <p className="mt-1 text-slate-400">{projectDescription}</p>
            )}
          </div>

          <div>
            <p className="font-medium text-white">Dataset</p>
            <p className="mt-2">{expressionFileName || "-"}</p>
            <p className="mt-1 text-slate-400">{datasetSummary.dimensions}</p>
            <p className="mt-1 text-slate-400">
              Pseudotime: {pseudotimeFileName || "Not provided"}
            </p>
          </div>

          <div>
            <p className="font-medium text-white">Preprocessing parameters</p>
            <ul className="mt-2 space-y-2 text-slate-400">
              {datasetSummary.preprocessingSummary.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-medium text-white">Selected algorithms</p>
            {selectedAlgorithms.length > 0 ? (
              <ul className="mt-2 space-y-2 text-slate-400">
                {selectedAlgorithms.map((algorithm) => (
                  <li key={algorithm.id}>• {algorithm.name}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-400">No algorithms selected yet.</p>
            )}
          </div>

          <div>
            <p className="font-medium text-white">Estimated total runtime</p>
            <p className="mt-2 text-slate-400">{estimatedTotalRuntime}</p>
          </div>
        </div>
      </div>
    </div>
  );
}