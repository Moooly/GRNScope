import json
import tempfile
import unittest
from pathlib import Path

from app.api.results import compact_result_for_client
from app.services.result_service import (
    archive_beeline_failure_diagnostics,
    archive_beeline_result_artifacts,
)


class ResultCompactionTests(unittest.TestCase):
    def test_preserves_algorithm_gene_adjustment_summaries(self):
        summary = {
            "algorithm_id": "SINGE",
            "effective_gene_limit": 300,
            "input_gene_count": 640,
            "retained_gene_count": 300,
            "applied": True,
        }
        compact = compact_result_for_client(
            {
                "algorithm_id": "SINGE",
                "algorithm_preprocessing": summary,
                "top_edges": [],
                "scopes": {
                    "global": {
                        "scope_id": "global",
                        "scope_label": "Global",
                        "scope_type": "global",
                        "algorithm_preprocessing": summary,
                        "top_edges": [],
                    }
                },
            }
        )

        self.assertEqual(compact["algorithm_preprocessing"], summary)
        self.assertEqual(
            compact["scopes"]["global"]["algorithm_preprocessing"],
            summary,
        )


class FailureDiagnosticsArchiveTests(unittest.TestCase):
    def test_archives_lightweight_failure_bundle_and_removes_runtime(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory) / "project-123"
            runtime_root = project_dir / "_beeline_runtime" / "GENIE3"
            output_dir = (
                runtime_root
                / "outputs"
                / "project-123"
                / "run-1"
                / "GENIE3"
            )
            working_dir = output_dir / "working_dir"
            input_dir = runtime_root / "inputs" / "project-123" / "run-1"
            working_dir.mkdir(parents=True)
            input_dir.mkdir(parents=True)

            (runtime_root / "config.yaml").write_text("config", encoding="utf-8")
            (runtime_root / "stdout.log").write_text("stdout", encoding="utf-8")
            (runtime_root / "stderr.log").write_text("stderr", encoding="utf-8")
            (runtime_root / "run_timings.json").write_text("{}", encoding="utf-8")
            (output_dir / "output.txt").write_text("docker error", encoding="utf-8")
            (working_dir / "time1.txt").write_text("trace", encoding="utf-8")
            (input_dir / "ExpressionData.csv").write_text(
                "large runtime input", encoding="utf-8"
            )

            error_path = Path(
                archive_beeline_failure_diagnostics(
                    project_dir,
                    "job-456",
                    "GENIE3",
                    error_message="Docker command failed.",
                    error_type="algorithm",
                    started_at_timestamp=1_788_800_000.123,
                    completed_at_timestamp=1_788_800_005.123,
                    elapsed_seconds=5,
                    traceback_text="Traceback: test",
                    runtime_roots=[runtime_root],
                )
            )

            self.assertTrue(error_path.exists())
            self.assertFalse(runtime_root.exists())
            self.assertFalse((project_dir / "_beeline_runtime").exists())

            attempt_dir = error_path.parent
            archived_runtime = attempt_dir / "runtime" / "GENIE3"
            self.assertEqual(
                (archived_runtime / "stderr.log").read_text(encoding="utf-8"),
                "stderr",
            )
            self.assertTrue(
                (
                    archived_runtime
                    / "outputs"
                    / "project-123"
                    / "run-1"
                    / "GENIE3"
                    / "output.txt"
                ).exists()
            )
            self.assertFalse((archived_runtime / "inputs").exists())

            error_payload = json.loads(error_path.read_text(encoding="utf-8"))
            self.assertEqual(error_payload["algorithm_id"], "GENIE3")
            self.assertEqual(error_payload["error_message"], "Docker command failed.")
            self.assertIn("runtime/GENIE3/stderr.log", error_payload["copied_files"])

            latest_path = project_dir / "diagnostics" / "GENIE3" / "latest.json"
            latest_payload = json.loads(latest_path.read_text(encoding="utf-8"))
            self.assertEqual(
                latest_payload["error_path"],
                str(error_path.relative_to(project_dir)),
            )

    def test_success_archive_preserves_each_confidence_run_ranked_edges(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory) / "project-123"
            runtime_root = project_dir / "_beeline_runtime" / "GENIE3"
            final_ranked = runtime_root / "rankedEdges_confidence.csv"
            final_ranked.parent.mkdir(parents=True)
            final_ranked.write_text(
                "Gene1\tGene2\tEdgeWeight\na\tb\t0.9\n",
                encoding="utf-8",
            )
            audit_path = (
                runtime_root
                / "algorithm_preprocessed"
                / "gene_selection_audit.json"
            )
            audit_path.parent.mkdir(parents=True)
            audit_path.write_text(
                '{"retained_gene_names":["a"],"removed_gene_names":["b"]}',
                encoding="utf-8",
            )
            run_paths = {}
            for run_id, weight in (("run-1", "0.8"), ("run-2", "0.7")):
                run_path = (
                    runtime_root
                    / "outputs"
                    / "dataset"
                    / run_id
                    / "GENIE3"
                    / "rankedEdges.csv"
                )
                run_path.parent.mkdir(parents=True)
                run_path.write_text(
                    f"Gene1\tGene2\tEdgeWeight\na\tb\t{weight}\n",
                    encoding="utf-8",
                )
                run_paths[run_id] = str(run_path)

            archived = archive_beeline_result_artifacts(
                project_dir,
                "GENIE3",
                {
                    "runtime_root": str(runtime_root),
                    "ranked_edges_path": str(final_ranked),
                    "run_ranked_edges_paths": run_paths,
                },
            )

            self.assertFalse(runtime_root.exists())
            self.assertEqual(
                set(archived["run_ranked_edges_paths"]),
                {"run-1", "run-2"},
            )
            for run_id, archived_path in archived["run_ranked_edges_paths"].items():
                path = Path(archived_path)
                self.assertTrue(path.is_file())
                self.assertEqual(path.name, "rankedEdges.csv")
                self.assertIn(f"runs/{run_id}/rankedEdges.csv", str(path))
            self.assertTrue(
                (
                    project_dir
                    / "results"
                    / "GENIE3"
                    / "gene_selection_audit.json"
                ).is_file()
            )

    def test_success_archive_preserves_empty_run_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory) / "project-123"
            runtime_root = project_dir / "_beeline_runtime" / "SINGE"
            final_ranked = runtime_root / "rankedEdges_confidence.csv"
            final_ranked.parent.mkdir(parents=True)
            final_ranked.write_text(
                "Gene1\tGene2\tEdgeWeight\na\tb\t0.9\n",
                encoding="utf-8",
            )
            diagnostic_root = runtime_root / "run_diagnostics"
            manifest = diagnostic_root / "run-2" / "manifest.json"
            manifest.parent.mkdir(parents=True)
            manifest.write_text('{"reason":"empty_ranked_edges"}', encoding="utf-8")
            empty_ranked = (
                runtime_root
                / "outputs"
                / "dataset"
                / "run-2"
                / "SINGE"
                / "rankedEdges.csv"
            )
            empty_ranked.parent.mkdir(parents=True)
            empty_ranked.write_text(
                "Gene1\tGene2\tEdgeWeight\n",
                encoding="utf-8",
            )

            archived = archive_beeline_result_artifacts(
                project_dir,
                "SINGE",
                {
                    "runtime_root": str(runtime_root),
                    "ranked_edges_path": str(final_ranked),
                    "run_ranked_edges_paths": {"run-2": str(empty_ranked)},
                    "run_diagnostics_root": str(diagnostic_root),
                    "confidence_summary": {
                        "run_metadata": {
                            "run-2": {
                                "status": "Empty",
                                "diagnostics_path": str(manifest.parent),
                            }
                        }
                    },
                },
            )

            archived_root = Path(archived["run_diagnostics_root"])
            self.assertTrue((archived_root / "run-2" / "manifest.json").is_file())
            archived_empty_ranked = Path(
                archived["run_ranked_edges_paths"]["run-2"]
            )
            self.assertEqual(
                archived_empty_ranked.read_text(encoding="utf-8"),
                "Gene1\tGene2\tEdgeWeight\n",
            )
            self.assertEqual(
                archived["confidence_summary"]["run_metadata"]["run-2"][
                    "diagnostics_path"
                ],
                str(archived_root / "run-2"),
            )


if __name__ == "__main__":
    unittest.main()
