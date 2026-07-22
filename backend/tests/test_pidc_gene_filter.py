import csv
import tempfile
import unittest
from pathlib import Path

from app.services.beeline_service import (
    limit_expression_genes_by_variance,
    prepare_algorithm_expression_source,
    resolve_algorithm_gene_limit,
)


class PIDCGeneFilterTests(unittest.TestCase):
    def test_default_and_override_gene_limits_are_resolved(self):
        self.assertEqual(resolve_algorithm_gene_limit("PIDC", {}, "maxGenes"), 500)
        self.assertEqual(
            resolve_algorithm_gene_limit(
                "PIDC",
                {"algorithm_parameters": {"PIDC": {"maxGenes": 300}}},
                "maxGenes",
            ),
            300,
        )

    def test_top_variance_genes_are_selected_once_in_source_order(self):
        with tempfile.TemporaryDirectory(prefix="pidc-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            destination = root / "pidc" / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2,cell-3\n"
                "gene-a,0,0,0\n"
                "gene-b,0,1,2\n"
                "gene-c,0,2,4\n"
                "gene-d,1,1,1\n"
                "gene-e,0,3,6\n",
                encoding="utf-8",
            )

            result = limit_expression_genes_by_variance(source, destination, 3)

            self.assertEqual(result, destination)
            with destination.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual([row[0] for row in rows[1:]], ["gene-b", "gene-c", "gene-e"])

    def test_small_matrix_reuses_existing_preprocessed_file(self):
        with tempfile.TemporaryDirectory(prefix="pidc-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            destination = root / "pidc" / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2\n"
                "gene-a,0,1\n"
                "gene-b,1,0\n"
                "gene-c,2,1\n",
                encoding="utf-8",
            )

            result = limit_expression_genes_by_variance(source, destination, 500)

            self.assertEqual(result, source)
            self.assertFalse(destination.exists())


class SINCERITIESGeneFilterTests(unittest.TestCase):
    def test_default_and_override_gene_limits_are_resolved(self):
        self.assertEqual(
            resolve_algorithm_gene_limit("SINCERITIES", {}, "maxGenes"),
            500,
        )
        self.assertEqual(
            resolve_algorithm_gene_limit(
                "SINCERITIES",
                {"algorithm_parameters": {"SINCERITIES": {"maxGenes": 300}}},
                "maxGenes",
            ),
            300,
        )

    def test_gene_limit_stays_below_confidence_run_cell_count(self):
        with tempfile.TemporaryDirectory(prefix="sincerities-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2,cell-3,cell-4,cell-5,cell-6\n"
                "gene-a,0,0,0,0,0,0\n"
                "gene-b,0,1,2,3,4,5\n"
                "gene-c,0,2,4,6,8,10\n"
                "gene-d,1,1,1,1,1,1\n"
                "gene-e,0,3,6,9,12,15\n"
                "gene-f,0,4,8,12,16,20\n",
                encoding="utf-8",
            )

            result = prepare_algorithm_expression_source(
                runtime_root=root / "runtime",
                algorithm_id="SINCERITIES",
                project_manifest={
                    "algorithm_parameters": {
                        "SINCERITIES": {"maxGenes": 500},
                    },
                    "confidence_subsample_fraction": 0.8,
                },
                preprocessed_expression=source,
            )

            # Six uploaded cells become five cells per confidence run. The
            # partial-correlation input is therefore capped at four genes.
            with result.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(len(rows) - 1, 4)
            self.assertEqual(
                [row[0] for row in rows[1:]],
                ["gene-b", "gene-c", "gene-e", "gene-f"],
            )


class SINGEGeneFilterTests(unittest.TestCase):
    def test_default_and_override_gene_limits_are_resolved(self):
        self.assertEqual(resolve_algorithm_gene_limit("SINGE", {}, "maxGenes"), 500)
        self.assertEqual(
            resolve_algorithm_gene_limit(
                "SINGE",
                {"algorithm_parameters": {"SINGE": {"maxGenes": 300}}},
                "maxGenes",
            ),
            300,
        )

    def test_singe_uses_the_shared_highest_variance_filter(self):
        with tempfile.TemporaryDirectory(prefix="singe-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2,cell-3\n"
                "gene-a,0,0,0\n"
                "gene-b,0,1,2\n"
                "gene-c,0,2,4\n"
                "gene-d,1,1,1\n"
                "gene-e,0,3,6\n",
                encoding="utf-8",
            )

            result = prepare_algorithm_expression_source(
                runtime_root=root / "runtime",
                algorithm_id="SINGE",
                project_manifest={
                    "algorithm_parameters": {"SINGE": {"maxGenes": 3}},
                },
                preprocessed_expression=source,
            )

            with result.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(
                [row[0] for row in rows[1:]],
                ["gene-b", "gene-c", "gene-e"],
            )


