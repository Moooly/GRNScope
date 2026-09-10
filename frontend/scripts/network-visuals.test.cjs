/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness installs a local TypeScript loader. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const cytoscape = require("cytoscape");
// Compile only the imported pure TypeScript modules; no browser or app server needed.
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
const base = "../app/projects/[projectId]/_components/";
const {
  edgeMetric,
  metricWidth,
  percent,
  relationshipLabel,
  hasDirection,
  signColor,
} = require(base + "networkVisualEncoding.ts");
const {
  buildGraphElements,
  buildHierarchicalPositions,
  buildCircularPositions,
  buildConcentricPositions,
} = require(base + "networkGraphLayouts.ts");
const { getNetworkGraphStylesheet } = require(base + "networkGraphStyles.ts");
const node = (id, isTF = false) => ({
  id,
  isTF,
  degree: 2,
  inDegree: 1,
  outDegree: 1,
});
const edge = (overrides = {}) => ({
  key: "A-B",
  source: "A",
  target: "B",
  score: 0.8,
  confidence: 0.6,
  bootstrapVerified: true,
  count: 2,
  rank: 1,
  supportingAlgorithms: ["one", "two"],
  direction: 1,
  directionConfidence: 0.7,
  directionCoverage: 1,
  sign: 1,
  signConfidence: 0.8,
  signCoverage: 0.6,
  ...overrides,
});

test("missing and legacy confidence never masquerade as zero confidence", () => {
  assert.equal(
    edgeMetric(edge({ bootstrapVerified: false }), "confidence", 3),
    null,
  );
  assert.equal(
    edgeMetric(edge({ bootstrapVerified: undefined }), "confidence", 3),
    null,
  );
  assert.equal(edgeMetric(edge({ confidence: NaN }), "confidence", 3), null);
  assert.equal(edgeMetric(edge({ confidence: 0 }), "confidence", 3), 0);
  assert.equal(percent(null), "Unavailable");
  assert.equal(percent(0.003), "<1%");
});
test("all metrics use absolute scales that do not depend on other displayed edges", () => {
  const e = edge();
  assert.ok(Math.abs(metricWidth(edgeMetric(e, "evidence", 3)) - 2.4) < 1e-10);
  assert.ok(Math.abs(metricWidth(edgeMetric(e, "confidence", 3)) - 2) < 1e-10);
  assert.equal(edgeMetric(e, "support", 4), 0.5);
  assert.equal(edgeMetric(e, "support", 8), 0.25);
  assert.equal(edgeMetric(e, "support", 0), null);
  assert.equal(metricWidth(0), 0.8);
  assert.equal(metricWidth(1), 2.8);
});
test("activation and repression tips follow resolved direction, including reversed edges", () => {
  const fixture = [
    edge({ key: "positive", direction: 0 }),
    edge({ key: "negative", sign: -1, direction: -1 }),
    edge({ key: "unsigned", sign: 0 }),
    edge({ key: "unresolved", directionConfidence: null }),
    edge({ key: "activation" }),
    edge({ key: "repression", sign: -1 }),
    edge({ key: "uncovered", sign: -1, directionCoverage: 0 }),
  ];
  const elements = buildGraphElements(
    [node("A", true), node("B")],
    fixture,
  ).elements;
  const data = (key) => elements.find((e) => e.data.id === key).data;
  assert.equal(data("positive").edgeColor, signColor(1));
  assert.equal(data("positive").targetArrowShape, "none");
  assert.equal(data("negative").sourceArrowShape, "tee");
  assert.equal(data("negative").edgeColor, signColor(-1));
  assert.equal(data("negative").targetArrowShape, "none");
  assert.equal(data("unsigned").targetArrowShape, "triangle");
  assert.equal(data("unsigned").edgeColor, signColor(0));
  assert.equal(data("unsigned").arrowFill, "hollow");
  assert.equal(data("unresolved").targetArrowShape, "none");
  assert.equal(data("activation").targetArrowShape, "triangle");
  assert.equal(data("activation").sourceArrowShape, "none");
  assert.equal(data("activation").arrowFill, "filled");
  assert.equal(data("repression").targetArrowShape, "tee");
  assert.equal(data("repression").sourceArrowShape, "none");
  assert.equal(data("uncovered").targetArrowShape, "none");
  assert.equal(data("uncovered").edgeColor, signColor(-1));
  assert.equal(relationshipLabel(fixture[1]), "B ⊣ A");
  assert.equal(hasDirection(fixture[3]), false);
});
test("TF identity is encoded by shape, never by a degree-scaled size", () => {
  const elements = buildGraphElements(
    [node("A", true), { ...node("B", true), degree: 200 }, node("C")],
    [],
  ).elements;
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    style: getNetworkGraphStylesheet(),
  });
  assert.equal(cy.$id("A").style("shape"), "diamond");
  assert.equal(cy.$id("C").style("shape"), "ellipse");
  assert.equal(cy.$id("A").style("width"), cy.$id("B").style("width"));
  cy.destroy();
});
test("selecting an edge preserves its sign color and metric width", () => {
  const elements = buildGraphElements(
    [node("A"), node("B")],
    [edge({ sign: -1 })],
  ).elements;
  elements.find((e) => e.data.id === "A-B").data.metricWidth = 3.4;
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    style: getNetworkGraphStylesheet(),
  });
  const e = cy.$id("A-B");
  const before = [e.style("line-color"), e.style("width")];
  assert.equal(e.style("label"), "");
  assert.equal(e.style("target-arrow-shape"), "tee");
  e.addClass("hovered local-edge");
  assert.equal(e.style("label"), "");
  e.select();
  assert.equal(e.style("label"), "");
  assert.deepEqual([e.style("line-color"), e.style("width")], before);
  cy.destroy();
});
test("flow, hubs and circle handle cycles and disconnected components", () => {
  const nodes = ["A", "B", "C", "D", "E", "F"].map((id) => node(id));
  const edges = [
    ["A", "B"],
    ["B", "C"],
    ["C", "A"],
    ["D", "E"],
  ].map(([source, target]) => edge({ key: source + target, source, target }));
  for (const layout of [
    buildHierarchicalPositions,
    buildCircularPositions,
    buildConcentricPositions,
  ]) {
    const positions = layout(nodes, edges);
    assert.equal(Object.keys(positions).length, nodes.length);
    assert.ok(
      Object.values(positions).every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    );
    assert.deepEqual(
      layout(nodes, edges),
      positions,
      "same topology has deterministic alternative layouts",
    );
  }
});

