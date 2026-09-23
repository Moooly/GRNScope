/** Shared publication palette (ColorBrewer RdBu edges, one warm accent for
 * transcription factors). The figure stays white independently of app theme.
 * Nodes have no rim: the *Rim keys equal their fills and exist only so older
 * consumers keep compiling. */
export const NETWORK_THEME = {
  ground: "#ffffff",
  node: "#e3e3e3", nodeRim: "#e3e3e3",
  tf: "#e08214", tfRim: "#e08214",
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
export const EDGE_GAP = 80;
export type NetworkTheme = typeof NETWORK_THEME;
