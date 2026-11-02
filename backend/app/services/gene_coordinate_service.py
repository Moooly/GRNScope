from pathlib import Path
import csv
from functools import lru_cache
import gzip
import re
from typing import TypedDict

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
GENE_COORDINATES_PATH = DATA_DIR / "gene_coordinates.csv"
GENCODE_REFERENCE_DIR = DATA_DIR / "gencode_reference"
GENCODE_GENE_COORDINATES_PATH = (
    GENCODE_REFERENCE_DIR / "gencode_v50_gene_coordinates.tsv"
)
GENCODE_TRANSCRIPT_COORDINATES_PATH = (
    GENCODE_REFERENCE_DIR / "gencode_v50_transcript_coordinates.tsv.gz"
)
GENE_COORDINATE_PATHS = (
    GENE_COORDINATES_PATH,
    GENCODE_GENE_COORDINATES_PATH,
)

MOUSE_GENE_COORDINATES_PATH = GENCODE_REFERENCE_DIR / "gencode_vM39_gene_coordinates.tsv.gz"
MOUSE_TRANSCRIPT_COORDINATES_PATH = GENCODE_REFERENCE_DIR / "gencode_vM39_transcript_coordinates.tsv.gz"
REFERENCE_METADATA = {
    "human": {"species": "human", "assembly": "GRCh38", "annotation": "GENCODE v50",
              "chromosome_order": [*[f"chr{i}" for i in range(1, 23)], "chrX", "chrY", "chrM"]},
    "mouse": {"species": "mouse", "assembly": "GRCm39", "annotation": "GENCODE M39",
              "chromosome_order": [*[f"chr{i}" for i in range(1, 20)], "chrX", "chrY", "chrM"]},
}


def normalize_coordinate_species(species: str | None) -> str | None:
    value = str(species or "").strip().lower()
    return value if value in REFERENCE_METADATA else None


def get_coordinate_reference(species: str | None) -> dict | None:
    normalized = normalize_coordinate_species(species)
    return {**REFERENCE_METADATA[normalized], "chromosome_order": list(REFERENCE_METADATA[normalized]["chromosome_order"])} if normalized else None


def project_coordinate_species(manifest: dict) -> str | None:
    # An explicit project species is required. CellOracle defaults and shared
    # symbols are not evidence that a dataset is human.
    preprocessing = manifest.get("preprocessing")
    value = preprocessing.get("dataset_species") if isinstance(preprocessing, dict) else None
    return normalize_coordinate_species(value or manifest.get("dataset_species"))


VERSIONED_ENSEMBL_ID_PATTERN = re.compile(
    r"^(ENS[A-Z]*[GT]\d+)\.\d+$",
    re.IGNORECASE,
)
TRANSCRIPT_SUFFIX_PATTERNS = (
    re.compile(r"^(.+)[._-](?:\d{3,}|T\d+|t\d+)$"),
    re.compile(r"^(.+)[._-](?:isoform|transcript)[._-]?\d+$", re.IGNORECASE),
    re.compile(r"^(.+)-R[A-Z]$"),
)
CURATED_GENE_ALIASES = {
    # Dataset-level WT1 isoform labels used in the sex-determination demo.
    # They are not GENCODE gene symbols, but both represent WT1 isoforms.
    "wt1pkts": "WT1",
    "wt1mkts": "WT1",
}


class GeneCoordinateIndex(TypedDict):
    coordinates: dict[str, dict]
    exact_aliases: dict[str, str]
    casefold_aliases: dict[str, str]


class TranscriptCoordinateIndex(TypedDict):
    coordinates: dict[str, dict]
    exact_aliases: dict[str, str]
    casefold_aliases: dict[str, str]


def iter_coordinate_rows(path: Path):
    if not path.exists() or not path.is_file():
        return

    name = path.name.lower()
    delimiter = "\t" if ".tsv" in name else ","
    open_file = gzip.open if path.suffix.lower() == ".gz" else Path.open

    with open_file(path, "rt", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter=delimiter)
        yield from reader


