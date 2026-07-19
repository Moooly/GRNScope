from __future__ import annotations

import re
from collections.abc import Iterable


# These identifiers encode species directly. Gene symbols are intentionally not
# used here because many symbols are shared by several species.
SPECIES_GENE_ID_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("human", "Human", re.compile(r"^ENSG\d+(?:\.\d+)?$", re.IGNORECASE)),
    ("mouse", "Mouse", re.compile(r"^ENSMUSG\d+(?:\.\d+)?$", re.IGNORECASE)),
    ("rat", "Rat", re.compile(r"^ENSRNOG\d+(?:\.\d+)?$", re.IGNORECASE)),
    ("pig", "Pig", re.compile(r"^ENSSSCG\d+(?:\.\d+)?$", re.IGNORECASE)),
    ("chicken", "Chicken", re.compile(r"^ENSGALG\d+(?:\.\d+)?$", re.IGNORECASE)),
    ("zebrafish", "Zebrafish", re.compile(r"^ENSDARG\d+(?:\.\d+)?$", re.IGNORECASE)),
    (
        "xenopus_tropicalis",
        "Xenopus tropicalis",
        re.compile(r"^ENSXETG\d+(?:\.\d+)?$", re.IGNORECASE),
    ),
    ("drosophila", "Drosophila", re.compile(r"^FBGN\d+$", re.IGNORECASE)),
    ("c_elegans", "C. elegans", re.compile(r"^WBGENE\d+$", re.IGNORECASE)),
)


def infer_species_from_gene_names(gene_names: Iterable[str]) -> dict | None:
    """Infer species only from identifiers that encode species unambiguously."""
    counts = {species: 0 for species, _label, _pattern in SPECIES_GENE_ID_PATTERNS}
    labels = {species: label for species, label, _pattern in SPECIES_GENE_ID_PATTERNS}
    sampled_count = 0

    for raw_gene_name in gene_names:
        gene_name = str(raw_gene_name).strip()
        if not gene_name:
            continue
        sampled_count += 1
        for species, _label, pattern in SPECIES_GENE_ID_PATTERNS:
            if pattern.fullmatch(gene_name):
                counts[species] += 1
                break

    recognized_count = sum(counts.values())
    recognized_fraction = recognized_count / sampled_count if sampled_count else 0
    if recognized_count < 2 or recognized_fraction < 0.2:
        return None

    species, evidence_count = max(counts.items(), key=lambda item: item[1])
    confidence = evidence_count / recognized_count
    if confidence < 0.8:
        return None

    return {
        "species": species,
        "label": labels[species],
        "confidence": round(confidence, 4),
        "evidence_count": evidence_count,
        "recognized_count": recognized_count,
        "basis": "species_coded_gene_identifiers",
    }
