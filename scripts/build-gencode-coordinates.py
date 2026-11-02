"""Build compact, reproducible gene/transcript coordinates from an official GENCODE GTF."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re


def build(args):
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    common = ['chromosome', 'start', 'end', 'strand', 'gene_id', 'gene_id_base', 'gene_name', 'gene_type']
    columns = {'gene': common, 'transcript': common + ['transcript_id', 'transcript_id_base', 'transcript_name', 'transcript_type']}
    counts = {'gene': 0, 'transcript': 0}
    paths = {kind: output / f'gencode_v{args.release}_{kind}_coordinates.tsv.gz' for kind in columns}
    # mtime and embedded filename are fixed so regeneration gives identical bytes.
    from contextlib import ExitStack
    with ExitStack() as stack:
        writers = {}
        for kind, fields in columns.items():
            raw = stack.enter_context(paths[kind].open('wb'))
            compressed = stack.enter_context(gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0))
            stream = stack.enter_context(io.TextIOWrapper(compressed, encoding='utf-8', newline=''))
            writers[kind] = csv.DictWriter(stream, fieldnames=fields, delimiter='\t', lineterminator='\n')
            writers[kind].writeheader()
        with gzip.open(args.input, 'rt', encoding='utf-8') as source:
            for line in source:
                if line.startswith('#'):
                    continue
                fields = line.rstrip('\n').split('\t')
                if len(fields) != 9 or fields[2] not in writers:
                    continue
                kind = fields[2]
                attrs = dict(re.findall(r'(\S+)\s+"([^"]*)";', fields[8]))
                gene_id = attrs.get('gene_id', '')
                row = dict(chromosome=fields[0], start=fields[3], end=fields[4], strand=fields[6],
                           gene_id=gene_id, gene_id_base=gene_id.split('.')[0],
                           gene_name=attrs.get('gene_name', gene_id), gene_type=attrs.get('gene_type', ''))
                if kind == 'transcript':
                    transcript_id = attrs.get('transcript_id', '')
                    row.update(transcript_id=transcript_id, transcript_id_base=transcript_id.split('.')[0],
                               transcript_name=attrs.get('transcript_name', ''), transcript_type=attrs.get('transcript_type', ''))
                writers[kind].writerow(row)
                counts[kind] += 1
    def sha(path):
        with Path(path).open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()
    provenance = dict(species=args.species, assembly=args.assembly, annotation=f'GENCODE {args.release}',
                      coordinate_system='1-based inclusive', source_url=args.source_url,
                      source_sha256=sha(args.input), counts=counts,
                      files={p.name: sha(p) for p in paths.values()})
    (output / f'gencode_v{args.release}_provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps(provenance, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['input', 'output-dir', 'species', 'assembly', 'release', 'source-url']:
        parser.add_argument('--' + name, required=True)
    build(parser.parse_args())
