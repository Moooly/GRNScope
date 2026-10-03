/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const cytoscape = require("cytoscape");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const base = "../app/projects/[projectId]/_components/network/";
const { buildPaperFigure, PAPER } = require(base + "paperExport.ts");
const { figureLegend, activeFilters, linkRows, geneRows, supplementaryWorkbook, linksCsv } = require(base + "paperData.ts");
const { galaxyElements } = require(base + "model.ts");

const nodes = [{ id: "SOX9", isTF: true }, { id: "SRY", isTF: true }, { id: "DKK1", isTF: false }, { id: "FGF9", isTF: false }];
const edge = (key, source, target, sign, score, direction = 1) => ({ key, source, target, score, confidence: 1, bootstrapVerified: true, count: 5, rank: 1, supportingAlgorithms: ["GENIE3", "PIDC"], direction, directionConfidence: 1, directionCoverage: 1, sign, signConfidence: 1, signCoverage: 1 });
const edges = [edge("1", "SOX9", "DKK1", 1, 0.93), edge("2", "SRY", "SOX9", 1, 0.85), edge("3", "SOX9", "FGF9", -1, 0.81)];
const ctx = { projectName: "Demo", projectId: "p1", methods: ["GENIE3", "PIDC"], filters: "Evidence ≥ 0.80; confidence ≥ 0%; direction confidence ≥ 0%; sign stability ≥ 0%; support ≥ 1", scope: "Global", focus: null, effect: "all", palette: "soft", sizeBy: "all", widthBy: "evidence" };

function graph() {
  const els = galaxyElements(nodes, edges, { methodCount: 2 });
  const cy = cytoscape({ headless: true, styleEnabled: false, elements: els, layout: { name: "preset" } });
  [[0, 0], [200, 0], [100, 150], [-150, 120]].forEach(([x, y], i) => cy.nodes()[i].position({ x, y }));
  cy.scratch("networkEncoding", { widthBy: "evidence", methodCount: 2 });
  return cy;
}

test("the paper figure is 183 mm wide, in print units, with only the figure and its key", () => {
  const cy = graph();
  try {
    const { svg, widthMm, heightMm } = buildPaperFigure(cy);
    assert.equal(widthMm, PAPER.widthMm);
    assert.match(svg, /width="183mm"/);
    assert.ok(heightMm > 50 && heightMm < 247, `height ${heightMm}`);
    const nameSize = (7 * 25.4 / 72).toFixed(3);
    assert.ok(svg.includes(`font-size="${Number(nameSize)}"`), "gene names are 7 pt");
    for (const id of ["SOX9", "SRY", "DKK1", "FGF9"]) assert.ok(svg.includes(`>${id}</text>`), `${id} named`);
    assert.ok(!/Regulatory network<\/text>|Methods \(|Filters:/.test(svg), "no title or paragraph baked in");
    assert.ok(svg.includes(">Activation</text>") && svg.includes(">Repression</text>"), "key names the tips drawn");
    assert.ok(!svg.includes("≥"), "key text stays within the standard PDF fonts");
    assert.ok(!/rx=/.test(svg), "nothing rounded");
  } finally { cy.destroy(); }
});

test("the legend describes what is shown and only the filters that cut", () => {
  assert.deepEqual(activeFilters(ctx.filters), ["Evidence ≥ 0.80"]);
  const text = figureLegend(nodes, edges, ctx);
  assert.match(text, /Network of 4 genes and 3 regulatory edges \(evidence ≥ 0\.80\), inferred by consensus of 2 methods \(GENIE3 and PIDC\)\./);
  assert.match(text, /Blue circles, transcription factors; yellow circles, other genes/);
  assert.match(text, /Arrowheads, activation; bars, repression\./);
  assert.ok(!/faded lines/.test(text), "no confidence sentence when every edge is confident");
});

test("tables list the figure's edges strongest first, oriented regulator → target", () => {
  const rows = linkRows(edges);
  assert.deepEqual(rows.map(r => [r.regulator, r.target]), [["SOX9", "DKK1"], ["SRY", "SOX9"], ["SOX9", "FGF9"]]);
  assert.equal(geneRows(nodes, edges)[0].gene, "SOX9");
  assert.equal(linksCsv(edges).split("\n")[0], "regulator,target,effect,direction_resolved,evidence,bootstrap_confidence,methods_agreeing,methods");
});

test("the workbook has Edges, Genes and About sheets", async () => {
  const blob = await supplementaryWorkbook(nodes, edges, ctx);
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const book = await zip.file("xl/workbook.xml").async("string");
  assert.match(book, /name="Edges".*name="Genes".*name="About"/);
  const links = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(links, /state="frozen"/);
  assert.match(links, /<t xml:space="preserve">SOX9<\/t>/);
});
