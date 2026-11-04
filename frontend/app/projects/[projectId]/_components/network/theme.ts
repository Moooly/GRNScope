/** Shared publication palette ("Soft", chosen 2026-09-23): blue TFs, yellow
 * genes, teal activation and clay repression on white. The figure stays white
 * independently of app theme. Nodes have no rim: the *Rim keys equal their
 * fills and exist only so older consumers keep compiling. */
export const NETWORK_THEME = {
  ground: "#ffffff",
  // Node colours: blue TFs, sand-yellow genes (publication pick, 2026-09-23).
  node: "#ebcb7a", nodeRim: "#ebcb7a",
  tf: "#7fa6db", tfRim: "#7fa6db",
  nodeMuted: "#e6f2ed", link: "#588f89", linkMuted: "#dde6e4",
  label: "#46524f", labelHalo: "#ffffff",
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
export const EDGE_GAP = 130;

export type Palette = {
  ground: string; node: string; tf: string; label: string; accent: string;
  activates: string; represses: string; unknown: string;
  /** Smallest node diameter (model units); the largest is 100. Low-degree
   * genes stay visible circles. */
  nodeMin: number;
};
const SOFT: Palette = {
  ground: NETWORK_THEME.ground, node: NETWORK_THEME.node, tf: NETWORK_THEME.tf, label: NETWORK_THEME.label, accent: NETWORK_THEME.accent,
  activates: NETWORK_THEME.activates, represses: NETWORK_THEME.represses, unknown: NETWORK_THEME.unknown,
  nodeMin: 24,
};

/** Two palettes, switchable in Display while the boss chooses.
 * "soft": blue TFs (#7FA6DB), sand-yellow genes (#EBCB7A), one grey link ink.
 * "contrast": amber TFs, grey genes, ColorBrewer blue/red links. */
export type PaletteName = "soft" | "contrast";
export const PALETTES: Record<PaletteName, Palette> = {
  soft: SOFT,
  contrast: {
    ground: "#ffffff", node: "#d9d9d9", tf: "#d9913a", label: "#1a1a1a", accent: "#1a1a1a",
    activates: "#4a4f55", represses: "#4a4f55", unknown: "#4a4f55",
    nodeMin: 10,
  },
};

export const DEFAULT_PALETTE: PaletteName = "soft";
/** Default palette, for code that does not follow the switch. */
export const PALETTE: Palette = SOFT;
