"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AlgorithmWarning = {
  code: string;
  algorithmId: string;
  title: string;
  message: string;
};

type AlgorithmWarningPopoverProps = {
  warnings: AlgorithmWarning[] | null;
  anchorElement: HTMLElement | null;
  onClose: () => void;
};

export default function AlgorithmWarningPopover({
  warnings,
  anchorElement,
  onClose,
}: AlgorithmWarningPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!warnings || warnings.length === 0 || !anchorElement) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset popover position when it closes
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const anchorRect = anchorElement.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = anchorRect.bottom + margin;
      let left = anchorRect.left;

      if (top + panelRect.height > viewportHeight - margin) {
        const flippedTop = anchorRect.top - panelRect.height - margin;
        if (flippedTop >= margin) top = flippedTop;
      }
      if (left + panelRect.width > viewportWidth - margin) {
        left = viewportWidth - margin - panelRect.width;
      }
      if (left < margin) left = margin;

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [warnings, anchorElement]);

  useEffect(() => {
    if (!warnings || warnings.length === 0) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorElement?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [warnings, anchorElement, onClose]);

  if (!warnings || warnings.length === 0 || typeof document === "undefined") return null;

  const isSingle = warnings.length === 1;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Algorithm note"
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      className="z-[70] w-[min(24rem,calc(100vw-1rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/15"
    >
      {isSingle ? (
        <div>
          <p className="text-sm font-semibold text-slate-900">{warnings[0].title}</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-600">
            {warnings[0].message}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {warnings.map((warning) => (
            <li key={warning.code} className="border-l-2 border-[#1b75a6]/25 pl-3">
              <p className="text-sm font-semibold text-slate-900">{warning.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{warning.message}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          Dismiss
        </button>
      </div>
    </div>,
    document.body,
  );
}
