

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { RESULT_SECTION_HEADING_CLASS } from "./sectionStyles";

type DatasetPreprocessingSectionProps = {
  expressionMatrixLabel: string;
  topVariableGenesLabel: string | number;
  tfOverrideLabel: string;
  normalizationLabel: string;
  logTransformLabel: string;
  onOpenHelp: () => void;
  onOpenDownloadMenu: () => void;
  onCloseDownloadMenu: () => void;
  isDownloadMenuOpen: boolean;
  downloadMenu: ReactNode;
  divided?: boolean;
  compact?: boolean;
};

export default function DatasetPreprocessingSection({
  expressionMatrixLabel,
  topVariableGenesLabel,
  tfOverrideLabel,
  normalizationLabel,
  logTransformLabel,
  onOpenHelp,
  onOpenDownloadMenu,
  onCloseDownloadMenu,
  isDownloadMenuOpen,
  downloadMenu,
  divided = true,
  compact = false,
}: DatasetPreprocessingSectionProps) {
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const preprocessingItems = [
    { label: "Matrix size", value: expressionMatrixLabel },
    { label: "Gene filter", value: topVariableGenesLabel },
    { label: "TF override", value: tfOverrideLabel },
    { label: "Normalization", value: normalizationLabel },
    { label: "log₂(x + 1)", value: logTransformLabel },
  ];

  useEffect(() => {
    if (!isDownloadMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !downloadMenuRef.current?.contains(target)) {
        onCloseDownloadMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseDownloadMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDownloadMenuOpen, onCloseDownloadMenu]);

  return (
    <section className={compact
      ? "py-6 text-slate-900"
      : `${divided ? "border-t border-slate-200 pt-6" : ""} text-slate-900`
    }>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div>
              <h2 className={compact ? "text-lg font-bold tracking-tight text-slate-950" : RESULT_SECTION_HEADING_CLASS}>
                Dataset and preprocessing
              </h2>
            </div>
            <button
              type="button"
              onClick={onOpenHelp}
              className={`inline-flex shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb] ${compact ? "h-5 w-5" : "h-6 w-6"}`}
              aria-label="Open dataset and preprocessing guide"
              title="Open dataset and preprocessing guide"
            >
              ?
            </button>
          </div>
        </div>
        <div ref={downloadMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={isDownloadMenuOpen ? onCloseDownloadMenu : onOpenDownloadMenu}
            aria-expanded={isDownloadMenuOpen}
            aria-haspopup="dialog"
            aria-label="Download project files"
            title="Download project files"
            className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
          >
            Download
          </button>
          {downloadMenu}
        </div>
      </div>

      <div className={compact ? "mt-4" : "mt-6"}>
        <dl className={`grid ${compact ? "gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : "gap-3 xl:grid-cols-5"}`}>
          {preprocessingItems.map((item) => (
            <div
              key={item.label}
              className="rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4"
            >
              <dt className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-400">
                {item.label}
              </dt>
              <dd className="mt-2 text-sm font-bold text-slate-800">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
