/** Shared publication palette. The figure stays white independently of app theme. */
export const NETWORK_THEME = {
  ground: "#ffffff", node: "#95c4b3", nodeRim: "#699b8a",
  tf: "#8faed0", tfRim: "#6586ac",
  nodeMuted: "#d0e2db", link: "#588f89", linkMuted: "#d5dfdc",
  label: "#33433e", labelHalo: "#ffffff",
  accent: "#237d85", accentSoft: "#e3f1ee",
  activates: "#588f89", represses: "#b77d66", unknown: "#89928f",
} as const;
export const NETWORK_SCALE = {
  nodeMinModel: 6, nodeMaxModel: 34,
  labelMinPx: 9, labelMaxPx: 14, linkPx: 1, linkTracePx: 2,
  maxFitZoom: 1.7, minZoom: 0.015, maxZoom: 6,
  fitPadding: 64,
} as const;
export type NetworkTheme = typeof NETWORK_THEME;
