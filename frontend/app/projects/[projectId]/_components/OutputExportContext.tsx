"use client";

import { createContext, useContext, useMemo } from "react";
import { downloadBlob, downloadCsv, downloadSvg, downloadSvgPng, type FileSink } from "../_lib/downloads";

export type OutputFile = { filename: string; blob: Blob };
export type OutputAction = {
  id: string;
  label: string;
  format: string;
  section: string;
  run: () => void | Promise<void>;
};
export type OutputExportRegistry = {
  register: (id: string, actions: OutputAction[]) => () => void;
  emit: FileSink;
};

// Only the isolated export renderers receive this context. A ZIP never captures
// another download the reader starts elsewhere on the page.
export const OutputExportContext = createContext<{
  registry: OutputExportRegistry;
  section: string;
} | null>(null);

export function useFileDownloads() {
  const context = useContext(OutputExportContext);
  const emit = context?.registry.emit ?? downloadBlob;
  return useMemo(() => ({
    downloadCsv: (filename: string, rows: Parameters<typeof downloadCsv>[1]) => downloadCsv(filename, rows, emit),
    downloadSvg: (svg: SVGSVGElement, filename: string) => downloadSvg(svg, filename, emit),
    downloadSvgPng: (svg: SVGSVGElement, filename: string, scale = 3) => downloadSvgPng(svg, filename, scale, emit),
  }), [emit]);
}
