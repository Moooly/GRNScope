"""Cached, network-constrained Elastic Net fits, independent of BEELINE runs."""
from __future__ import annotations

import hashlib
import json
import threading
import warnings
from pathlib import Path

import numpy as np
from sklearn.compose import TransformedTargetRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import ElasticNet
from sklearn.model_selection import GridSearchCV, KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ..atomic_io import atomic_write_json
from .matrix_transformation_service import read_expression_frame
from .visualization_context_service import _analysis_expression_path, read_manifest_for_visualization

ENGINE_VERSION = 1
L1_RATIO = 0.5
ALPHAS = np.logspace(-3, 0, 12).tolist()
_fit_lock = threading.Lock()


def fit_coefficients(expression, pairs: list[tuple[str, str]]) -> list[dict]:
    """Fit all candidate regulators of a target jointly. Scaling is fold-local.

    Coefficients refer to standardized X and y, so beta is dimensionless.
    A zero is a measured shrinkage result; None means the fit was unavailable.
    """
    grouped: dict[str, set[str]] = {}
    for source, target in pairs:
        if source != target:
            grouped.setdefault(target, set()).add(source)
    rows = []
    for target, sources in sorted(grouped.items()):
        sources = sorted(sources)
        available = [source for source in sources if source in expression.index]
        values: dict[str, float] = {}
        reason = None
        sample_count = 0
        alpha = None
        if target not in expression.index or not available:
            reason = "Gene missing from the expression matrix."
        else:
            x = expression.loc[available].to_numpy(dtype=float).T
            y = expression.loc[target].to_numpy(dtype=float)
            valid = np.isfinite(y) & np.isfinite(x).all(axis=1)
            x, y = x[valid], y[valid]
            sample_count = len(y)
            if sample_count < 6:
                reason = "At least 6 finite cells are required."
            elif np.std(y) <= 1e-12:
                values = dict.fromkeys(available, 0.0)
            else:
                estimator = Pipeline([
                    ("scale", StandardScaler()),
                    ("regression", TransformedTargetRegressor(
                        regressor=ElasticNet(l1_ratio=L1_RATIO, max_iter=10000, tol=1e-5),
                        transformer=StandardScaler(),
                    )),
                ])
                search = GridSearchCV(
                    estimator, {"regression__regressor__alpha": ALPHAS},
                    scoring="neg_mean_squared_error",
                    cv=KFold(n_splits=3, shuffle=True, random_state=42),
                    n_jobs=1, error_score="raise",
                )
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter("always", ConvergenceWarning)
                    search.fit(x, y)
                if any(issubclass(w.category, ConvergenceWarning) for w in caught):
                    reason = "Elastic Net did not converge for this target."
                else:
                    model = search.best_estimator_.named_steps["regression"].regressor_
                    alpha = float(model.alpha)
                    values = {source: float(beta) for source, beta in zip(available, model.coef_)}
        for source in sources:
            beta = values.get(source)
            rows.append({
                "source": source, "target": target, "beta": beta,
                "cell_count": sample_count, "alpha": alpha,
                "reason": None if beta is not None else reason or "Gene missing from the expression matrix.",
            })
    return rows


def project_elastic_net(project_dir: Path, pairs: list[tuple[str, str]], scope_id: str = "global") -> dict:
    manifest = read_manifest_for_visualization(project_dir)
    expression_path, _ = _analysis_expression_path(project_dir, manifest)
    if scope_id != "global":
        # Never silently substitute global cells for a cluster-specific fit.
        if not scope_id or Path(scope_id).name != scope_id or scope_id in {".", ".."}:
            raise ValueError("Invalid network scope.")
        scope_dir = project_dir / "scopes" / scope_id
        expression_path = next((p for p in (
            scope_dir / "preprocessed" / "ExpressionData.csv",
            scope_dir / "ExpressionData.raw.csv",
        ) if p.is_file()), None)
    if expression_path is None:
        raise FileNotFoundError("Expression data is unavailable for this network scope.")
    pairs = sorted(set((s, t) for s, t in pairs if s != t))
    stat = expression_path.stat()
    fingerprint = json.dumps([
        ENGINE_VERSION, str(expression_path.resolve()), stat.st_size, stat.st_mtime_ns, pairs,
    ], separators=(",", ":"))
    key = hashlib.sha256(fingerprint.encode()).hexdigest()
    cache_path = project_dir / "derived" / "elastic_net" / f"{key}.json"
    # A process handles one fit at a time; concurrent requests reuse its cache.
    with _fit_lock:
        if cache_path.is_file():
            try:
                return json.loads(cache_path.read_text())
            except (ValueError, OSError):
                pass
        expression = read_expression_frame(expression_path)
        result = {
            "engine": "sklearn-elastic-net", "version": ENGINE_VERSION,
            "scope_id": scope_id, "standardized": True, "l1_ratio": L1_RATIO,
            "cv_folds": 3, "candidate_pairs": len(pairs),
            "coefficients": fit_coefficients(expression, pairs),
        }
        atomic_write_json(cache_path, result)
        return result
