import type { GenomeReference } from "./types";

export function normalizeChromosome(value?: string | null) {
  const name = String(value ?? "").trim().replace(/^chr/i, "");
  if (!name) return "";
  if (/^(m|mt)$/i.test(name)) return "chrM";
  if (/^[xy]$/i.test(name)) return `chr${name.toUpperCase()}`;
  return `chr${/^\d+$/.test(name) ? Number(name) : name}`;
}

export function coordinateMatchesReference(
  coordinate: { chromosome?: string | null; start?: number | null; coordinate_species?: string | null; coordinate_assembly?: string | null } | null | undefined,
  reference: GenomeReference | null | undefined,
) {
  return Boolean(reference && coordinate &&
    coordinate.coordinate_species === reference.species &&
    coordinate.coordinate_assembly === reference.assembly &&
    reference.chromosome_order.includes(normalizeChromosome(coordinate.chromosome)) &&
    typeof coordinate.start === "number" && Number.isFinite(coordinate.start) && coordinate.start >= 1);
}

/** Coordinate payloads must agree with the declared project species. */
export function referenceForProject(reference: GenomeReference | null | undefined, species: string | null | undefined) {
  const declared = String(species ?? "").trim().toLowerCase();
  if (!reference || reference.species !== declared) return null;
  if ((declared === "human" && reference.assembly !== "GRCh38") ||
      (declared === "mouse" && reference.assembly !== "GRCm39") ||
      !["human", "mouse"].includes(declared) || !Array.isArray(reference.chromosome_order) ||
      !reference.chromosome_order.length || !reference.chromosome_order.every((chr) => typeof chr === "string")) return null;
  return reference;
}
