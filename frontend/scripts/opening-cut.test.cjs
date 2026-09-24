/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const { chooseOpeningEvidenceCut, openingLinkBudget } = require("../app/projects/[projectId]/_lib/openingCut.ts");

// Deterministic pseudo-random scores, heavier near 0.5 like the real projects.
function scores(n, seed = 7) { let x = seed; return Array.from({ length: n }, () => { x = (x * 16807) % 2147483647; return 0.3 + 0.7 * Math.pow(x / 2147483647, 1.6); }); }

test("the budget follows the project's size, within readable bounds", () => {
  assert.equal(openingLinkBudget(5), 12);
  assert.equal(openingLinkBudget(19), 29);
  assert.equal(openingLinkBudget(100), 60);
  assert.equal(openingLinkBudget(2000), 60);
});

test("a large project opens at a cut that keeps about the budget, never below 0.5", () => {
  const s = scores(900);
  const cut = chooseOpeningEvidenceCut(s, 100);
  assert.ok(cut.threshold >= 0.5);
  assert.ok(cut.kept >= 48 && cut.kept <= 72, `kept ${cut.kept}`);
  assert.equal(cut.kept, s.filter(v => v >= cut.threshold).length, "the cut is an ordinary evidence threshold");
});

test("a small project that already fits opens at 0.5 with everything credible", () => {
  const s = [0.95, 0.9, 0.88, 0.8, 0.77, 0.7, 0.66, 0.61, 0.6, 0.58, 0.55, 0.52, 0.51, 0.4, 0.2];
  const cut = chooseOpeningEvidenceCut(s, 12);
  assert.equal(cut.threshold, 0.5); assert.equal(cut.kept, 13);
});

test("a weak project still shows its strongest dozen", () => {
  const s = Array.from({ length: 40 }, (_, i) => 0.45 - i * 0.005);
  const cut = chooseOpeningEvidenceCut(s, 30);
  assert.equal(cut.kept, 12);
});

test("a natural gap near the budget edge is preferred", () => {
  // 19 genes → budget 29; a clear gap after the 25th score.
  const s = [...Array.from({ length: 25 }, (_, i) => 0.99 - i * 0.004), ...Array.from({ length: 50 }, (_, i) => 0.85 - i * 0.004)];
  const cut = chooseOpeningEvidenceCut(s, 19);
  assert.equal(cut.kept, 25);
});

test("the threshold reads as two decimals unless ties would flood the view", () => {
  const s = scores(900);
  const cut = chooseOpeningEvidenceCut(s, 100);
  assert.equal(Math.round(cut.threshold * 100) / 100, cut.threshold);
  const ties = [...Array.from({ length: 60 }, (_, i) => 0.999 - i * 0.0001), ...Array(300).fill(0.9)];
  const tied = chooseOpeningEvidenceCut(ties, 100);
  assert.ok(tied.kept <= 72, `kept ${tied.kept}`);
});