def register_alias(
    *,
    exact_aliases: dict[str, str],
    casefold_aliases: dict[str, str],
    alias: str | None,
    target_key: str,
) -> None:
    alias = (alias or "").strip()
    if not alias:
        return

    exact_aliases.setdefault(alias, target_key)
    casefold_aliases.setdefault(alias.casefold(), target_key)

    version_match = VERSIONED_ENSEMBL_ID_PATTERN.match(alias)
    if version_match:
        versionless_alias = version_match.group(1)
        exact_aliases.setdefault(versionless_alias, target_key)
        casefold_aliases.setdefault(versionless_alias.casefold(), target_key)


@lru_cache(maxsize=2)
def load_gene_coordinate_index(species: str) -> GeneCoordinateIndex:
    coordinates: dict[str, dict] = {}
    exact_aliases: dict[str, str] = {}
    casefold_aliases: dict[str, str] = {}

    reference = get_coordinate_reference(species)
    paths = GENE_COORDINATE_PATHS if species == "human" else (MOUSE_GENE_COORDINATES_PATH,) if species == "mouse" else ()
    for source_path in paths:
        source_name = source_path.name
        reader = iter_coordinate_rows(source_path)
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
                    "coordinate_source": source_name,
                    "coordinate_species": species,
                    "coordinate_assembly": reference["assembly"],
                }
            except ValueError:
                continue

            register_alias(
                exact_aliases=exact_aliases,
                casefold_aliases=casefold_aliases,
                alias=gene_name,
                target_key=gene_name,
            )
            register_alias(
                exact_aliases=exact_aliases,
                casefold_aliases=casefold_aliases,
                alias=row.get("gene_id", ""),
                target_key=gene_name,
            )
            register_alias(
                exact_aliases=exact_aliases,
                casefold_aliases=casefold_aliases,
                alias=row.get("gene_id_base", ""),
                target_key=gene_name,
            )

    return {
        "coordinates": coordinates,
        "exact_aliases": exact_aliases,
        "casefold_aliases": casefold_aliases,
    }


@lru_cache(maxsize=2)
def load_transcript_coordinate_index(species: str) -> TranscriptCoordinateIndex:
    coordinates: dict[str, dict] = {}
    exact_aliases: dict[str, str] = {}
    casefold_aliases: dict[str, str] = {}

    reference = get_coordinate_reference(species)
    path = GENCODE_TRANSCRIPT_COORDINATES_PATH if species == "human" else MOUSE_TRANSCRIPT_COORDINATES_PATH if species == "mouse" else None
    reader = iter_coordinate_rows(path) if path is not None else ()
    for row in reader:
        parent_gene_name = row.get("gene_name", "").strip()
        transcript_id = row.get("transcript_id", "").strip()
        transcript_id_base = row.get("transcript_id_base", "").strip()
        transcript_name = row.get("transcript_name", "").strip()
        transcript_key = transcript_id or transcript_id_base or transcript_name

        if not parent_gene_name or not transcript_key:
            continue

        if transcript_key in coordinates:
            continue

        try:
            coordinates[transcript_key] = {
                "gene_name": parent_gene_name,
                "chromosome": row.get("chromosome", "").strip(),
                "start": int(row.get("start", 0)),
                "end": int(row.get("end", 0)),
                "strand": row.get("strand", "").strip(),
                "gene_type": row.get("gene_type", "").strip(),
                "gene_id": row.get("gene_id", "").strip(),
                "transcript_id": transcript_id,
                "transcript_name": transcript_name,
                "transcript_type": row.get("transcript_type", "").strip(),
                "coordinate_source": path.name,
                "coordinate_species": species,
                "coordinate_assembly": reference["assembly"],
            }
        except ValueError:
            continue

        for alias in (transcript_id, transcript_id_base, transcript_name):
            register_alias(
                exact_aliases=exact_aliases,
                casefold_aliases=casefold_aliases,
                alias=alias,
                target_key=transcript_key,
            )

    return {
        "coordinates": coordinates,
        "exact_aliases": exact_aliases,
        "casefold_aliases": casefold_aliases,
    }


def load_gene_coordinates(species: str) -> dict[str, dict]:
    return load_gene_coordinate_index(species)["coordinates"]


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


