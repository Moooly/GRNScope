import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.services.elastic_net_service import fit_coefficients, project_elastic_net


class ElasticNetTests(unittest.TestCase):
    def expression(self):
        rng = np.random.default_rng(42)
        a, b = rng.normal(size=(2, 100))
        return pd.DataFrame([a, b, 2 * a - 3 * b + rng.normal(0, .03, 100), np.ones(100)],
                            index=["A", "B", "Y", "constant"])

    def test_joint_fit_recovers_signed_effects_and_is_invariant_to_units(self):
        expression = self.expression()
        pairs = [("A", "Y"), ("B", "Y")]
        rows = fit_coefficients(expression, pairs)
        self.assertGreater(rows[0]["beta"], .4)
        self.assertLess(rows[1]["beta"], -.7)
        expression.loc["A"] *= 1000
        expression.loc["Y"] *= .001
        scaled = fit_coefficients(expression, pairs)
        np.testing.assert_allclose([r["beta"] for r in rows], [r["beta"] for r in scaled], atol=1e-6)

    def test_zero_is_distinct_from_missing_or_insufficient_data(self):
        expression = self.expression()
        rows = fit_coefficients(expression, [("A", "constant"), ("absent", "Y"), ("A", "A")])
        by_pair = {(r["source"], r["target"]): r for r in rows}
        self.assertEqual(by_pair[("A", "constant")]["beta"], 0)
        self.assertIsNone(by_pair[("absent", "Y")]["beta"])
        self.assertNotIn(("A", "A"), by_pair)
        self.assertIsNone(fit_coefficients(expression.iloc[:, :5], [("A", "Y")])[0]["beta"])

    def test_nonfinite_cells_are_excluded_from_joint_fit(self):
        expression = self.expression()
        expression.iloc[0, 0] = np.nan
        rows = fit_coefficients(expression, [("A", "Y"), ("B", "Y")])
        self.assertTrue(all(r["cell_count"] == 99 and r["beta"] is not None for r in rows))

    def test_cache_reuses_fits_and_invalidates_when_expression_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "ExpressionData.csv"
            self.expression().to_csv(path)
            (root / "project.json").write_text(json.dumps({"expression_path": str(path)}))
            with patch("app.services.elastic_net_service.fit_coefficients", return_value=[]) as fit:
                project_elastic_net(root, [("A", "Y"), ("B", "Y")])
                project_elastic_net(root, [("B", "Y"), ("A", "Y"), ("A", "Y")])
                self.assertEqual(fit.call_count, 1)
                path.write_text(path.read_text() + "\n")
                project_elastic_net(root, [("A", "Y"), ("B", "Y")])
                self.assertEqual(fit.call_count, 2)

    def test_cluster_never_falls_back_to_global_cells(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.expression().to_csv(root / "ExpressionData.csv")
            (root / "project.json").write_text("{}")
            with self.assertRaises(FileNotFoundError):
                project_elastic_net(root, [("A", "Y")], "cluster-missing")
            with self.assertRaises(ValueError):
                project_elastic_net(root, [("A", "Y")], "../escape")
            scoped = root / "scopes" / "cluster-one" / "preprocessed"
            scoped.mkdir(parents=True)
            self.expression().iloc[:, :20].to_csv(scoped / "ExpressionData.csv")
            result = project_elastic_net(root, [("A", "Y")], "cluster-one")
            self.assertEqual(result["coefficients"][0]["cell_count"], 20)

    def test_api_requires_project_owner_and_calculates_existing_projects(self):
        from app.api.results import ElasticNetRequest, get_elastic_net

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "existing"
            project.mkdir()
            self.expression().to_csv(project / "ExpressionData.csv")
            owner = "owner-elastic-net-12345"
            (project / "project.json").write_text(json.dumps({"owner_id": owner}))
            with patch("app.api.results.PROJECTS_ROOT", root):
                payload = ElasticNetRequest(pairs=[{"source": "A", "target": "Y"}])
                request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
                with self.assertRaises(HTTPException) as error:
                    get_elastic_net("existing", payload, request, Response())
                self.assertEqual(error.exception.status_code, 404)
                request = Request({"type": "http", "method": "POST", "path": "/",
                                   "headers": [(b"x-grnscope-client-id", owner.encode())]})
                response = get_elastic_net("existing", payload, request, Response())
                self.assertGreater(response["coefficients"][0]["beta"], 0)
                self.assertTrue(response["standardized"])


if __name__ == "__main__":
    unittest.main()