const {
  createAtlasLayout,
  atlasFootprint,
  atlasReadability,
  packAtlasComponents,
} = require(base + "networkAtlasLayout.ts");
const layoutFixtures = require("./network-layout-fixtures.cjs");
const viewport = { width: 1200, height: 450 };
for (const fixture of layoutFixtures) {
  test(`Atlas reserves every full label: ${fixture.name}`, () => {
    let positions;
    createAtlasLayout(fixture.nodes, fixture.edges, viewport, {
      synchronous: true,
      onComplete: (p) => {
        positions = p;
      },
    });
    assert.equal(Object.keys(positions).length, fixture.nodes.length);
    // Check footprint geometry independently from the selection score.
    for (let i = 0; i < fixture.nodes.length; i++)
      for (let j = i + 1; j < fixture.nodes.length; j++) {
        const a = fixture.nodes[i],
          b = fixture.nodes[j],
          pa = positions[a.id],
          pb = positions[b.id];
        const fa = atlasFootprint(a),
          fb = atlasFootprint(b);
        assert.ok(Number.isFinite(pa.x) && Number.isFinite(pa.y));
        assert.ok(
          Math.abs(pa.x - pb.x) >= (fa.width + fb.width) / 2 - 0.1 ||
            Math.abs(pa.y - pb.y) >= (fa.height + fb.height) / 2 - 0.1,
          `${a.id} overlaps ${b.id}`,
        );
      }
    let colaPositions;
    createAtlasLayout(fixture.nodes, fixture.edges, viewport, {
      synchronous: true,
      compareCose: false,
      onComplete: (p) => {
        colaPositions = p;
      },
    });
    assert.ok(
      atlasReadability(fixture.nodes, positions, viewport) >=
        atlasReadability(fixture.nodes, colaPositions, viewport) - 0.001,
      "automatic choice must not reduce fitted label size",
    );
  });
}
test("component packing preserves internal distances and separates disconnected bounds", () => {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: "preset" },
    elements: [
      { data: { id: "a" }, position: { x: 0, y: 0 } },
      { data: { id: "b" }, position: { x: 0, y: 150 } },
      { data: { id: "c" }, position: { x: 0, y: 0 } },
      { data: { id: "d" }, position: { x: 0, y: 150 } },
      { data: { id: "ab", source: "a", target: "b" } },
      { data: { id: "cd", source: "c", target: "d" } },
    ],
    style: [{ selector: "node", style: { width: 60, height: 60 } }],
  });
  const p = packAtlasComponents(cy, viewport);
  assert.ok(Math.abs(Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y) - 150) < 1e-6);
  assert.ok(Math.abs(Math.hypot(p.c.x - p.d.x, p.c.y - p.d.y) - 150) < 1e-6);
  for (const a of ["a", "b"])
    for (const b of ["c", "d"])
      assert.ok(
        Math.abs(p[a].x - p[b].x) >= 60 || Math.abs(p[a].y - p[b].y) >= 60,
      );
  cy.destroy();
});
test("cancelled layout never publishes stale positions", async () => {
  let completions = 0;
  const f = layoutFixtures[0];
  const cancel = createAtlasLayout(f.nodes, f.edges, viewport, {
    onComplete: () => {
      completions++;
    },
  });
  cancel();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(completions, 0);
});
test("empty Atlas completes safely", () => {
  let result;
  createAtlasLayout([], [], viewport, {
    onComplete: (p) => {
      result = p;
    },
  });
  assert.deepEqual(result, {});
});

test("inspection camera contains endpoints and long annotation after the canvas narrows", () => {
  const { selectionViewport } = require(base + "networkCamera.ts");
  const box = { x1: 700, y1: 100, w: 500, h: 360 };
  for (const size of [
    { width: 740, height: 560 },
    { width: 340, height: 400 },
  ]) {
    const view = selectionViewport(box, size, 1.5, 0.02);
    assert.ok(
      view.zoom <= 1.5,
      "inspection must not unexpectedly enlarge the graph",
    );
    assert.ok(box.x1 * view.zoom + view.pan.x >= 63.99);
    assert.ok((box.x1 + box.w) * view.zoom + view.pan.x <= size.width - 63.99);
    assert.ok(box.y1 * view.zoom + view.pan.y >= 63.99);
    assert.ok((box.y1 + box.h) * view.zoom + view.pan.y <= size.height - 63.99);
  }
});