def _resolve_gene_name(gene_name: str, species: str) -> tuple[str, str] | None:
    query = _clean_gene_name(gene_name)
    if not query:
        return None

    index = load_gene_coordinate_index(species)
    exact_aliases = index["exact_aliases"]
    casefold_aliases = index["casefold_aliases"]

    if query in exact_aliases:
        return exact_aliases[query], "exact"

    curated_alias = CURATED_GENE_ALIASES.get(query.casefold()) if species == "human" else None
    if curated_alias:
        target = exact_aliases.get(curated_alias)
        if target:
            return target, "curated_alias"

    version_match = VERSIONED_ENSEMBL_ID_PATTERN.match(query)
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

    return None


def _resolve_transcript_coordinate(gene_name: str, species: str) -> tuple[dict, str] | None:
    query = _clean_gene_name(gene_name)
    if not query:
        return None

    index = load_transcript_coordinate_index(species)
    coordinates = index["coordinates"]
    exact_aliases = index["exact_aliases"]
    casefold_aliases = index["casefold_aliases"]

    def lookup_alias(alias: str, match_type: str) -> tuple[dict, str] | None:
        transcript_key = exact_aliases.get(alias)
        if transcript_key:
            coordinate = coordinates.get(transcript_key)
            if coordinate:
                return coordinate, match_type

        version_match = VERSIONED_ENSEMBL_ID_PATTERN.match(alias)
        if version_match:
            versionless_alias = version_match.group(1)
            transcript_key = exact_aliases.get(versionless_alias)
            if transcript_key:
                coordinate = coordinates.get(transcript_key)
                if coordinate:
                    return coordinate, f"{match_type}_versionless"

        transcript_key = casefold_aliases.get(alias.casefold())
        if transcript_key:
            coordinate = coordinates.get(transcript_key)
            if coordinate:
                return coordinate, f"{match_type}_case_insensitive"

        return None

    direct_match = lookup_alias(query, "transcript")
    if direct_match:
        return direct_match

    for token in _split_gene_tokens(query):
        token_match = lookup_alias(token, "transcript_token")
        if token_match:
            return token_match

    return None


def _resolve_transcript_base_gene_name(gene_name: str, species: str) -> tuple[str, str] | None:
    query = _clean_gene_name(gene_name)
    if not query:
        return None

    index = load_gene_coordinate_index(species)
    exact_aliases = index["exact_aliases"]
    casefold_aliases = index["casefold_aliases"]

    for candidate in _transcript_base_candidates(query):
        if candidate in exact_aliases:
            return exact_aliases[candidate], "transcript_base"
        casefold_match = casefold_aliases.get(candidate.casefold())
        if casefold_match:
            return casefold_match, "transcript_base_case_insensitive"

    return None


def get_gene_coordinate(gene_name: str, species: str | None) -> dict | None:
    species = normalize_coordinate_species(species)
    if species is None:
        return None
    # Species-coded Ensembl gene/transcript IDs cannot be reinterpreted via
    # another reference (and should not trigger its large transcript index).
    for token in _split_gene_tokens(gene_name):
        identifier = re.fullmatch(r"ENS([A-Z]*?)[GT]\d+(?:\.\d+)?", token, re.IGNORECASE)
        if identifier and {"": "human", "MUS": "mouse"}.get(identifier.group(1).upper()) != species:
            return None
    resolved = _resolve_gene_name(gene_name, species)
    if resolved:
        matched_gene_name, match_type = resolved
        coordinate = load_gene_coordinate_index(species)["coordinates"].get(matched_gene_name)
        if coordinate:
            result = dict(coordinate)
            result["matched_gene_name"] = matched_gene_name
            result["coordinate_match"] = match_type
            return result

    transcript_resolved = _resolve_transcript_coordinate(gene_name, species)
    if transcript_resolved:
        coordinate, match_type = transcript_resolved
        result = dict(coordinate)
        result["matched_gene_name"] = str(coordinate.get("gene_name", ""))
        result["matched_transcript_id"] = str(coordinate.get("transcript_id", ""))
        result["matched_transcript_name"] = str(coordinate.get("transcript_name", ""))
        result["coordinate_match"] = match_type
        return result

    base_resolved = _resolve_transcript_base_gene_name(gene_name, species)
    if base_resolved:
        matched_gene_name, match_type = base_resolved
        coordinate = load_gene_coordinate_index(species)["coordinates"].get(matched_gene_name)
        if coordinate:
            result = dict(coordinate)
            result["matched_gene_name"] = matched_gene_name
            result["coordinate_match"] = match_type
            return result

    return None
