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

test("gallery presets preserve topology, tips, metric widths and selection semantics", (t) => {
  const { NETWORK_APPEARANCES, updateGalleryCurves } = require(
    base + "networkAppearance.ts",
  );
  const elements = buildGraphElements(
    [node("A", true), node("B"), node("C")],
    [edge({ sign: -1 }), edge({ key: "A-C", target: "C" })],
  ).elements;
  elements
    .filter((e) => e.data.source)
    .forEach((e) =>
      Object.assign(e.data, { metricWidth: 2.1, galleryCurve: [0, 0] }),
    );
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    layout: { name: "preset" },
  });
  cy.$id("A").position({ x: 0, y: 0 });
  // Release Cytoscape timers even when a preset assertion fails.
  t.after(() => cy.destroy());
  cy.$id("B").position({ x: 160, y: 50 });
  cy.$id("C").position({ x: 90, y: -100 });
  const positions = cy.nodes().map((n) => ({ ...n.position() }));
  for (const preset of Object.keys(NETWORK_APPEARANCES)) {
    updateGalleryCurves(cy, preset);
    cy.style(getNetworkGraphStylesheet("light", preset));
    assert.deepEqual(
      cy.nodes().map((n) => ({ ...n.position() })),
      positions,
    );
    assert.equal(cy.$id("A").style("shape"), "diamond");
    assert.equal(cy.$id("B").style("shape"), "ellipse");
    const e = cy.$id("A-B");
    assert.equal(e.style("target-arrow-shape"), "tee");
    assert.equal(cy.$id("A-C").style("target-arrow-shape"), "triangle");
    assert.notEqual(e.style("line-color"), cy.$id("A-C").style("line-color"));
    assert.equal(e.style("label"), "");
    assert.equal(parseFloat(e.style("width")), 2.1);
    const color = e.style("line-color");
    e.select();
    assert.equal(e.style("line-color"), color);
    e.unselect();
    if (["silver", "graphite"].includes(preset)) {
      assert.ok(e.data("galleryCurve").every(Number.isFinite));
      assert.ok(e.data("galleryCurve").some((v) => v !== 0));
    }
    if (["silver", "graphite"].includes(preset))
      assert.notEqual(cy.$id("B").style("background-fill"), "solid");
  }
});

test("gene and relationship limits grow honestly without fabricating nodes", () => {
  const { selectNetworkDisplay } = require(base + "networkDisplay.ts");
  const fixture = require("./network-branch-fixture.cjs");
  const small = selectNetworkDisplay(fixture.edges, 20, "genes");
  const large = selectNetworkDisplay(fixture.edges, 100, "genes");
  assert.equal(small.geneIds.size, 20);
  assert.equal(large.geneIds.size, 100);
  assert.ok([...small.geneIds].every((id) => large.geneIds.has(id)));
  assert.ok(
    large.edges.every(
      (e) => large.geneIds.has(e.source) && large.geneIds.has(e.target),
    ),
  );
  assert.equal(
    selectNetworkDisplay(fixture.edges, 20, "relationships").edges.length,
    20,
  );
  assert.equal(
    selectNetworkDisplay(fixture.edges, 0, "genes").geneIds.size,
    146,
  );
  const dense = Array.from({ length: 19 }, (_, i) =>
    Array.from({ length: 18 - i }, (_, j) => ({
      source: `g${i}`,
      target: `g${i + j + 1}`,
    })),
  ).flat();
  assert.equal(selectNetworkDisplay(dense, 100, "genes").geneIds.size, 19);
  assert.equal(
    selectNetworkDisplay(dense, 100, "relationships").edges.length,
    100,
  );
});

test("branch layout spreads hubs and terminal chains with no lost nodes or full-label overlaps", async () => {
  const { createBranchLayout, branchStructure } = require(
    base + "networkBranchLayout.ts",
  );
  const { selectNetworkDisplay } = require(base + "networkDisplay.ts");
  const fixture = require("./network-branch-fixture.cjs");
  for (const count of [20, 100, 146]) {
    const display = selectNetworkDisplay(fixture.edges, count, "genes");
    const nodes = fixture.nodes.filter((n) => display.geneIds.has(n.id));
    const result = await new Promise((resolve) =>
      createBranchLayout(
        nodes,
        display.edges,
        { width: 1280, height: 700 },
        { synchronous: true, onComplete: resolve },
      ),
    );
    assert.equal(Object.keys(result).length, count);
    for (const p of Object.values(result))
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = result[nodes[i].id],
          b = result[nodes[j].id];
        const widthA = Math.max(50, nodes[i].id.length * 8 + 12),
          widthB = Math.max(50, nodes[j].id.length * 8 + 12);
        assert.ok(
          Math.abs(a.x - b.x) >= (widthA + widthB) / 2 ||
            Math.abs(a.y - b.y) >= 64,
          `overlap: ${nodes[i].id} / ${nodes[j].id}`,
        );
      }
    if (count === 146) {
      const plan = branchStructure(nodes, display.edges);
      assert.equal(plan.core.size, 6);
      assert.equal(plan.parent.get("CHAIN_7"), "CHAIN_6");
      assert.ok(
        Math.hypot(
          result.HUB_1.x - result.HUB_2.x,
          result.HUB_1.y - result.HUB_2.y,
        ) > 350,
      );
    }
  }
});

test("branch routing curves compatible leaf fans and leaves bridges straight", () => {
  const { updateBranchCurves } = require(base + "networkAppearance.ts");
  const nodes = ["H", "a", "b", "c", "d", "Q"].map((id) => node(id));
  const edges = ["a", "b", "c", "d", "Q"].map((target) =>
    edge({ key: "H-" + target, source: "H", target }),
  );
  const cy = cytoscape({
    headless: true,
    elements: buildGraphElements(nodes, edges).elements,
    layout: { name: "preset" },
  });
  cy.$id("H").position({ x: 0, y: 0 });
  ["a", "b", "c", "d"].forEach((id, i) =>
    cy.$id(id).position({ x: 200, y: 25 + i * 25 }),
  );
  cy.$id("Q").position({ x: -200, y: 0 });
  updateBranchCurves(cy);
  assert.equal(cy.$id("H-Q").data("galleryRoute"), "straight");
  assert.ok(
    cy.edges().some((e) => e.data("galleryRoute") === "unbundled-bezier"),
  );
  assert.ok(
    cy.edges().every((e) => e.data("galleryCurve").every(Number.isFinite)),
  );
  cy.destroy();
});
