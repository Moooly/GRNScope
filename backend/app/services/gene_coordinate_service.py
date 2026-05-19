from pathlib import Path
import csv
from functools import lru_cache
import re
from typing import TypedDict

BASE_DIR = Path(__file__).resolve().parents[2]
GENE_COORDINATES_PATH = BASE_DIR / "data" / "gene_coordinates.csv"

VERSIONED_GENE_ID_PATTERN = re.compile(r"^(ENS[A-Z]*G\d+)\.\d+$", re.IGNORECASE)
TRANSCRIPT_SUFFIX_PATTERNS = (
    re.compile(r"^(.+)[._-](?:\d{3,}|T\d+|t\d+)$"),
    re.compile(r"^(.+)[._-](?:isoform|transcript)[._-]?\d+$", re.IGNORECASE),
    re.compile(r"^(.+)-R[A-Z]$"),
)


class GeneCoordinateIndex(TypedDict):
    coordinates: dict[str, dict]
    exact_aliases: dict[str, str]
    casefold_aliases: dict[str, str]


@lru_cache(maxsize=1)
def load_gene_coordinate_index() -> GeneCoordinateIndex:
    coordinates: dict[str, dict] = {}
    exact_aliases: dict[str, str] = {}
    casefold_aliases: dict[str, str] = {}

    def register_alias(alias: str | None, gene_name: str) -> None:
        alias = (alias or "").strip()
        if not alias:
            return

        exact_aliases.setdefault(alias, gene_name)
        casefold_aliases.setdefault(alias.casefold(), gene_name)

        version_match = VERSIONED_GENE_ID_PATTERN.match(alias)
        if version_match:
            versionless_alias = version_match.group(1)
            exact_aliases.setdefault(versionless_alias, gene_name)
            casefold_aliases.setdefault(versionless_alias.casefold(), gene_name)

    with open(GENE_COORDINATES_PATH, "r", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        for row in reader:
            gene_name = row.get("gene_name", "").strip()
            if not gene_name:
                continue

            # If duplicate gene names exist, keep the first one.
            # You can improve this later by preferring protein_coding genes.
            if gene_name in coordinates:
                continue

            try:
                coordinates[gene_name] = {
                    "gene_name": gene_name,
                    "chromosome": row.get("chromosome", "").strip(),
                    "start": int(row.get("start", 0)),
                    "end": int(row.get("end", 0)),
                    "strand": row.get("strand", "").strip(),
                    "gene_type": row.get("gene_type", "").strip(),
                    "gene_id": row.get("gene_id", "").strip(),
                }
                register_alias(gene_name, gene_name)
                register_alias(row.get("gene_id", ""), gene_name)
            except ValueError:
                continue

    return {
        "coordinates": coordinates,
        "exact_aliases": exact_aliases,
        "casefold_aliases": casefold_aliases,
    }


def load_gene_coordinates() -> dict[str, dict]:
    return load_gene_coordinate_index()["coordinates"]


def _clean_gene_name(gene_name: str) -> str:
    return gene_name.strip().strip('"').strip("'").strip()


def _split_gene_tokens(gene_name: str) -> list[str]:
    tokens = re.split(r"[|,;:\s]+", gene_name)
    return [_clean_gene_name(token) for token in tokens if _clean_gene_name(token)]


def _transcript_base_candidates(gene_name: str) -> list[str]:
    candidates: list[str] = []

    for pattern in TRANSCRIPT_SUFFIX_PATTERNS:
        match = pattern.match(gene_name)
        if match:
            candidates.append(_clean_gene_name(match.group(1)))

    return candidates


def _resolve_gene_name(gene_name: str) -> tuple[str, str] | None:
    query = _clean_gene_name(gene_name)
    if not query:
        return None

    index = load_gene_coordinate_index()
    exact_aliases = index["exact_aliases"]
    casefold_aliases = index["casefold_aliases"]

    if query in exact_aliases:
        return exact_aliases[query], "exact"

    version_match = VERSIONED_GENE_ID_PATTERN.match(query)
    if version_match:
        versionless_query = version_match.group(1)
        if versionless_query in exact_aliases:
            return exact_aliases[versionless_query], "versionless_gene_id"

    casefold_match = casefold_aliases.get(query.casefold())
    if casefold_match:
        return casefold_match, "case_insensitive"

    for token in _split_gene_tokens(query):
        if token in exact_aliases:
            return exact_aliases[token], "token"
        casefold_match = casefold_aliases.get(token.casefold())
        if casefold_match:
            return casefold_match, "token_case_insensitive"

    for candidate in _transcript_base_candidates(query):
        if candidate in exact_aliases:
            return exact_aliases[candidate], "transcript_base"
        casefold_match = casefold_aliases.get(candidate.casefold())
        if casefold_match:
            return casefold_match, "transcript_base_case_insensitive"

    return None


def get_gene_coordinate(gene_name: str) -> dict | None:
    resolved = _resolve_gene_name(gene_name)
    if not resolved:
        return None

    matched_gene_name, match_type = resolved
    coordinate = load_gene_coordinate_index()["coordinates"].get(matched_gene_name)
    if not coordinate:
        return None

    result = dict(coordinate)
    result["matched_gene_name"] = matched_gene_name
    result["coordinate_match"] = match_type
    return result
