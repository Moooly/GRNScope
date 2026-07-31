"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DownloadMenuItem = {
  label: string;
  format: string;
  onSelect: () => void | Promise<void>;
  description?: string;
  disabled?: boolean;
};

type DownloadMenuProps = {
  items: DownloadMenuItem[];
  label?: string;
  ariaLabel?: string;
  align?: "left" | "right";
  className?: string;
  icon?: ReactNode;
};

export const DOWNLOAD_BUTTON_CLASS =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-wait disabled:opacity-60";

export function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 3.25v8.5m0 0 3-3m-3 3-3-3M4.25 13.5v1.25A1.75 1.75 0 0 0 6 16.5h8a1.75 1.75 0 0 0 1.75-1.75V13.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DownloadMenu({
  items,
  label = "Download",
  ariaLabel = "Download options",
  align = "right",
  className = "",
  icon,
}: DownloadMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const selectItem = async (item: DownloadMenuItem) => {
    if (item.disabled || isPreparing) return;
    setIsPreparing(true);
    setError("");
    try {
      await item.onSelect();
      setIsOpen(false);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The download could not be prepared.",
      );
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <div ref={menuRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          setError("");
          setIsOpen((current) => !current);
        }}
        disabled={isPreparing || !items.length}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={DOWNLOAD_BUTTON_CLASS}
      >
        {icon ?? <DownloadIcon />}
        <span>{isPreparing ? "Preparing…" : label}</span>
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          className={`absolute top-[calc(100%+0.55rem)] z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-900 shadow-xl shadow-slate-900/15 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <button
              key={`${item.label}-${item.format}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => void selectItem(item)}
              className="group flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f2f9fc] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900 group-hover:text-[#087ead]">
                  {item.label}
                </span>
                {item.description ? (
                  <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                    {item.description}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {item.format}
              </span>
            </button>
          ))}
          {error ? (
            <p
              role="alert"
              className="mx-1 mb-1 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-4 text-rose-700"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
