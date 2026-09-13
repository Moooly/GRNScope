import { NETWORK_SCALE } from "./theme";

/**
 * The visual model: what the reader can see, and what each thing means.
 *
 * There are four channels and they never change meaning, at any graph size:
 *
 *   position  where the layout put it -- neighbourhoods, not coordinates
 *   size      how many displayed relationships a gene takes part in
 *   ring      whether the gene is a transcription factor
 *   accent    what you have selected, and what it reaches
 *
 * Everything else -- link weight, opacity, label presence -- is legibility,
 * not meaning, and is computed from how crowded the view happens to be.
 *
 * The old canvas had two complete encodings that swapped at sixty nodes, plus
 * a density switch at sixty edges and a third branch above eight hundred. A
 * reader crossing any of those boundaries had to relearn the picture, and the
 * legend could not describe both sides at once. Here every function below is
 * continuous in node count: nothing swaps, things only grow or fade.
 */

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * Node diameter from degree, in MODEL units -- deliberately not in pixels.
 *
 * Everything else here is budgeted in rendered pixels, and node size cannot
 * be, because it is the one property that feeds back into its own input:
 * a bigger node makes a bigger graph extent, which lowers the zoom that
 * fitting produces, which makes the node smaller again. Chasing a pixel target
 * through that loop either oscillates or runs away -- the first attempt piled
 * every disc on top of its neighbours.
 *
 * Fixing size in model units breaks the loop, and the pixel result still comes
 * out right, because the layout below spaces nodes proportionally to their
 * size. The extent then grows like sqrt(n) times the node size, so the fit
 * zoom falls like 1/sqrt(n) and the rendered diameter settles at roughly
 * canvas / sqrt(n) at every scale. More genes means smaller discs, which is
 * both unavoidable and correct.
 *
 * Square root because the eye compares a disc's area, not its width: four
 * links should look twice as big as one.
 */
export function nodeDiameterModel(
  degree: number,
  maxDegree: number,
  minDegree = 1,
) {
  if (!(maxDegree > 0)) return NETWORK_SCALE.nodeMinModel;
  // Normalised against the range actually present, not against zero. Dividing
  // by sqrt(maxDegree) alone meant a graph whose degrees ran 1..20 produced
  // diameters from 21 to 58 -- under three times, where the whole budget is
  // nearly six. The hierarchy that lets you find the hubs without reading
  // anything was being spent on empty headroom below the smallest gene.
  const lo = Math.sqrt(Math.max(0, Math.min(minDegree, maxDegree)));
  const hi = Math.sqrt(Math.max(0, maxDegree));
  const span = hi - lo;
  const share =
    span <= 0 ? 0 : clamp((Math.sqrt(Math.max(0, degree)) - lo) / span, 0, 1);
  return (
    NETWORK_SCALE.nodeMinModel +
    (NETWORK_SCALE.nodeMaxModel - NETWORK_SCALE.nodeMinModel) * share
  );
}

/**
 * How long an edge wants to be, as a multiple of the base length.
 *
 * This is the whole difference between a galaxy and a mesh. A force layout
 * given one ideal length for every edge produces exactly one length scale, and
 * a network drawn at one scale is an even fabric -- which is what ours was.
 * The reference figures have two: a leaf sits close against the hub it hangs
 * off, forming a tight corona, while hub links stretch long and become the
 * filaments those coronas sit on. The eye reads the coronas as objects and the
 * filaments as the relationships between them, and that is the structure.
 */
export function edgeLengthFactor(minEndpointDegree: number) {
  if (minEndpointDegree <= 1) return 0.42;
  if (minEndpointDegree <= 2) return 0.66;
  if (minEndpointDegree <= 4) return 1;
  return 1 + 0.95 * clamp((minEndpointDegree - 4) / 8, 0, 1);
}

/** Leaf spokes hold their length; long hub links are free to stretch. */
export function edgeElasticityFor(minEndpointDegree: number) {
  return minEndpointDegree <= 1 ? 0.75 : minEndpointDegree <= 4 ? 0.5 : 0.25;
}

/** Mean node diameter, used to space the layout proportionally to the nodes
 *  so the rendered result is consistent across graph sizes. */
export function meanNodeDiameterModel() {
  return (NETWORK_SCALE.nodeMinModel + NETWORK_SCALE.nodeMaxModel) / 2;
}

/**
 * Label size in rendered pixels. Hubs get a little more weight than leaves,
 * but the whole spread stays inside the legible band -- a label is a name, not
 * a measurement, so it should not be carrying the degree signal that the node
 * is already carrying much better.
 */
export function labelSizePx(degree: number, maxDegree: number) {
  if (!(maxDegree > 0)) return NETWORK_SCALE.labelMinPx;
  const share = clamp(Math.sqrt(Math.max(0, degree)) / Math.sqrt(maxDegree), 0, 1);
  return (
    NETWORK_SCALE.labelMinPx +
    (NETWORK_SCALE.labelMaxPx - NETWORK_SCALE.labelMinPx) * share
  );
}

/**
 * How many gene names to show at once. Grows with the square root of the graph
 * so a big network gets more landmarks without ever getting a name on every
 * node -- the point of a label here is orientation, and past a couple of dozen
 * simultaneous words the reader is searching rather than seeing.
 */
export function labelBudget(nodeCount: number) {
  if (nodeCount <= 40) return nodeCount;
  return Math.max(
    14,
    Math.round(Math.sqrt(nodeCount) * NETWORK_SCALE.labelsPerSqrtNode),
  );
}

/**
 * Link opacity. Not meaning -- crowding. Twenty links can each be distinct;
 * four hundred have to thin out or they paint over the nodes entirely. The
 * floor is high enough that a link is always a line you can follow: faded to
 * near-nothing, the graph stops showing its own structure.
 */
export function linkOpacity(edgeCount: number) {
  if (edgeCount <= 60) return 0.85;
  if (edgeCount >= 400) return 0.45;
  const t = (edgeCount - 60) / 340;
  return 0.85 - t * 0.4;
}

/**
 * Link width in rendered pixels, from evidence.
 *
 * Width is the right channel for a continuous strength: it survives being one
 * of four hundred, it reads at a glance without a key, and it composes with
 * colour rather than fighting it. The old design put this in the arrowhead
 * instead and dropped width entirely, which meant that on an undirected run --
 * where there is no arrowhead to draw -- strength rendered as nothing at all.
 */
export function linkWidthPx(evidence: number, edgeCount: number) {
  const strength = clamp(Number.isFinite(evidence) ? evidence : 0.5, 0, 1);
  // Busy views get a slightly finer pen so the extra weight does not close the
  // gaps between links, but never so fine that the range stops being visible.
  const ceiling = edgeCount >= 300 ? 2 : edgeCount >= 120 ? 2.4 : 2.9;
  return 0.8 + (ceiling - 0.8) * strength;
}

/**
 * Model-space value that renders at `px` under the current zoom. Every size in
 * the stylesheet goes through here, which is the whole reason the same numbers
 * mean the same thing at five genes and five thousand.
 */
export function modelUnits(px: number, zoom: number) {
  return px / Math.max(zoom, 0.001);
}

/** Keep `fit()` from magnifying a small graph past life size. */
export function clampFitZoom(zoom: number) {
  return Math.min(zoom, NETWORK_SCALE.maxFitZoom);
}
