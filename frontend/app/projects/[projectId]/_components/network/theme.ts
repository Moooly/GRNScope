/** Shared publication palette ("Soft", chosen 2026-09-23): blue TFs, yellow
 * genes, teal activation and clay repression on white. The figure stays white
 * independently of app theme. Nodes have no rim: the *Rim keys equal their
 * fills and exist only so older consumers keep compiling. */
export const NETWORK_THEME = {
  ground: "#ffffff",
  // Node colours from the boss's swatches (2026-09-23): blue TFs, yellow genes.
  node: "#fbdd85", nodeRim: "#fbdd85",
  tf: "#80a6e2", tfRim: "#80a6e2",
  nodeMuted: "#e6f2ed", link: "#588f89", linkMuted: "#dde6e4",
  label: "#33433e", labelHalo: "#ffffff",
  accent: "#33433e", accentSoft: "#eef3f1",
  // One ink for every link (2026-09-23): sign is carried by the tip shape
  // alone, direction by solid vs dashed.
  activates: "#565e66", represses: "#565e66", unknown: "#565e66",
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

export type Palette = {
  ground: string; node: string; tf: string; label: string; accent: string;
  activates: string; represses: string; unknown: string;
  /** Direction split: [regulates, regulated by, direction unknown]. The
   * original fill is the darkest slice, so the split is a gentle tone step. */
  pieTF: readonly [string, string, string]; pieGene: readonly [string, string, string];
  /** Smallest node diameter (model units); the largest is 100. Low-degree
   * genes stay visible circles. */
  nodeMin: number;
};
const SOFT: Palette = {
  ground: NETWORK_THEME.ground, node: NETWORK_THEME.node, tf: NETWORK_THEME.tf, label: NETWORK_THEME.label, accent: NETWORK_THEME.accent,
  activates: NETWORK_THEME.activates, represses: NETWORK_THEME.represses, unknown: NETWORK_THEME.unknown,
  pieTF: ["#80a6e2", "#c0d3f1", "#e4ecf9"], pieGene: ["#fbdd85", "#fdedbd", "#fef7e2"],
  nodeMin: 24,
};

/** Two palettes, switchable in Display while the boss chooses.
 * "soft": blue TFs (#80A6E2), yellow genes (#FBDD85), one grey link ink.
 * "contrast": amber TFs, grey genes, ColorBrewer blue/red links. */
export type PaletteName = "soft" | "contrast";
export const PALETTES: Record<PaletteName, Palette> = {
  soft: SOFT,
  contrast: {
    ground: "#ffffff", node: "#d9d9d9", tf: "#d9913a", label: "#1a1a1a", accent: "#1a1a1a",
    activates: "#4a4f55", represses: "#4a4f55", unknown: "#4a4f55",
    pieTF: ["#b8732a", "#e8b779", "#f5e1c6"], pieGene: ["#9a9a9a", "#d1d1d1", "#ececec"],
    nodeMin: 10,
  },
};
export const PALETTE_LABELS: Record<PaletteName, string> = { soft: "Soft", contrast: "Contrast" };
export const DEFAULT_PALETTE: PaletteName = "soft";
/** Default palette, for code that does not follow the switch. */
export const PALETTE: Palette = SOFT;
export type NetworkTheme = typeof NETWORK_THEME;
