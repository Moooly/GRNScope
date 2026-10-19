import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.api.results import compact_result_for_client, attach_beeline_path_stats
from app.services.beeline_service import (
    create_confidence_accumulator,
    finalize_confidence_accumulator,
    recalculate_confidence_result_payload,
    update_confidence_accumulator,
)


class BootstrapOnlyNetworkTests(unittest.TestCase):
    def aggregate(self, runs):
        accumulator = create_confidence_accumulator()
        for edges in runs:
            update_confidence_accumulator(accumulator, edges, evidence_threshold=0.8)
        return finalize_confidence_accumulator(
            accumulator, run_count=len(runs), evidence_threshold=0.8,
        )

    def test_missing_replicate_reduces_evidence_and_confidence_but_not_observed_raw_mean(self):
        edges, summary = self.aggregate([
            [{"source": "A", "target": "B", "score": -4}], [],
            [{"source": "A", "target": "B", "score": -2}],
        ])
        edge = edges[0]
        self.assertAlmostEqual(edge["score"], 2 / 3)
        self.assertAlmostEqual(edge["confidence"], 2 / 3)
        self.assertEqual(edge["mean_raw_score"], -3)
        self.assertEqual(edge["bootstrap_sign_confidence"], 1)
        self.assertEqual(edge["bootstrap_sign_reference"], "bootstrap_mean")
        self.assertFalse(summary["full_data_run_included"])
        self.assertNotIn("full_data_raw_score", edge)

    def test_sign_follows_mean_magnitude_not_majority_and_zero_mean_is_unavailable(self):
        for values, agreement in [([-1, -1, 10], 1 / 3), ([-1, 1], None)]:
            edges, _ = self.aggregate([
                [{"source": "A", "target": "B", "score": v}] for v in values
            ])
            self.assertEqual(edges[0]["bootstrap_sign_confidence"], agreement)
            compact = compact_result_for_client({"algorithm_id": "TEST", "top_edges": edges})
            self.assertEqual(compact["top_edges"][0]["bootstrap_sign_confidence"], agreement)
            self.assertEqual(compact["top_edges"][0]["network_estimator"], "bootstrap_mean_v1")

    def test_recalculation_ignores_full_data_edges_even_when_archived(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            full = root / 'full.csv'
            full.write_text('Gene1,Gene2,EdgeWeight\nX,Y,100\nA,B,-100\n')
            bootstrap = root / 'bootstrap.csv'
            bootstrap.write_text('Gene1,Gene2,EdgeWeight\nA,B,3\n')
            scope = {
                'run_ranked_edges_paths': {'full-data': str(full), 'bootstrap-1': str(bootstrap)},
                'ranked_edges_path': str(root / 'aggregate.csv'),
                'confidence_summary': {'full_data_run_id': 'full-data'},
            }
            payload = {**scope, 'scopes': {'lineage': dict(scope)}}
            self.assertEqual(recalculate_confidence_result_payload(payload, evidence_threshold=.8), 2)
            for result in [payload, payload['scopes']['lineage']]:
                self.assertEqual([(e['source'], e['target']) for e in result['top_edges']], [('A', 'B')])
                self.assertEqual(result['top_edges'][0]['mean_raw_score'], 3)
                self.assertEqual(result['top_edges'][0]['bootstrap_sign_confidence'], 1)
                self.assertNotIn('full_data_run_id', result['confidence_summary'])
            self.assertIn('X,Y,100', full.read_text())
            self.assertIn('bootstrap_mean_v1', (root / 'aggregate.csv').read_text())

    def test_path_stats_use_ensemble_even_when_legacy_full_data_file_exists(self):
        payload = {'network_summary': {'network_estimator': 'bootstrap_mean_v1'},
                   'run_ranked_edges_paths': {'full-data': '/legacy.csv'},
                   'ranked_edges_path': '/ensemble.csv'}
        with patch('app.api.results.read_manifest_for_visualization', return_value={}), \
             patch('app.api.results.build_ground_truth_context', return_value={'edges': [{'source': 'A', 'target': 'B'}]}), \
             patch('app.api.results.compute_beeline_path_stats', return_value={}) as stats:
            attach_beeline_path_stats(payload, Path('/project'))
        self.assertEqual(stats.call_args.args[0], Path('/ensemble.csv'))


if __name__ == '__main__':
    unittest.main()
