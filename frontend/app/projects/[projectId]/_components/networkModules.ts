import type { NetworkEdge, NetworkNode } from "./networkGraphTypes";

/**
 * Hues for the largest regulatory modules.
 *
 * Deliberately darker and more saturated than the edge palette: at atlas scale
 * edges are thin and faded to ~0.4 opacity, so a solid bead in one of these
 * still reads as its own thing rather than blending into the lines crossing it.
 */
export const MODULE_COLORS = [
  "#2f6fa8",
  "#7b5ea6",
  "#b8527c",
  "#4a8c4a",
  "#8a6b34",
  "#3f8f96",
  "#a04f3c",
  "#5a6b8c",
];

/** Links that cross between modules. Kept neutral so the bridges between
 * territories stay visible as bridges rather than joining either side. */
export const MODULE_BRIDGE = "#b9c6d1";

/** Everything outside the largest modules. Keeping the tail neutral is what
 * stops a 2000-gene network turning into confetti. */
export const MODULE_NEUTRAL = "#9fb0bd";

/** How many modules get a hue of their own. */
export const MODULE_COLOR_LIMIT = MODULE_COLORS.length;

/**
 * Assign each gene to the regulatory hub whose influence reaches it first.
 *
 * Label propagation was tried first and is the wrong tool here: on a network
 * with strong hubs it collapses to one dominant label, and at 800 genes it put
 * 640 of them in a single module -- a colouring that says nothing.
 *
 * This instead picks the highest-degree genes as seeds and grows territories
 * from all of them at once by graph distance, so each region is "the genes
 * this master regulator reaches before any other one does". For a regulatory
 * network that is also the more interpretable notion: the territories are
 * regulons, not abstract communities. Genes beyond REACH_LIMIT hops from every
 * seed stay neutral rather than being forced into a region they barely touch.
 *
 * Deterministic: seeds are ranked by degree then id, and ties during the walk
 * go to the stronger seed, so the same network always colours the same way.
 */
const REACH_LIMIT = 4;

export function detectModules(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
): Map<string, string> {
  if (!nodes.length) return new Map();

  const neighbours = new Map<string, string[]>();
  nodes.forEach((node) => neighbours.set(node.id, []));
  edges.forEach((edge) => {
    neighbours.get(edge.source)?.push(edge.target);
    neighbours.get(edge.target)?.push(edge.source);
  });

  const degree = new Map<string, number>(
    nodes.map((node) => [node.id, neighbours.get(node.id)?.length ?? 0]),
  );

  // Transcription factors win ties: a regulon is named after its regulator.
  const seeds = [...nodes]
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        Number(!!b.isTF) - Number(!!a.isTF) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, MODULE_COLOR_LIMIT)
    .filter((node) => (degree.get(node.id) ?? 0) >= 3);

  const owner = new Map<string, number>();
  const depth = new Map<string, number>();
  let frontier: string[] = [];
  seeds.forEach((seed, index) => {
    owner.set(seed.id, index);
    depth.set(seed.id, 0);
    frontier.push(seed.id);
  });

  // Multi-source breadth-first walk: every gene falls to its nearest seed.
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      const here = depth.get(id) ?? 0;
      if (here >= REACH_LIMIT) continue;
      const claim = owner.get(id);
      if (claim === undefined) continue;
      for (const other of neighbours.get(id) ?? []) {
        const held = owner.get(other);
        if (held === undefined) {
          owner.set(other, claim);
          depth.set(other, here + 1);
          next.push(other);
        } else if (depth.get(other) === here + 1 && claim < held) {
          // Same distance from two seeds: the stronger seed takes it.
          owner.set(other, claim);
        }
      }
    }
    frontier = next;
  }

  const colorOf = new Map<string, string>();
  nodes.forEach((node) => {
    const index = owner.get(node.id);
    colorOf.set(
      node.id,
      index === undefined ? MODULE_NEUTRAL : MODULE_COLORS[index],
    );
  });
  return colorOf;
}

/** Move a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const target = amount >= 0 ? 255 : 0;
  const mix = Math.abs(amount);
  const channel = (offset: number) => {
    const base = parseInt(full.slice(offset, offset + 2), 16);
    return Math.round(base + (target - base) * mix)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}
