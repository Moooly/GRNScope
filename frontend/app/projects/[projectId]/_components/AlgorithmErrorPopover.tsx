"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type AlgorithmErrorTask = {
  algorithmId: string;
  errorMessage: string;
  errorType?: string | null;
};

type AlgorithmErrorPopoverProps = {
  task: AlgorithmErrorTask | null;
  anchorElement: HTMLElement | null;
  onClose: () => void;
};

export default function AlgorithmErrorPopover({
  task,
  anchorElement,
  onClose,
}: AlgorithmErrorPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!task || !anchorElement) {
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

      // Default: below the anchor, left-aligned to anchor
      let top = anchorRect.bottom + margin;
      let left = anchorRect.left;

      // Flip above if not enough room below
      if (top + panelRect.height > viewportHeight - margin) {
        const flippedTop = anchorRect.top - panelRect.height - margin;
        if (flippedTop >= margin) top = flippedTop;
      }
      // Clamp within viewport horizontally
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
  }, [task, anchorElement]);

  useEffect(() => {
    if (!task) return;
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
  }, [task, anchorElement, onClose]);

  if (!task || typeof document === "undefined") return null;

  const openContactSupport = () => {
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const projectId = pageUrl.match(/\/projects\/([^/?#]+)/)?.[1];
    const question = `Algorithm ${task.algorithmId} failed in this project. Please help me investigate the issue.`;

    window.dispatchEvent(
      new CustomEvent("grnscope:open-contact", {
        detail: {
          algorithmId: task.algorithmId,
          projectId,
          pageUrl,
          question,
        },
      }),
    );
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Algorithm ${task.algorithmId} error`}
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      className="z-[70] w-[min(22rem,calc(100vw-1rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/15"
    >
      <p className="text-sm leading-6 text-slate-700">{task.errorMessage}</p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={openContactSupport}
          className="inline-flex h-8 items-center rounded-full bg-[#1b75a6] px-3.5 text-xs font-semibold text-white transition hover:bg-[#155f87]"
        >
          Contact us
        </button>
      </div>
    </div>,
    document.body,
  );
}
