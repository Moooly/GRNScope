# Circos species and coordinate references

Circos supports human and mouse projects. It uses the project's declared dataset
species, rather than inferring a reference from shared gene symbols or from the
CellOracle settings.

| Dataset species | Coordinate assembly | Annotation |
| --- | --- | --- |
| Human | GRCh38 | Existing GENCODE v50 gene/transcript references |
| Mouse | GRCm39 (mm39) | GENCODE M39 gene/transcript references |

The assembly and annotation are printed inside the Circos figure and preserved
in SVG/PNG exports. These are reference positions for the selected annotation;
the viewer does not convert coordinates between genome assemblies.

## Species boundaries

- The result API rebuilds gene-coordinate annotations using the project species.
  Previously saved coordinate fields cannot override the selected reference.
- Lookup indexes and client result caches are scoped or revalidated by species.
- Gene symbols, versioned/versionless Ensembl gene IDs, and transcript IDs use
  the corresponding species reference. Known foreign Ensembl IDs are rejected.
- Each coordinate carries `coordinate_species` and `coordinate_assembly`.
  The browser checks both before using a location.
- The API includes a `genome_reference` object with species, assembly,
  annotation, and primary chromosome order. Circos has no human-only chromosome
  length table. Human has chromosomes 1–22, mouse 1–19, followed by X, Y and M.
- Unmapped or non-primary locations appear in the Unknown group. MT and chrMT
  are normalized to chrM.
- Unsupported species, and legacy projects without a declared species, receive
  no coordinate annotations. The Circos layout button is disabled with an
  explanation. Other network layouts remain available.
- The bundled demo is explicitly annotated as human.

## Mouse reference provenance and regeneration

Source: [GENCODE mouse M39](https://www.gencodegenes.org/mouse/) comprehensive
chromosome GTF, using GRCm39. The derived files contain 78,289 gene records and
481,871 transcript records. Positions are 1-based, inclusive, as in the GTF.

`backend/data/gencode_reference/gencode_vM39_provenance.json` records the exact
source URL, compressed source SHA-256, record counts, and output checksums.
The two compact TSV gzip files are bundled so lookup requires no network access.

To regenerate from the same source archive:

```bash
python3 scripts/build-gencode-coordinates.py \
  --input /path/to/gencode.vM39.annotation.gtf.gz \
  --output-dir backend/data/gencode_reference \
  --species mouse --assembly GRCm39 --release M39 \
  --source-url https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_mouse/release_M39/gencode.vM39.annotation.gtf.gz
```

The generator fixes gzip timestamps and filenames for reproducible output.
Checks cover reference checksums, shared symbols across species, gene and
transcript IDs, unsupported species, stale annotations, and rendered mouse
chromosome sectors.

## Workspace and panel counts

Circos shares the other network layouts' chart bounds and resizable right panel.
Its Overview uses the relationships currently drawn, including the sign filter.
The chromosome count excludes the Unknown group. Each chromosome's ranked
relationship count includes each incident relationship once, including an
intra-chromosome relationship once; sector activity counts both endpoints.

Selecting a chromosome or ribbon scopes the panel's Edges and Genes tabs to
that group's relationships and their connected genes, including neighboring
chromosomes. Incoming/outgoing/internal counts use resolved directions;
unresolved relationships are listed separately. Overview clears the group.
The reference block's mapped/unmapped totals describe the full filtered Circos
network. The reading guide expands inside the panel without resizing the chart.
