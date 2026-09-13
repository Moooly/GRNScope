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
  /** Flat, barely off-white. A gradient behind a graph competes with it. */
  ground: "#f7f9fa",
  /** Every gene, at rest. One colour, no gradient, no per-category variation. */
  node: "#8fadbd",
  /** Just enough rim to keep two touching discs apart on a light ground. */
  nodeRim: "#61879b",
  /** Genes pushed to the background while something else is traced. */
  nodeMuted: "#dbe3e8",
  /** A regulator is marked by a ring, not by its own colour or shape: the
   *  distinction has to survive being one of a hundred, and it has to cost
   *  nothing when every gene in the upload happens to be a regulator. */
  regulatorRing: "#3f6b85",
  /** Links at rest. Hairline, and lighter than the nodes so the graph reads as
   *  discs connected by threads rather than a mesh with dots caught in it. */
  link: "#c7d3db",
  linkMuted: "#e8edf0",
  /** Gene names. Subordinate to the nodes: dark enough to read, never black. */
  label: "#3a4a57",
  labelHalo: "#f7f9fa",
  /** The one accent. Selection, the neighbourhood it reaches, and nothing
   *  else -- no category ever gets to use it. */
  accent: "#0f7f72",
  accentSoft: "#bfe3dc",
  /** Reserved for the inspector and legend, never painted on the canvas at
   *  rest: activation and repression are read one relationship at a time. */
  activates: "#1f8f80",
  represses: "#c06a3c",
  unknown: "#8a97a2",
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
