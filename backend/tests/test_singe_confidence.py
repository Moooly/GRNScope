import gzip
import json
import tempfile
import unittest
from pathlib import Path

from app.services.beeline_service import (
    EmptyConfidenceRunError,
    archive_singe_empty_run_diagnostics,
    parse_confidence_run_output,
)


class SINGEEmptyConfidenceRunTests(unittest.TestCase):
    def test_empty_ranked_edges_has_a_recoverable_error_with_its_path(self):
        with tempfile.TemporaryDirectory(prefix="singe-empty-run-") as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "outputs"
            ranked_edges_path = (
                output_dir / "dataset" / "run-2" / "SINGE" / "rankedEdges.csv"
            )
            ranked_edges_path.parent.mkdir(parents=True)
            ranked_edges_path.write_text(
                "Gene1\tGene2\tEdgeWeight\n",
                encoding="utf-8",
            )

            with self.assertRaises(EmptyConfidenceRunError) as raised:
                parse_confidence_run_output(
                    output_dir,
                    "dataset",
                    "run-2",
                    "SINGE",
                    runtime_root=root,
                    max_edges_per_target=20,
                )

            self.assertEqual(raised.exception.run_id, "run-2")
            self.assertEqual(raised.exception.ranked_edges_path, ranked_edges_path)

    def test_empty_run_diagnostics_preserve_raw_singe_files_compressed(self):
        with tempfile.TemporaryDirectory(prefix="singe-empty-run-") as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "outputs"
            algorithm_output = output_dir / "dataset" / "run-2" / "SINGE"
            trajectory_dir = algorithm_output / "working_dir" / "0"
            trajectory_dir.mkdir(parents=True)
            (algorithm_output / "rankedEdges.csv").write_text(
                "Gene1\tGene2\tEdgeWeight\n",
                encoding="utf-8",
            )
            raw_ranked = trajectory_dir / "SINGE_Ranked_Edge_List.txt"
            raw_ranked.write_text(
                "Gene1\tGene2\tEdgeWeight\n",
                encoding="utf-8",
            )
            intermediate = trajectory_dir / "GLG_Test_0.mat"
            intermediate.write_bytes(b"raw-intermediate-evidence")

            diagnostic_dir = archive_singe_empty_run_diagnostics(
                runtime_root=root,
                output_dir=output_dir,
                dataset_id="dataset",
                run_id="run-2",
                parse_error="no valid edges",
            )

            manifest = json.loads(
                (diagnostic_dir / "manifest.json").read_text(encoding="utf-8")
            )
            archived_by_source = {
                entry["source_path"]: entry
                for entry in manifest["archived_files"]
                if "archive_path" in entry
            }
            self.assertIn(
                "working_dir/0/SINGE_Ranked_Edge_List.txt",
                archived_by_source,
            )
            self.assertIn("working_dir/0/GLG_Test_0.mat", archived_by_source)

            archive_path = diagnostic_dir / archived_by_source[
                "working_dir/0/GLG_Test_0.mat"
            ]["archive_path"]
            with gzip.open(archive_path, "rb") as handle:
                self.assertEqual(handle.read(), b"raw-intermediate-evidence")


if __name__ == "__main__":
    unittest.main()
