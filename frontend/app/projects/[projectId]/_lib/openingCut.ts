/**
 * Where the network opens: an evidence cut chosen from each project's own
 * scores, not a fixed number.
 *
 * A fixed cut (evidence ≥ 0.5) gave 71 links for 19 genes but 422 for 100
 * genes, a hairball. So the first view gets a size budget instead — about 1.5
 * links per gene, for at most ~40 genes' worth — and the cut is whatever
 * evidence value fills that budget with the strongest links, moved to a
 * natural gap in the scores when one is close. The result is an ordinary
 * "Evidence ≥ x" in Results Settings: nothing hidden, adjustable as usual.
 */
export const OPENING_CUT = {
  linksPerGene: 1.5,
  /** Genes' worth of links: past this, names inside the circles stop being readable. */
  maxGenes: 40,
  minLinks: 12,
  maxLinks: 70,
  /** Never open looser than this unless the project has fewer than minLinks above it. */
  floor: 0.5,
  /** Look for a natural gap within ±20 % of the budget. */
  gapWindow: 0.2,
  /** A gap this wide between neighbouring scores counts as natural. */
  minGap: 0.02,
} as const;

export function openingLinkBudget(geneCount: number) {
  const { linksPerGene, maxGenes, minLinks, maxLinks } = OPENING_CUT;
  return Math.max(minLinks, Math.min(maxLinks, Math.round(linksPerGene * Math.min(Math.max(geneCount, 0), maxGenes))));
}

export type OpeningCut = { threshold: number; kept: number; budget: number; total: number };

export function chooseOpeningEvidenceCut(scores: number[], geneCount: number): OpeningCut | null {
  const s = scores.filter(Number.isFinite).sort((a, b) => b - a);
  if (!s.length) return null;
  const { floor, minLinks, gapWindow, minGap } = OPENING_CUT;
  const budget = openingLinkBudget(geneCount);
  const count = (t: number) => s.filter(v => v >= t).length;
  const atFloor = count(floor);
  // Too weak to show a handful at the floor: the strongest ~minLinks.
  if (atFloor < minLinks) {
    const threshold = s[Math.min(minLinks, s.length) - 1];
    return { threshold, kept: count(threshold), budget, total: s.length };
  }
  // Already small: everything credible fits.
  if (atFloor <= budget) return { threshold: floor, kept: atFloor, budget, total: s.length };
  // Fill the budget; prefer a natural gap near its edge.
  let keep = budget;
  const lo = Math.max(minLinks, Math.round(budget * (1 - gapWindow)));
  const hi = Math.min(atFloor - 1, Math.round(budget * (1 + gapWindow)));
  let bestGap = 0;
  for (let i = lo; i <= hi; i += 1) {
    const gap = s[i - 1] - s[i];
    if (gap > bestGap + 1e-9) { bestGap = gap; keep = i; }
  }
  if (bestGap < minGap) keep = budget;
  // Round down to two decimals for a readable setting, unless ties or near
  // ties just below would flood the view; then keep the exact score.
  const exact = s[keep - 1];
  const rounded = Math.floor(exact * 100 + 1e-9) / 100;
  const threshold = Math.max(floor, count(rounded) <= Math.ceil(budget * (1 + gapWindow)) ? rounded : exact);
  return { threshold, kept: count(threshold), budget, total: s.length };
}
