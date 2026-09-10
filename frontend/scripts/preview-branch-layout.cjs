/* eslint-disable @typescript-eslint/no-require-imports -- standalone development preview. */
const fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript");
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
const base = "../app/projects/[projectId]/_components/";
const { createBranchLayout } = require(base + "networkBranchLayout.ts");
const { selectNetworkDisplay } = require(base + "networkDisplay.ts");
const { buildGraphElements } = require(base + "networkGraphLayouts.ts");
const { updateBranchCurves } = require(base + "networkAppearance.ts");
const cyto = require("cytoscape");
const fixture = require("./network-branch-fixture.cjs");
(async () => {
  const graphs = {};
  for (const count of [20, 100, 146]) {
    const display = selectNetworkDisplay(fixture.edges, count, "genes"),
      nodes = fixture.nodes.filter((n) => display.geneIds.has(n.id));
    const positions = await new Promise((resolve) =>
      createBranchLayout(
        nodes,
        display.edges,
        { width: 1280, height: 700 },
        { synchronous: true, onComplete: resolve },
      ),
    );
    const elements = buildGraphElements(nodes, display.edges).elements;
    elements.forEach((e) => {
      if (e.data.source)
        Object.assign(e.data, { metricWidth: 1.1, metricUnavailable: 0 });
      else e.position = positions[e.data.id];
    });
    const cy = cyto({ headless: true, elements, layout: { name: "preset" } });
    updateBranchCurves(cy);
    graphs[count] = cy.json().elements;
    cy.destroy();
  }
  // Render the production layout positions and curve data in a minimal review surface.
  const directory = process.argv[2] || "/tmp/grnscope-branch-review";
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(
    require.resolve("cytoscape/dist/cytoscape.min.js"),
    path.join(directory, "cytoscape.min.js"),
  );
  fs.writeFileSync(
    path.join(directory, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Branch layout validation</title><style>body{margin:0;background:#303738;color:#e1eeeb;font:14px Arial}header{padding:18px 24px;display:flex;gap:20px;align-items:center}h1{font-size:17px;margin:0}p{margin:8px 24px;color:#adbebc}button{padding:8px 18px;border:1px solid #769f98;background:none;color:inherit;border-radius:6px;cursor:pointer}button[aria-pressed=true]{background:#43766d}#cy{height:calc(100vh - 125px);width:100%}</style><header><h1>Synthetic branching fixture</h1><nav>${[20, 100, 146].map((n) => `<button onclick="show(${n})" id="b${n}">${n} genes</button>`).join(" ")}</nav></header><p>Layout validation only — generated topology, not a project result. Same branching layout and routing as Teal / Force.</p><div id="cy"></div><script src="cytoscape.min.js"></script><script>const graphs=${JSON.stringify(graphs)};let cy;function show(n){if(cy)cy.destroy();document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.id==='b'+n));cy=cytoscape({container:document.getElementById('cy'),elements:graphs[n],layout:{name:'preset'},style:[{selector:'node',style:{width:e=>Math.min(44,9+5*Math.sqrt(e.degree())),height:e=>Math.min(44,9+5*Math.sqrt(e.degree())),'background-color':'#e4eeec',label:'data(fullLabel)','font-size':11,color:'#d7e3e0','text-valign':'bottom','text-margin-y':5}},{selector:'node[isTF = 1]',style:{shape:'diamond','font-weight':700}},{selector:'edge',style:{width:1.2,'line-color':'#45c5be',opacity:.45,'curve-style':e=>e.data('galleryRoute'),'control-point-distances':e=>e.data('galleryCurve'),'control-point-weights':[.25,.72],'target-arrow-shape':'triangle','target-arrow-color':'#45c5be','arrow-scale':.6}}]});cy.fit(undefined,35)}show(146)</script>`,
  );
  console.log(directory);
})();
