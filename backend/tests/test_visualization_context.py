from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.services.visualization_context_service import (
    _fit_expression_spline,
    _trim_terminal_hook,
    build_visualization_context,
    read_ground_truth_edges,
)


class VisualizationContextTests(unittest.TestCase):
    def test_trims_sparse_terminal_hook_without_shortening_regular_path(self) -> None:
        hooked = np.asarray(
            [
                [0.0, 0.0],
                [1.0, 0.0],
                [2.0, 0.0],
                [3.0, 0.0],
                [4.0, 0.0],
                [5.0, 0.0],
                [6.0, 0.0],
                [7.0, 0.0],
                [6.5, 0.2],
                [6.0, 0.4],
            ]
        )
        regular = np.asarray([[float(index), 0.0] for index in range(10)])

        self.assertEqual(len(_trim_terminal_hook(hooked)), 8)
        self.assertEqual(len(_trim_terminal_hook(regular)), 10)

    def test_expression_spline_uses_the_observed_range(self) -> None:
        pseudotime = np.linspace(0, 1, 12)
        expression = np.asarray(
            [0.0, 0.2, 0.1, 0.7, 1.0, 1.8, 2.5, 3.0, 3.7, 4.1, 4.8, 5.0]
        )

        trend = _fit_expression_spline(pseudotime, expression)

        self.assertEqual(len(trend), 100)
        self.assertEqual(trend[0]["pseudotime"], 0.0)
        self.assertEqual(trend[-1]["pseudotime"], 1.0)
        self.assertTrue(
            all(0.0 <= point["expression"] <= 5.0 for point in trend)
        )
        self.assertGreater(trend[-1]["expression"], trend[0]["expression"])

    def test_reads_named_ground_truth_columns_and_deduplicates_edges(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            ground_truth_path = Path(temp_dir) / "ground_truth.tsv"
            ground_truth_path.write_text(
                "regulator\ttarget\teffect\n"
                "TF1\tG1\tactivation\n"
                "TF1\tG1\tactivation\n"
                "TF2\tG2\trepression\n",
                encoding="utf-8",
            )

            edges = read_ground_truth_edges(ground_truth_path)

        self.assertEqual(
            edges,
            [
                {"source": "TF1", "target": "G1", "sign": "activation"},
                {"source": "TF2", "target": "G2", "sign": "repression"},
            ],
        )

    def test_recognizes_type_as_a_ground_truth_sign_header(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            ground_truth_path = Path(temp_dir) / "ground_truth.csv"
            ground_truth_path.write_text(
                "Source,Target,Type\n"
                "TF1,G1,1.0\n"
                "TF2,G2,-1.0\n",
                encoding="utf-8",
            )

            edges = read_ground_truth_edges(ground_truth_path)

        self.assertEqual(edges[0]["sign"], "1.0")
        self.assertEqual(edges[1]["sign"], "-1.0")

    def test_builds_trajectory_and_ground_truth_context(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            expression_path = project_dir / "ExpressionData.csv"
            expression_path.write_text(
                ",c1,c2,c3,c4,c5,c6\n"
                "G1,0,1,2,3,4,5\n"
                "G2,5,4,3,2,1,0\n"
                "G3,1,1,1,1,1,1\n",
                encoding="utf-8",
            )
            pseudotime_path = project_dir / "PseudoTime.csv"
            pseudotime_path.write_text(
                ",PseudoTime1\n"
                "c1,0.0\n"
                "c2,0.2\n"
                "c3,0.4\n"
                "c4,0.6\n"
                "c5,0.8\n"
                "c6,1.0\n",
                encoding="utf-8",
            )
            ground_truth_path = project_dir / "ground_truth.csv"
            ground_truth_path.write_text(
                "source,target\nG1,G2\nG2,G3\n",
                encoding="utf-8",
            )
            (project_dir / "project.json").write_text(
                json.dumps(
                    {
                        "expression_filename": expression_path.name,
                        "pseudotime_filename": pseudotime_path.name,
                        "ground_truth_filename": ground_truth_path.name,
                    }
                ),
                encoding="utf-8",
            )

            context = build_visualization_context(
                project_dir=project_dir,
                requested_genes=["G2", "G1"],
            )

        trajectory = context["trajectory"]
        self.assertTrue(trajectory["available"])
        self.assertEqual(trajectory["genes"], ["G2", "G1"])
        self.assertEqual(trajectory["available_genes"], ["G1", "G2", "G3"])
        self.assertEqual(trajectory["lineages"][0]["cell_count"], 6)
        self.assertEqual(trajectory["lineages"][0]["displayed_cell_count"], 6)
        self.assertEqual(len(trajectory["lineages"][0]["expression_points"]), 6)
        self.assertEqual(
            set(trajectory["lineages"][0]["expression_points"][0]["expression"]),
            {"G1", "G2"},
        )
        self.assertEqual(
            set(trajectory["lineages"][0]["trends"]),
            {"G1", "G2"},
        )
        self.assertEqual(trajectory["trend_method"], "cubic_smoothing_spline_gcv")
        self.assertEqual(trajectory["expression_label"], "Expression")
        self.assertEqual(trajectory["embedding"]["method"], "PCA")
        self.assertEqual(
            trajectory["embedding"]["path_source"],
            "pseudotime_bin_centroids",
        )
        self.assertEqual(trajectory["embedding"]["sampled_cell_count"], 6)
        self.assertEqual(len(trajectory["embedding"]["points"]), 6)
        self.assertEqual(
            trajectory["embedding"]["paths"][0]["name"],
            "PseudoTime1",
        )

        ground_truth = context["ground_truth"]
        self.assertTrue(ground_truth["available"])
        self.assertEqual(ground_truth["edge_count"], 2)
        self.assertEqual(
            ground_truth["edges"][0],
            {"source": "G1", "target": "G2"},
        )

    def test_trajectory_prefers_the_preprocessed_expression_matrix(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            uploaded_path = project_dir / "uploaded.csv"
            uploaded_path.write_text(
                ",c1,c2,c3,c4,c5,c6\n"
                "G1,100,200,300,400,500,600\n",
                encoding="utf-8",
            )
            preprocessed_path = project_dir / "ExpressionData.csv"
            preprocessed_path.write_text(
                ",c1,c2,c3,c4,c5,c6\n"
                "G1,1,2,3,4,5,6\n",
                encoding="utf-8",
            )
            pseudotime_path = project_dir / "PseudoTime.csv"
            pseudotime_path.write_text(
                ",PseudoTime1\n"
                "c1,0\nc2,0.2\nc3,0.4\nc4,0.6\nc5,0.8\nc6,1\n",
                encoding="utf-8",
            )
            (project_dir / "project.json").write_text(
                json.dumps(
                    {
                        "expression_path": str(uploaded_path),
                        "preprocessed_expression_path": str(preprocessed_path),
                        "pseudotime_path": str(pseudotime_path),
                        "preprocessing": {"matrix_state": "raw"},
                    }
                ),
                encoding="utf-8",
            )

            context = build_visualization_context(
                project_dir=project_dir,
                requested_genes=["G1"],
            )

        trajectory = context["trajectory"]
        self.assertTrue(trajectory["available"])
        self.assertEqual(trajectory["expression_file"], "ExpressionData.csv")
        self.assertEqual(trajectory["expression_label"], "Log-normalized expression")
        observations = trajectory["lineages"][0]["expression_points"]
        self.assertEqual(
            [point["expression"]["G1"] for point in observations],
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        )

    def test_marks_optional_context_unavailable_when_files_are_absent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            (project_dir / "project.json").write_text("{}", encoding="utf-8")

            context = build_visualization_context(
                project_dir=project_dir,
                requested_genes=[],
            )

        self.assertFalse(context["trajectory"]["available"])
        self.assertFalse(context["ground_truth"]["available"])


if __name__ == "__main__":
    unittest.main()
