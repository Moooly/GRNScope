/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node comparison of layout engines. */
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  );
const cytoscape = require("cytoscape");
cytoscape.use(require("cytoscape-cose-bilkent"));
const {
  createAtlasLayout,
  atlasFootprint,
  packAtlasComponents,
} = require("../app/projects/[projectId]/_components/networkAtlasLayout.ts");
const {
  getLayoutConfig,
} = require("../app/projects/[projectId]/_components/networkGraphLayouts.ts");
const fixtures = require("./network-layout-fixtures.cjs");
const viewport = { width: 1200, height: 450 };
function metrics(nodes, positions) {
  let overlaps = 0;
  const boxes = nodes.map((n) => {
    const f = atlasFootprint(n),
      p = positions[n.id];
    return {
      x1: p.x - f.width / 2,
      x2: p.x + f.width / 2,
      y1: p.y + 14 - f.height / 2,
      y2: p.y + 14 + f.height / 2,
    };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (
        Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.1 &&
        Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.1
      )
        overlaps++;
    }
  const width =
    Math.max(...boxes.map((b) => b.x2)) - Math.min(...boxes.map((b) => b.x1));
  const height =
    Math.max(...boxes.map((b) => b.y2)) - Math.min(...boxes.map((b) => b.y1));
  const zoom = Math.min(
    (viewport.width - 80) / width,
    (viewport.height - 80) / height,
    3,
  );
  return {
    overlappingFootprints: overlaps,
    fitLabelPixels: +(13 * zoom).toFixed(1),
    width: Math.round(width),
    height: Math.round(height),
  };
}
for (const fixture of fixtures) {
  const { nodes, edges } = fixture;
  for (const engine of ["CoSE", "WebCola", "Atlas automatic"]) {
    let positions;
    const started = performance.now();
    if (engine !== "CoSE")
      createAtlasLayout(nodes, edges, viewport, {
        synchronous: true,
        compareCose: engine === "Atlas automatic",
        onComplete: (p) => (positions = p),
      });
    else {
      const cy = cytoscape({
        headless: true,
        styleEnabled: true,
        layout: { name: "preset" },
        elements: [
          ...[...nodes]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((n, i) => ({
              data: { id: n.id, ...atlasFootprint(n) },
              position: {
                x:
                  55 *
                  Math.sqrt(i) *
                  Math.cos(i * Math.PI * (3 - Math.sqrt(5))),
                y:
                  55 *
                  Math.sqrt(i) *
                  Math.sin(i * Math.PI * (3 - Math.sqrt(5))),
              },
            })),
          ...[...edges]
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((e) => ({
              data: { id: e.key, source: e.source, target: e.target },
            })),
        ],
        style: [
          {
            selector: "node",
            style: { width: "data(width)", height: "data(height)", label: "" },
          },
        ],
      });
      cy.layout({
        ...getLayoutConfig(
          "force",
          { nodeCount: nodes.length, edgeCount: edges.length },
          nodes,
          edges,
        ),
        fit: false,
        randomize: false,
      }).run();
      positions = packAtlasComponents(cy, viewport);
      cy.destroy();
    }
    console.log(
      JSON.stringify({
        fixture: fixture.name,
        engine,
        ...metrics(nodes, positions),
        milliseconds: Math.round(performance.now() - started),
      }),
    );
  }
}
