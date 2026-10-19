/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness compiles the pure TypeScript module. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );

const {
  assignAverageRanks,
  consensusConfidence,
  edgesForScope,
  median,
  numericConfidenceScore,
  numericEvidenceScore,
  numericOptionalProbability,
  numericSignedEdgeScore,
} = require("../app/projects/[projectId]/_lib/resultScores.ts");

test("consensus confidence includes every selected method, including zero recovery", () => {
  const ids = ["A", "B", "C", "D", "E"];
  const scores = { A: 0.9, B: 0.8, C: 0.7, D: 0, E: 0 };
  assert.ok(Math.abs(consensusConfidence(ids, scores) - 0.48) < 1e-12);
  assert.ok(Math.abs(consensusConfidence(ids, { A: 0.95 }) - 0.19) < 1e-12);
  assert.ok(Math.abs(consensusConfidence(["A", "B", "C"], scores) - 0.8) < 1e-12);
  assert.equal(consensusConfidence(ids, { A: NaN, B: Infinity }), 0);
  assert.equal(consensusConfidence(ids, {}), 0);
  assert.equal(consensusConfidence([], scores), 0);
  assert.equal(consensusConfidence(ids, Object.fromEntries(ids.map(id => [id, 1]))), 1);
});

test("result scopes select completed scope edges and preserve the global fallback", () => {
  const globalEdge = { source: "A", target: "B" };
  const clusterEdge = { source: "B", target: "C" };
  const result = {
    top_edges: [globalEdge],
    scopes: {
      cluster: { status: "Completed", top_edges: [clusterEdge] },
      pending: { status: "Running", top_edges: [clusterEdge] },
    },
  };
  assert.deepEqual(edgesForScope(result, "global"), [globalEdge]);
  assert.deepEqual(edgesForScope(result, "cluster"), [clusterEdge]);
  assert.deepEqual(edgesForScope(result, "pending"), []);
});

test("evidence and confidence scores use the saved fields in order", () => {
  assert.equal(numericEvidenceScore({ normalized_score: 1.2 }, 0.4), 1);
  assert.equal(numericEvidenceScore({ mean_percentile: 0.7, score: 0.2 }, 0.4), 0.7);
  assert.equal(numericEvidenceScore({ score: 0.6 }, 0.4), 0.6);
  assert.equal(numericEvidenceScore({ score: 3, confidence: 0.8 }, 0.4), 0.8);
  assert.equal(numericEvidenceScore({ score: 3 }, 0.4), 0.4);
  assert.equal(numericConfidenceScore({ confidence: 0.9, stability: 0.2 }, 0.4), 0.9);
  assert.equal(numericConfidenceScore({ stability: 0.5, mean_percentile: 0.8 }, 0.4), 0.4);
  assert.equal(numericOptionalProbability(null), null);
  assert.equal(numericOptionalProbability(1.5), 1);
});

test("median and average ranks keep ties stable", () => {
  assert.equal(median([7, 1, 3, 5]), 4);
  assert.equal(median([]), null);
  const rows = [{ value: 9, rank: 0 }, { value: 9, rank: 0 }, { value: 2, rank: 0 }];
  const ranked = assignAverageRanks(rows, (first, second) => first.value === second.value);
  assert.deepEqual(ranked.map((row) => row.rank), [1.5, 1.5, 3]);
  assert.deepEqual(rows.map((row) => row.rank), [0, 0, 0]);
});

test("bootstrap network estimates override stale full-data fields", () => {
  const edge = {
    network_estimator: "bootstrap_mean_v1",
    bootstrap_mean_evidence: 0.4,
    bootstrap_mean_raw_score: -2,
    normalized_score: 1,
    score: 0.9,
    mean_raw_score: 8,
    full_data_raw_score: 8,
  };
  assert.equal(numericEvidenceScore(edge, 0), 0.4);
  assert.equal(numericSignedEdgeScore(edge), -2);
});
