export const NETWORK_THEME = {
  ground: "#3e3e3e", node: "#f4f4f1", nodeRim: "#bdcecd",
  nodeMuted: "#727b79", regulatorRing: "#82b9b2",
  link: "#009999", linkMuted: "#566b68", label: "#cecece", labelHalo: "#3e3e3e",
  accent: "#f4cb86", accentSoft: "#78654a",
  activates: "#009999", represses: "#c88d68", unknown: "#899b98",
} as const;
export const NETWORK_SCALE = {
  nodeMinModel: 10, nodeMaxModel: 64,
  labelMinPx: 8, labelMaxPx: 14, linkPx: 1, linkTracePx: 2,
  maxFitZoom: 1.7, minZoom: 0.015, maxZoom: 6,
  labelsPerSqrtNode: 5, fitPadding: 52,
} as const;
export type NetworkTheme = typeof NETWORK_THEME;