class SCRIBEGeneFilterTests(unittest.TestCase):
    def test_default_and_override_gene_limits_are_resolved(self):
        self.assertEqual(resolve_algorithm_gene_limit("SCRIBE", {}, "maxGenes"), 300)
        self.assertEqual(
            resolve_algorithm_gene_limit(
                "SCRIBE",
                {"algorithm_parameters": {"SCRIBE": {"maxGenes": 200}}},
                "maxGenes",
            ),
            200,
        )

    def test_scribe_uses_one_shared_highest_variance_gene_set(self):
        with tempfile.TemporaryDirectory(prefix="scribe-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2,cell-3\n"
                "gene-a,0,0,0\n"
                "gene-b,0,1,2\n"
                "gene-c,0,2,4\n"
                "gene-d,1,1,1\n"
                "gene-e,0,3,6\n",
                encoding="utf-8",
            )

            result = prepare_algorithm_expression_source(
                runtime_root=root / "runtime",
                algorithm_id="SCRIBE",
                project_manifest={
                    "algorithm_parameters": {"SCRIBE": {"maxGenes": 3}},
                },
                preprocessed_expression=source,
            )

            with result.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(
                [row[0] for row in rows[1:]],
                ["gene-b", "gene-c", "gene-e"],
            )


class GRNVBEMGeneFilterTests(unittest.TestCase):
    def test_default_and_override_gene_limits_are_resolved(self):
        self.assertEqual(resolve_algorithm_gene_limit("GRNVBEM", {}, "maxGenes"), 500)
        self.assertEqual(
            resolve_algorithm_gene_limit(
                "GRNVBEM",
                {"algorithm_parameters": {"GRNVBEM": {"maxGenes": 300}}},
                "maxGenes",
            ),
            300,
        )

    def test_grnvbem_uses_one_shared_highest_variance_gene_set(self):
        with tempfile.TemporaryDirectory(prefix="grnvbem-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2,cell-3\n"
                "gene-a,0,0,0\n"
                "gene-b,0,1,2\n"
                "gene-c,0,2,4\n"
                "gene-d,1,1,1\n"
                "gene-e,0,3,6\n",
                encoding="utf-8",
            )

            result = prepare_algorithm_expression_source(
                runtime_root=root / "runtime",
                algorithm_id="GRNVBEM",
                project_manifest={
                    "algorithm_parameters": {"GRNVBEM": {"maxGenes": 3}},
                },
                preprocessed_expression=source,
            )

            with result.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(
                [row[0] for row in rows[1:]],
                ["gene-b", "gene-c", "gene-e"],
            )


class GRISLIGeneFilterTests(unittest.TestCase):
    def test_default_and_override_gene_limits_are_resolved(self):
        self.assertEqual(resolve_algorithm_gene_limit("GRISLI", {}, "maxGenes"), 500)
        self.assertEqual(
            resolve_algorithm_gene_limit(
                "GRISLI",
                {"algorithm_parameters": {"GRISLI": {"maxGenes": 300}}},
                "maxGenes",
            ),
            300,
        )

    def test_grisli_uses_one_shared_highest_variance_gene_set(self):
        with tempfile.TemporaryDirectory(prefix="grisli-filter-test-") as temp_dir:
            root = Path(temp_dir)
            source = root / "ExpressionData.csv"
            source.write_text(
                ",cell-1,cell-2,cell-3\n"
                "gene-a,0,0,0\n"
                "gene-b,0,1,2\n"
                "gene-c,0,2,4\n"
                "gene-d,1,1,1\n"
                "gene-e,0,3,6\n",
                encoding="utf-8",
            )

            result = prepare_algorithm_expression_source(
                runtime_root=root / "runtime",
                algorithm_id="GRISLI",
                project_manifest={
                    "algorithm_parameters": {"GRISLI": {"maxGenes": 3}},
                },
                preprocessed_expression=source,
            )

            with result.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(
                [row[0] for row in rows[1:]],
                ["gene-b", "gene-c", "gene-e"],
            )


if __name__ == "__main__":
    unittest.main()
