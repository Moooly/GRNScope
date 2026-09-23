/** Shared publication palette (ColorBrewer RdBu edges, one warm accent for
 * transcription factors). The figure stays white independently of app theme.
 * Nodes have no rim: the *Rim keys equal their fills and exist only so older
 * consumers keep compiling. */
export const NETWORK_THEME = {
  ground: "#ffffff",
  node: "#d9d9d9", nodeRim: "#d9d9d9",
  tf: "#d9913a", tfRim: "#d9913a",
  nodeMuted: "#f0f0f0", link: "#2166ac", linkMuted: "#dde3ea",
  label: "#1a1a1a", labelHalo: "#ffffff",
  accent: "#1a1a1a", accentSoft: "#eef2f7",
  activates: "#2166ac", represses: "#b2182b", unknown: "#b5b5b5",
} as const;
export const NETWORK_SCALE = {
  nodeMinModel: 20, nodeMaxModel: 200,
  labelMinPx: 9, labelMaxPx: 16, linkPx: 1, linkTracePx: 2,
  maxFitZoom: 1.7, minZoom: 0.015, maxZoom: 6,
  fitPadding: 64,
} as const;
/** Visible gap between the rims of two connected genes, in model units. Every
 * spring in the force layout aims for this same length. */
export const EDGE_GAP = 100;

/** Two candidate palettes, switchable while the boss compares them.
 * "contrast": ColorBrewer RdBu links, amber TFs, grey genes (colour-blind safe).
 * "soft": the original low-saturation look -- blue TFs, mint genes, teal and
 * clay links. Pie shades: [regulates, regulated by, direction unknown]. */
export type PaletteName = "contrast" | "soft";
export type Palette = {
  ground: string; node: string; tf: string; label: string; accent: string;
  activates: string; represses: string; unknown: string;
  pieTF: readonly [string, string, string]; pieGene: readonly [string, string, string];
};
export const PALETTES: Record<PaletteName, Palette> = {
  contrast: {
    ground: "#ffffff", node: "#d9d9d9", tf: "#d9913a", label: "#1a1a1a", accent: "#1a1a1a",
    activates: "#2166ac", represses: "#b2182b", unknown: "#b5b5b5",
    pieTF: ["#b8732a", "#e8b779", "#f5e1c6"], pieGene: ["#9a9a9a", "#d1d1d1", "#ececec"],
  },
  soft: {
    ground: "#ffffff", node: "#95c4b3", tf: "#8faed0", label: "#33433e", accent: "#33433e",
    activates: "#588f89", represses: "#b77d66", unknown: "#a3aba8",
    pieTF: ["#5f86b3", "#b9cde3", "#e3ebf4"], pieGene: ["#5f9c86", "#b8dacd", "#e2f0ea"],
  },
};
export const PALETTE_LABELS: Record<PaletteName, string> = { contrast: "Contrast", soft: "Soft" };
export type NetworkTheme = typeof NETWORK_THEME;
