# Species transcription-factor references

GRNScope reads the CSV files in this directory as pairs of `gene_symbol` and
`reference_gene_id`. Both columns are TF-reference aliases: a matrix may identify
a TF by its symbol or by the database identifier supplied for that organism.
Matching does not rename matrix rows or algorithm outputs.

Gene-symbol matching is exact and case-sensitive. Ensembl gene versions such as
`ENSG00000123268.4` match the corresponding stable identifier
`ENSG00000123268`. FlyBase, WormBase, and yeast systematic identifiers are also
recognized as reference IDs. The adjacent `.txt` files remain as symbol-only
fallbacks for older/custom installations; bundled CSV files take precedence.

## AnimalTFDB references

The eight non-human animal lists retain the `Symbol` and `Ensembl` columns from
AnimalTFDB 4.0 tables mirrored at this pinned commit:

https://github.com/mengxu98/datasets/tree/5178c884a932022ceb99a802095deb7775ee2255/AnimalTFDB4/TF_list_final

On 2026-07-25, every downloaded `(gene_symbol, reference_gene_id)` pair was
checked against the corresponding table at that commit before import.

| GRNScope species key | Bundled source pairs | Unique symbols |
| --- | ---: | ---: |
| `mouse` | 1,611 | 1,611 |
| `rat` | 1,390 | 1,377 |
| `pig` | 1,232 | 1,232 |
| `chicken` | 910 | 909 |
| `zebrafish` | 2,543 | 2,210 |
| `xenopus_tropicalis` | 1,207 | 1,183 |
| `drosophila` | 651 | 651 |
| `c_elegans` | 590 | 590 |

Repeated symbols remain associated with each distinct source ID. Case-distinct
zebrafish symbols are intentionally retained because they map to distinct source
records.

## Human reference

The human TF repertoire remains the existing 1,639-symbol list at
`backend/data/known_tf_gene_names.txt`. Stable Ensembl gene IDs were added from
the HGNC complete set downloaded on 2026-07-25:

https://www.genenames.org/download/archive/

HGNC supplied stable IDs for 1,633 of the 1,639 existing symbols. The six
unmapped symbols remain available for symbol matching: `AC008770.3`,
`AC023509.3`, `AC092835.1`, `AC138696.1`, `DUX1`, and `DUX3`. HGNC records
`DUX1` and `DUX3` as not present on the reference assembly.

## Yeast reference

The `s_cerevisiae` list comes from the YEASTRACT TF Consensus List:

https://yeastract.com/consensuslist.php

The downloaded table contained 127 resolved symbols with yeast systematic IDs
and one unresolved entry, `Mal63p`. It is bundled as the SGD standard gene name
`MAL63` with systematic ID `YSC0015`, giving 128 unique symbols:

https://www.yeastgenome.org/locus/S000029659

The `other` species option intentionally has no built-in TF reference.
