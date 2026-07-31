from __future__ import annotations

import math
import re
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path

from .services.tf_reference_service import (
    load_species_tf_reference,
    normalize_tf_identifier,
)


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
    (
        "s_cerevisiae",
        "S. cerevisiae",
        re.compile(r"^Y[A-P][LR]\d{3}[WC](?:-[A-Z])?$", re.IGNORECASE),
    ),
)

SPECIES_LABELS = {
    species: label for species, label, _pattern in SPECIES_GENE_ID_PATTERNS
}


def _infer_from_species_coded_ids(gene_names: list[str]) -> dict | None:
    """Infer species from database identifiers that encode it directly."""

    counts = {species: 0 for species, _label, _pattern in SPECIES_GENE_ID_PATTERNS}
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
        "label": SPECIES_LABELS[species],
        "confidence": round(confidence, 4),
        "evidence_count": evidence_count,
        "recognized_count": recognized_count,
        "basis": "species_coded_gene_identifiers",
    }


def _infer_from_tf_references(
    gene_names: list[str],
    *,
    reference_root: Path | None = None,
) -> dict | None:
    """Infer species from TF identifiers that occur in only one reference.

    Shared TF symbols carry no vote. This prevents large cross-species overlaps
    from making a common symbol look like species-specific evidence.
    """

    reference_memberships = _load_reference_memberships(reference_root)

    unique_gene_names = {
        str(gene_name).strip() for gene_name in gene_names if str(gene_name).strip()
    }
    counts = {species: 0 for species in SPECIES_LABELS}
    discriminating_count = 0
    matched_reference_count = 0

    for gene_name in unique_gene_names:
        memberships = reference_memberships.get(normalize_tf_identifier(gene_name))
        if not memberships:
            continue
        matched_reference_count += 1
        if len(memberships) != 1:
            continue
        counts[next(iter(memberships))] += 1
        discriminating_count += 1

    # Small targeted matrices can still be inferred from three independent
    # matches. Larger matrices must provide more evidence, capped at 20 genes.
    minimum_evidence = max(
        3,
        min(20, math.ceil(len(unique_gene_names) * 0.01)),
    )
    if discriminating_count < minimum_evidence:
        return None

    species, evidence_count = max(counts.items(), key=lambda item: item[1])
    confidence = evidence_count / discriminating_count
    if confidence < 0.9:
        return None

    return {
        "species": species,
        "label": SPECIES_LABELS[species],
        "confidence": round(confidence, 4),
        "evidence_count": evidence_count,
        "recognized_count": matched_reference_count,
        "discriminating_count": discriminating_count,
        "basis": "species_specific_tf_reference_matches",
    }


@lru_cache(maxsize=16)
def _load_reference_memberships(
    reference_root: Path | None,
) -> dict[str, frozenset[str]]:
    """Load each installed reference once per backend process."""

    mutable_memberships: dict[str, set[str]] = {}
    for species in SPECIES_LABELS:
        identifiers, metadata = load_species_tf_reference(
            species,
            reference_root=reference_root,
        )
        if metadata.get("status") != "available":
            continue
        for identifier in identifiers:
            key = normalize_tf_identifier(identifier)
            if key:
                mutable_memberships.setdefault(key, set()).add(species)
    return {
        identifier: frozenset(species)
        for identifier, species in mutable_memberships.items()
    }


def infer_species_from_gene_names(
    gene_names: Iterable[str],
    *,
    reference_root: Path | None = None,
) -> dict | None:
    """Infer a species conservatively from database IDs or TF references."""

    names = [str(gene_name).strip() for gene_name in gene_names]
    return _infer_from_species_coded_ids(names) or _infer_from_tf_references(
        names,
        reference_root=reference_root,
    )
