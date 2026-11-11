/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const base = "../app/projects/[projectId]/";
const { elasticNetPairs, attachElasticCoefficients, elasticPairKey } = require(base + "_lib/elasticNet.ts");
const { elasticNetMagnitude, figureCounts } = require(base + "_components/network/encoding.ts");
const { galaxyElements } = require(base + "_components/network/model.ts");
const { linksCsv, figureLegend } = require(base + "_components/network/paperData.ts");
const edge = (key, extra = {}) => ({ key, source: "A", target: "B", direction: 1, directionConfidence: 1, directionCoverage: 1, sign: 1, signConfidence: 1, signCoverage: 1, score: .8, count: 1, confidence: .9, bootstrapVerified: true, rank: 1, supportingAlgorithms: ["GENIE3"], ...extra });

test("reversed and unresolved relationships request the correct fits without inventing direction", () => {
  const reversed = edge("reverse", { direction: -1 });
  assert.deepEqual(elasticNetPairs([reversed]), [{ source: "B", target: "A" }]);
  const unknown = edge("unknown", { direction: 0, directionConfidence: null, directionCoverage: 0 });
  const pairs = elasticNetPairs([unknown, unknown]);
  assert.deepEqual(pairs, [{ source: "A", target: "B" }, { source: "B", target: "A" }]);
  const map = new Map([
    [elasticPairKey("A", "B"), { beta: 0, reason: null }],
    [elasticPairKey("B", "A"), { beta: -.6, reason: null }],
  ]);
  const [resolved, unresolved] = attachElasticCoefficients([reversed, unknown], map);
  assert.equal(resolved.elasticNetBeta, -.6);
  assert.equal(unresolved.elasticNetBeta, 0);
  assert.equal(unresolved.elasticNetReverseBeta, -.6);
  assert.equal(unresolved.direction, 0);
});

test("absolute beta widths and counts agree; filtering never rescales coefficients", () => {
  const edges = [edge("zero", { elasticNetBeta: 0 }), edge("negative", { elasticNetBeta: -.6 }), edge("missing"), edge("two", { elasticNetBeta: .1, elasticNetReverseBeta: -.3 })];
  const elements = galaxyElements([], edges, { widthBy: "elasticNet" });
  assert.deepEqual(elements.map(e => e.data.width), [1, 3.6, 1, 2.4]);
  assert.deepEqual(figureCounts(edges, "elasticNet", 1, []).width, [2, 0, 1, 1]);
  assert.equal(galaxyElements([], [edges[1]], { widthBy: "elasticNet" })[0].data.width, elements[1].data.width);
  assert.equal(elasticNetMagnitude(edges[2]), null);
  assert.equal(elasticNetMagnitude(edges[0]), 0);
});

test("exports retain zero, signed beta, reverse fits and missing values", () => {
  const csv = linksCsv([edge("fit", { elasticNetBeta: 0, elasticNetReverseBeta: -.6 }), edge("missing")]);
  assert.match(csv.split("\n")[0], /elastic_net_beta,elastic_net_reverse_beta$/);
  assert.match(csv.split("\n")[1], /,0,-0.6$/);
  assert.match(csv.split("\n")[2], /,,$/);
  const legend = figureLegend([], [], { methods: [], filters: "", widthBy: "elasticNet" });
  assert.match(legend, /absolute standardized Elastic Net coefficient/);
});
