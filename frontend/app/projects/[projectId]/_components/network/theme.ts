/**
 * The canvas palette is the page palette.
 *
 * The galaxy used to sit on charcoal inside a white card, which made the
 * figure a foreign object on the page and left the legend describing colours
 * in values that were invisible against the legend's own white row. Every
 * value below is drawn from the surrounding interface: the slate ink and rule
 * colours of `.grn-atlas`, the navy of the site header, and the light
 * `NETWORK_APPEARANCES` family the other layouts already render in.
 *
 * Three data hues, kept apart by hue rather than by lightness, so they survive
 * the thin strokes and low opacities a dense network needs:
 *   teal  -- activation
 *   clay  -- repression
 *   grey  -- no method resolved an effect
 * Selection is deliberately the interface's own accent blue, not a fourth data
 * colour: it says "you are pointing at this", not "this means something".
 */
export const NETWORK_THEME = {
  ground: "#ffffff", node: "#52717f", nodeRim: "#ffffff",
  // A two-step vertical gradient, lit from above. Wide enough to give the node
  // a little body against white, narrow enough that it still reads as one
  // colour rather than as a shiny bead -- this is a scientific figure, not a
  // dashboard widget. `node` stays as the flat value anything that cannot draw
  // a gradient falls back to.
  nodeTop: "#6b8b9b", nodeBottom: "#405f6e",
  nodeMuted: "#b2c1c9",
  link: "#12808a", linkMuted: "#cbd8de", label: "#263b49", labelHalo: "#ffffff",
  accent: "#1b75a6", accentSoft: "#d7e9f4",
  activates: "#12808a", represses: "#bd6543", unknown: "#85929d",
} as const;
export const NETWORK_SCALE = {
  nodeMinModel: 10, nodeMaxModel: 64,
  labelMinPx: 8, labelMaxPx: 14, linkPx: 1, linkTracePx: 2,
  maxFitZoom: 1.7, minZoom: 0.015, maxZoom: 6,
  labelsPerSqrtNode: 5, fitPadding: 52,
  /** sqrt(pi / 2).
   *
   * A diamond inscribed in a box covers half of it; a circle covers pi/4 of it.
   * Drawn at the same width a regulator would read as markedly smaller than a
   * target gene of identical degree, turning a category mark into a false size
   * difference -- and size already means connection count here. This is the
   * exact factor that gives the two marks equal area, so shape is the only
   * thing that separates them. */
  regulatorScale: 1.2533,
} as const;
export type NetworkTheme = typeof NETWORK_THEME;
