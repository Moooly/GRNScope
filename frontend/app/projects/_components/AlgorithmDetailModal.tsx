import { useEffect } from "react";
import type { ProjectAlgorithm } from "../page";

interface AlgorithmDetailModalProps {
  algorithm: ProjectAlgorithm | null;
  isClosing: boolean;
  onClose: () => void;
}

/**
 * Layered modal showing the full description, strengths, limitations, and
 * publication details for a single algorithm. Sits on top of the create-project
 * modal — clicking the backdrop or pressing Escape closes only this layer.
 */
export default function AlgorithmDetailModal({
  algorithm,
  isClosing,
  onClose,
}: AlgorithmDetailModalProps) {
  useEffect(() => {
    if (!algorithm) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [algorithm, onClose]);

  if (!algorithm) return null;

  const properties = [
    algorithm.requiresPseudotime ? "Requires pseudotime" : "No pseudotime",
    algorithm.directed ? "Directed" : "Undirected",
    algorithm.signed ? "Signed" : "Unsigned",
  ];

  return (
    <div
      className={`fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-10 backdrop-blur-sm sm:px-6 lg:py-14 ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={onClose}
    >
      <div
        className={`max-h-[calc(100vh-5rem)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/30 lg:p-8 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Algorithm details
            </p>
            <h3 className="mt-2 truncate text-2xl font-bold tracking-tight text-slate-950">
              {algorithm.name}
            </h3>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-600">
              <span className="font-medium text-[#1b75a6]">{algorithm.category}</span>
              {algorithm.year ? <span>· {algorithm.year}</span> : null}
              {algorithm.journal ? <span>· {algorithm.journal}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <span className="block h-4 w-4 leading-none">×</span>
          </button>
        </div>

        {algorithm.detail && (
          <p className="mt-5 text-sm leading-7 text-slate-700">
            {algorithm.detail}
          </p>
        )}

        <div className="mt-5 text-sm text-slate-600">
          <span className="font-semibold text-slate-950">Properties:</span>{" "}
          {properties.join(" · ")}
        </div>

        {algorithm.strengths && algorithm.strengths.length > 0 && (
          <DetailList title="Strengths" items={algorithm.strengths} />
        )}

        {algorithm.limitations && algorithm.limitations.length > 0 && (
          <DetailList title="Limitations" items={algorithm.limitations} />
        )}

        {algorithm.recommendedUseCases && algorithm.recommendedUseCases.length > 0 && (
          <DetailList title="Recommended use cases" items={algorithm.recommendedUseCases} />
        )}

        <div className="mt-6 grid gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4 text-sm sm:grid-cols-2">
          {algorithm.publication && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Publication
              </p>
              <p className="mt-1 text-slate-700">{algorithm.publication}</p>
            </div>
          )}
          {algorithm.dockerVersion && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Docker image
              </p>
              <p className="mt-1 truncate text-slate-700" title={algorithm.dockerVersion}>
                {algorithm.dockerVersion}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
          {algorithm.sourceUrl && (
            <a
              href={algorithm.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            >
              Source code ↗
            </a>
          )}
          {algorithm.paperUrl && (
            <a
              href={algorithm.paperUrl}
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer rounded-full bg-[#1b75a6] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
            >
              Open paper ↗
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
