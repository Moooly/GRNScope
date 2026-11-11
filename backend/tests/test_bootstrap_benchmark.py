import json
import tempfile
import unittest
from pathlib import Path

from app.services.bootstrap_benchmark_service import auprc_ratio, saved_bootstrap_benchmark
from app.api.results import attach_beeline_path_stats, compact_result_for_client

TRUTH = [{"source": "A", "target": "B"}, {"source": "B", "target": "C"}]
PAIRS = [(a, b) for a in "ABC" for b in "ABC" if a != b]


class BootstrapBenchmarkTests(unittest.TestCase):
    def write_run(self, root, run, mode):
        path = root / run / "rankedEdges.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        truth = {(r["source"], r["target"]) for r in TRUTH}
        def score(pair):
            return 1 if mode == "tied" else 3 if ((pair in truth) == (mode == "good")) else 1
        path.write_text("Gene1,Gene2,EdgeWeight\n" + "".join(f"{a},{b},{score((a,b))}\n" for a,b in PAIRS))
        return str(path)

    def test_rescores_archives_with_ties_absolute_scores_and_fixed_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            paths = {f"bootstrap-{i}": self.write_run(root, f"bootstrap-{i}", mode)
                     for i, mode in enumerate(["good", "tied", "bad"], 1)}
            paths["full-data"] = paths["bootstrap-1"]
            result = saved_bootstrap_benchmark(root, {"run_ranked_edges_paths": paths}, TRUTH)
            self.assertEqual(result["run_count"], 3)
            self.assertAlmostEqual(result["minimum"], .5)
            self.assertAlmostEqual(result["median"], 2)
            self.assertAlmostEqual(result["maximum"], 3)
            truth = frozenset((e["source"],e["target"]) for e in TRUTH)
            self.assertEqual(auprc_ratio([{"source":a,"target":b,"score":-3 if (a,b) in truth else 1} for a,b in PAIRS],truth),3)

    def test_missing_failed_and_outside_project_files_are_not_fabricated(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = Path(temp)
            valid = self.write_run(root, "bootstrap-1", "good")
            external = self.write_run(Path(outside), "bootstrap-3", "bad")
            payload = {"run_ranked_edges_paths": {"bootstrap-1":valid,"bootstrap-2":str(root/'missing'),"bootstrap-3":external,"bootstrap-4":valid},
                       "confidence_summary":{"run_metadata":{"bootstrap-4":{"status":"Failed"}}}}
            result = saved_bootstrap_benchmark(root, payload, TRUTH)
            self.assertEqual(result["status"],"partial")
            self.assertEqual(result["run_count"],1)
            self.assertEqual(result["unavailable_run_count"],2)
            self.assertEqual(result["minimum"],result["median"])

    def test_file_changes_invalidate_score_cache_and_scopes_stay_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            path=self.write_run(root,"bootstrap-1","good")
            payload={"run_ranked_edges_paths":{"bootstrap-1":path}}
            self.assertEqual(saved_bootstrap_benchmark(root,payload,TRUTH)["median"],3)
            self.write_run(root,"bootstrap-1","bad")
            self.assertEqual(saved_bootstrap_benchmark(root,payload,TRUTH)["median"],.5)
            (root/'ground_truth.csv').write_text('source,target\nA,B\nB,C\n')
            (root/'manifest.json').write_text(json.dumps({'ground_truth_filename':'ground_truth.csv'}))
            enriched=attach_beeline_path_stats({**payload,"scopes":{"cluster":{"status":"Completed"}}},root)
            compact=compact_result_for_client(enriched)
            self.assertEqual(compact['bootstrap_benchmark']['run_count'],1)
            self.assertEqual(compact['scopes']['cluster']['bootstrap_benchmark']['run_count'],0)
            self.assertNotIn(path,json.dumps(compact['bootstrap_benchmark']))

    def test_absent_runs_and_reference_return_unavailable(self):
        with tempfile.TemporaryDirectory() as temp:
            for truth in [TRUTH, []]:
                result=saved_bootstrap_benchmark(Path(temp),{},truth)
                self.assertEqual(result['status'],'unavailable')
                self.assertIsNone(result['median'])


if __name__ == '__main__':
    unittest.main()
