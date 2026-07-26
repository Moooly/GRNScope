from __future__ import annotations

import csv
import hashlib
from pathlib import Path
import re
from typing import Iterable


TF_REFERENCE_SCHEMA_VERSION = 2

_ENSEMBL_GENE_ID = re.compile(
    r"^(ENS[A-Z0-9]*G[0-9]+)(?:\.[0-9]+)?$",
    re.IGNORECASE,
)
_FLYBASE_GENE_ID = re.compile(r"^FBGN[0-9]+$", re.IGNORECASE)
_WORMBASE_GENE_ID = re.compile(r"^WBGENE[0-9]+$", re.IGNORECASE)
_YEAST_SYSTEMATIC_ID = re.compile(
    r"^Y[A-P][LR][0-9]{3}[WC](?:-[A-Z])?$",
    re.IGNORECASE,
)


def _default_reference_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _normalized_species(value: object) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def _candidate_paths(species: str, root: Path) -> list[Path]:
    candidates = [
        root / "data" / "tf_gene_names" / f"{species}.csv",
        root / "data" / "tf_gene_names" / f"{species}.txt",
        root / "reference" / "tf_gene_names" / f"{species}.csv",
        root / "reference" / "tf_gene_names" / f"{species}.txt",
        root / "data" / f"{species}_tf_gene_names.csv",
        root / "data" / f"{species}_tf_gene_names.txt",
        root / "reference" / f"{species}_tf_gene_names.csv",
        root / "reference" / f"{species}_tf_gene_names.txt",
    ]
    if species == "human":
        candidates.extend(
            [
                root / "data" / "known_tf_gene_names.txt",
                root / "reference" / "known_tf_gene_names.txt",
                root / "data" / "human_tf_gene_names.txt",
                root / "reference" / "human_tf_gene_names.txt",
            ]
        )
    return candidates


def normalize_tf_identifier(value: object) -> str:
    """Return a comparison key without changing user-facing identifiers."""

    identifier = str(value or "").strip()
    if not identifier:
        return ""

    ensembl_match = _ENSEMBL_GENE_ID.fullmatch(identifier)
    if ensembl_match:
        # Version suffixes describe the same stable Ensembl gene.
        return ensembl_match.group(1).upper()
    if (
        _FLYBASE_GENE_ID.fullmatch(identifier)
        or _WORMBASE_GENE_ID.fullmatch(identifier)
        or _YEAST_SYSTEMATIC_ID.fullmatch(identifier)
    ):
        return identifier.upper()

    # Gene-symbol case remains significant. This is necessary for references
    # such as zebrafish, which contain valid case-distinct symbols.
    return identifier


def match_known_tf_identifiers(
    expression_identifiers: Iterable[object],
    reference_identifiers: Iterable[object],
) -> set[str]:
    """Return original matrix identifiers that match any TF-reference alias."""

    reference_keys = {
        normalized
        for value in reference_identifiers
        if (normalized := normalize_tf_identifier(value))
    }
    return {
        str(value)
        for value in expression_identifiers
        if normalize_tf_identifier(value) in reference_keys
    }


def _load_csv_reference(path: Path) -> tuple[list[str], dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        field_lookup = {
            str(field or "").strip().lower(): field
            for field in (reader.fieldnames or [])
        }
        symbol_field = field_lookup.get("gene_symbol")
        identifier_field = (
            field_lookup.get("reference_gene_id")
            or field_lookup.get("ensembl_gene_id")
        )
        if symbol_field is None:
            raise ValueError(
                f"TF reference {path} must contain a gene_symbol column."
            )

        symbols: list[str] = []
        reference_ids: list[str] = []
        aliases: list[str] = []
        for row in reader:
            symbol = str(row.get(symbol_field) or "").strip()
            reference_id = (
                str(row.get(identifier_field) or "").strip()
                if identifier_field
                else ""
            )
            if symbol:
                symbols.append(symbol)
                aliases.append(symbol)
            if reference_id:
                reference_ids.append(reference_id)
                aliases.append(reference_id)

    unique_symbols = list(dict.fromkeys(symbols))
    unique_reference_ids = list(dict.fromkeys(reference_ids))
    unique_aliases = list(dict.fromkeys(aliases))
    return unique_aliases, {
        "gene_count": len(unique_symbols),
        "identifier_count": len(unique_aliases),
        "symbol_count": len(unique_symbols),
        "reference_gene_id_count": len(unique_reference_ids),
        "supported_identifier_types": [
            "gene_symbol",
            *(["reference_gene_id"] if unique_reference_ids else []),
        ],
    }


def _load_text_reference(path: Path) -> tuple[list[str], dict]:
    genes = list(
        dict.fromkeys(
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    )
    return genes, {
        "gene_count": len(genes),
        "identifier_count": len(genes),
        "symbol_count": len(genes),
        "reference_gene_id_count": 0,
        "supported_identifier_types": ["gene_symbol"],
    }


def load_species_tf_reference(
    dataset_species: object,
    *,
    reference_root: Path | None = None,
) -> tuple[list[str], dict]:
    """Load a TF reference only when it matches the selected dataset species."""

    species = _normalized_species(dataset_species)
    root = reference_root or _default_reference_root()

    for path in _candidate_paths(species, root):
        if not path.is_file():
            continue

        if path.suffix.lower() == ".csv":
            identifiers, counts = _load_csv_reference(path)
        else:
            identifiers, counts = _load_text_reference(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return identifiers, {
            "schema_version": TF_REFERENCE_SCHEMA_VERSION,
            "species": species,
            "status": "available",
            **counts,
            "source_filename": path.name,
            "sha256": digest,
        }

    return [], {
        "schema_version": TF_REFERENCE_SCHEMA_VERSION,
        "species": species,
        "status": "unavailable",
        "gene_count": 0,
        "identifier_count": 0,
        "symbol_count": 0,
        "reference_gene_id_count": 0,
        "supported_identifier_types": [],
        "source_filename": None,
        "sha256": None,
    }


def load_custom_tf_reference(
    path: Path,
    *,
    dataset_species: object = "other",
) -> tuple[list[str], dict]:
    """Load a user-provided TF reference using the bundled CSV schema."""

    if path.suffix.lower() != ".csv":
        raise ValueError("Custom TF list must be a CSV file.")

    identifiers, counts = _load_csv_reference(path)
    if not identifiers:
        raise ValueError(
            "Custom TF list must contain at least one non-empty gene_symbol."
        )

    return identifiers, {
        "schema_version": TF_REFERENCE_SCHEMA_VERSION,
        "species": _normalized_species(dataset_species),
        "status": "available",
        "source": "user_upload",
        **counts,
        "source_filename": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
