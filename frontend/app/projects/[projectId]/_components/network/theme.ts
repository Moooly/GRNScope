/**
 * One palette for the network, and one set of sizes.
 *
 * The old canvas spent colour on categories: eight module hues on every node,
 * a ninth for bridges, sign colour on every edge. Colour that marks everything
 * marks nothing, and at a hundred genes the result was texture rather than
 * information. None of the Cytoscape figures worth copying do this -- their
 * colour is either a continuous data ramp or a single accent on the one thing
 * in focus, and everything else is a neutral.
 *
 * So here colour is a scarce resource with exactly one job: showing what you
 * have selected and what it reaches. Everything at rest is one neutral, and
 * the structure is carried by position, size and density instead.
 */

export const NETWORK_THEME = {
  /** Warm charcoal, not black. Black makes thin teal lines glare and crushes
   *  the low end of the edge-opacity range; a lifted grey keeps hairlines
   *  readable and lets the white nodes be the brightest thing on the canvas. */
  ground: "#3b3b3b",
  /** Every gene: near-white, flat, and -- deliberately -- no border. A rim on
   *  a five-pixel disc doubles its visual weight and the leaves stop reading
   *  as small. The contrast against the ground is the whole outline. */
  node: "#f2f5f5",
  nodeRim: "#f2f5f5",
  nodeMuted: "#565656",
  regulatorRing: "#f2f5f5",
  /** Links carry sign, and both hues are picked to sit on charcoal: the teal
   *  is the reference figure's own, the clay is its warm counterpart at
   *  matched lightness so neither dominates. */
  link: "#6f8f8b",
  linkMuted: "#4a4a4a",
  label: "#e7ecec",
  labelHalo: "#3b3b3b",
  /** Selection is the one colour that is neither teal nor clay, so it can
   *  never be mistaken for a sign. */
  accent: "#ff7a5c",
  accentSoft: "#7d4536",
  activates: "#4f9d94",
  represses: "#c07d55",
  unknown: "#8a8a8a",
} as const;

/**
 * Sizes are in RENDERED PIXELS -- what the reader's eye actually receives --
 * not in model units. Cytoscape draws model units at `value * zoom`, and zoom
 * comes from fitting the graph, so a model-unit budget silently means
 * something different at every graph size. That single confusion is what made
 * 19 genes render 6px type and 100 genes render 24px type from the same
 * stylesheet.
 */
export const NETWORK_SCALE = {
  /** Model units, not pixels -- see nodeDiameterModel for why node size is the
   *  one thing that cannot be budgeted on screen. The ratio between these two
   *  is what the reader actually perceives: a hub is six times a leaf. */
  nodeMinModel: 14,
  nodeMaxModel: 76,
  /** A gene name is a word, and words below ten pixels are shapes. */
  labelMinPx: 10,
  labelMaxPx: 13,
  linkPx: 1,
  linkTracePx: 2,
  /** A graph that fits comfortably sits at life size; it is never magnified to
   *  fill the canvas, which is what made a hundred genes shout. */
  maxFitZoom: 1,
  minZoom: 0.05,
  maxZoom: 4,
  /** Roughly this many gene names on screen at once: enough to orient, few
   *  enough that the picture is a figure and not a word search. */
  labelsPerSqrtNode: 2.2,
  fitPadding: 44,
} as const;

export type NetworkTheme = typeof NETWORK_THEME;
