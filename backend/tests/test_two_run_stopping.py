import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.beeline_service import (
    create_confidence_accumulator,
    estimate_remaining_seconds_range_from_run_timings,
    finalize_confidence_accumulator,
    record_confidence_stability_check,
    resolve_confidence_settings,
    spearman_stability_check,
    update_confidence_accumulator,
)


class TwoRunCheckStartTests(unittest.TestCase):
    def state(self, mode='automatic'):
        settings = resolve_confidence_settings(
            {'confidence_run_mode': mode, 'confidence_bootstrap_runs': 2}, gene_count=4,
        )
        return {
            'enabled': settings['early_stopping_enabled'],
            'min_runs': settings['min_runs'],
            'stop_streak': settings['stop_streak'],
            'stop_rho': settings['stop_rho'],
            'checks': [], 'streak': 0,
        }

    def decisions(self, runs):
        state = self.state()
        acc = create_confidence_accumulator()
        previous = None
        decisions = []
        with tempfile.TemporaryDirectory() as folder:
            for count, weights in enumerate(runs, 1):
                update_confidence_accumulator(acc, [
                    {'source': source, 'target': 'T', 'score': weight}
                    for source, weight in zip(['A', 'B', 'C'], weights)
                ], evidence_threshold=.8)
                current, _ = finalize_confidence_accumulator(
                    acc, run_count=count, evidence_threshold=.8,
                )
                if previous is not None:
                    check = spearman_stability_check(
                        runtime_root=Path(folder), previous_edges=previous,
                        current_edges=current, current_run_count=count,
                        stop_rho=state['stop_rho'],
                    )
                    decisions.append(record_confidence_stability_check(state, check))
                previous = current
        return decisions, state

    def test_two_passing_cumulative_comparisons_stop_after_three_runs(self):
        decisions, state = self.decisions([[10, 5, 1], [9, 4, 2], [8, 3, 1]])
        self.assertEqual(decisions, [False, True])
        self.assertEqual(state['checks'][0]['run_count'], 2)
        self.assertEqual(state['min_runs'], 2)
        self.assertEqual(state['stop_streak'], 2)

    def test_failed_checks_continue_until_two_later_checks_pass(self):
        decisions, state = self.decisions([[10, 5, 1], [5, 10, 1], [5, 10, 1], [5, 10, 1], [5, 10, 1]])
        self.assertEqual(decisions, [False, False, False, True])
        self.assertLess(state['checks'][0]['rho'], .95)
        self.assertEqual(state['streak'], 2)

    def test_first_run_cannot_stop_even_if_supplied_a_passing_check(self):
        self.assertFalse(record_confidence_stability_check(
            self.state(), {'run_count': 1, 'stop_early': True},
        ))

    def test_fixed_two_run_setting_disables_adaptive_stopping(self):
        settings = resolve_confidence_settings(
            {'confidence_run_mode': 'fixed', 'confidence_bootstrap_runs': 2}, gene_count=4,
        )
        self.assertEqual(settings['bootstrap_runs'], 2)
        self.assertEqual(settings['total_algorithm_runs'], 2)
        self.assertFalse(record_confidence_stability_check(
            self.state('fixed'), {'run_count': 2, 'stop_early': True},
        ))

    def test_eta_requires_two_remaining_runs_after_the_first(self):
        state = self.state()
        remaining = estimate_remaining_seconds_range_from_run_timings(
            {'bootstrap-1': {'status': 'Completed', 'elapsed_seconds': 60}},
            minimum_run_count=state['min_runs'], maximum_run_count=50,
            current_streak=0, required_streak=state['stop_streak'],
            current_run_elapsed_seconds=0,
        )
        self.assertEqual(remaining, (120, 2940))

    def test_failure_resets_the_consecutive_passing_streak(self):
        state = self.state()
        decisions = [record_confidence_stability_check(state, {
            'run_count': count, 'stop_early': passed,
        }) for count, passed in enumerate([True, False, True, True], 2)]
        self.assertEqual(decisions, [False, False, False, True])
        self.assertEqual(state['streak'], 2)

    def test_threshold_is_strictly_greater_than_point_nine_five(self):
        with tempfile.TemporaryDirectory() as folder:
            for rho, expected in [(0.949, False), (0.95, False), (0.951, True)]:
                with self.subTest(rho=rho), patch(
                    'app.services.beeline_service.spearman_rho', return_value=rho,
                ):
                    check = spearman_stability_check(
                        runtime_root=Path(folder),
                        previous_edges=[{'source': 'A', 'target': 'T', 'confidence': .8},
                                        {'source': 'B', 'target': 'T', 'confidence': .2}],
                        current_edges=[{'source': 'A', 'target': 'T', 'confidence': .9},
                                       {'source': 'B', 'target': 'T', 'confidence': .1}],
                        current_run_count=2, stop_rho=.95,
                    )
                    self.assertEqual(check['stop_early'], expected)
                    self.assertEqual(check['stop_comparison'], 'gt')
