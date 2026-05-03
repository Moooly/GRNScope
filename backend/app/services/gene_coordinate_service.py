from pathlib import Path
import csv
from functools import lru_cache

BASE_DIR = Path(__file__).resolve().parents[2]
GENE_COORDINATES_PATH = BASE_DIR / "data" / "gene_coordinates.csv"


@lru_cache(maxsize=1)
def load_gene_coordinates() -> dict[str, dict]:
    coordinates: dict[str, dict] = {}

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
                    "chromosome": row.get("chromosome", "").strip(),
                    "start": int(row.get("start", 0)),
                    "end": int(row.get("end", 0)),
                    "strand": row.get("strand", "").strip(),
                    "gene_type": row.get("gene_type", "").strip(),
                    "gene_id": row.get("gene_id", "").strip(),
                }
            except ValueError:
                continue

    return coordinates


def get_gene_coordinate(gene_name: str) -> dict | None:
    return load_gene_coordinates().get(gene_name)