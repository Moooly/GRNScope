/* eslint-disable @typescript-eslint/no-require-imports -- Run TypeScript coordinate contracts and render the real Circos component. */
const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const compile = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const { coordinateMatchesReference, normalizeChromosome, referenceForProject } = require('../app/projects/[projectId]/_lib/genomeCoordinates.ts');
const Circos = require('../app/projects/[projectId]/_components/CircosNetworkGraph.tsx').default;
const { buildCircosSummary, circosScope } = require('../app/projects/[projectId]/_components/circosModel.ts');
const reference = (species) => ({ species, assembly: species === 'mouse' ? 'GRCm39' : 'GRCh38', annotation: species === 'mouse' ? 'GENCODE M39' : 'GENCODE v50', chromosome_order: [...Array.from({ length: species === 'mouse' ? 19 : 22 }, (_, i) => `chr${i + 1}`), 'chrX', 'chrY', 'chrM'] });
const mouse = reference('mouse'), human = reference('human');
const location = (species = 'mouse') => ({ chromosome: 'chr11', start: 100, coordinate_species: species, coordinate_assembly: species === 'mouse' ? 'GRCm39' : 'GRCh38' });

test('a project only accepts its own supported species and assembly reference', () => {
  assert.equal(referenceForProject(mouse, 'mouse'), mouse);
  assert.equal(referenceForProject(human, 'human'), human);
  for (const species of ['human', 'rat', 'other', undefined]) assert.equal(referenceForProject(mouse, species), null);
  assert.equal(referenceForProject({ ...mouse, assembly: 'GRCm38' }, 'mouse'), null);
  assert.equal(referenceForProject({ ...mouse, chromosome_order: null }, 'mouse'), null);
});

test('shared gene symbols cannot cross species or assembly boundaries', () => {
  assert.equal(coordinateMatchesReference(location(), mouse), true);
  assert.equal(coordinateMatchesReference(location(), human), false);
  assert.equal(coordinateMatchesReference(location('human'), mouse), false);
  assert.equal(coordinateMatchesReference({ ...location(), coordinate_assembly: 'GRCm38' }, mouse), false);
  assert.equal(coordinateMatchesReference({ chromosome: 'chr11', start: 100 }, mouse), false);
  assert.equal(coordinateMatchesReference({ ...location(), chromosome: 'chr20' }, mouse), false);
  assert.equal(coordinateMatchesReference({ ...location(), start: 0 }, mouse), false);
  assert.equal(coordinateMatchesReference({ ...location(), chromosome: 'MT' }, mouse), true);
  assert.equal(normalizeChromosome('chrMT'), 'chrM');
  assert.equal(normalizeChromosome('x'), 'chrX');
});

test('mouse Circos renders mouse sectors and puts human-coordinate records in Unknown', () => {
  const node = (id, chromosome, species) => ({ id, ...location(species), chromosome, end: 200, degree: 2, inDegree: 1, outDegree: 1, isTF: true, topRegulators: [], topTargets: [] });
  const nodes = [node('Sox9', 'chr11', 'mouse'), node('Pax6', 'chr2', 'mouse'), node('WrongHuman', 'chr17', 'human')];
  const edge = (source, target) => ({ source, target, key: `${source}|${target}`, rank: 1, score: 0.9, confidence: 0.9, count: 1, direction: 1, directionConfidence: 1, sign: 1, supportingAlgorithms: ['GENIE3'] });
  const svg = renderToStaticMarkup(React.createElement(Circos, { genomeReference: mouse, nodes, edges: [edge('Sox9', 'Pax6'), edge('Sox9', 'WrongHuman')] }));
  const doc = new JSDOM(svg).window.document;
  const sectors = [...doc.querySelectorAll('[aria-label*="chromosome sector"]')].map(n => n.getAttribute('aria-label'));
  assert.equal(sectors.length, 3);
  assert.ok(sectors.some(s => s.startsWith('11 chromosome sector')));
  assert.ok(sectors.some(s => s.startsWith('2 chromosome sector')));
  assert.ok(sectors.some(s => s.startsWith('Unknown chromosome sector')));
  assert.ok(!sectors.some(s => s.startsWith('17 chromosome sector')));
  assert.match(svg, /Mouse · GRCm39 · GENCODE M39/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

const panelNode = (id, chromosome, species = 'mouse') => ({ id, ...location(species), chromosome, end: 200, degree: 2, inDegree: 1, outDegree: 1, isTF: true, topRegulators: [], topTargets: [] });
const panelEdge = (source, target, extra = {}) => ({ source, target, key: `${source}|${target}`, rank: 1, score: 0.9, confidence: 0.9, count: 1, direction: 1, directionCoverage: 1, directionConfidence: 1, sign: 1, supportingAlgorithms: ['GENIE3'], ...extra });

test('Circos panel counts each relationship once per chromosome and separates unresolved directions', () => {
  const nodes = [panelNode('A', 'chr11'), panelNode('B', 'chr11'), panelNode('C', 'chr2')];
  const edges = [panelEdge('A', 'B'), panelEdge('A', 'C'), panelEdge('C', 'B'), panelEdge('B', 'C', { direction: 0 }), panelEdge('C', 'A', { direction: -1 })];
  const summary = buildCircosSummary(nodes, edges, mouse);
  const chr11 = summary.chromosomes.get('chr11');
  assert.equal(chr11.edges.length, 5, 'within-chromosome relationships count once, not twice');
  assert.deepEqual([chr11.incoming, chr11.outgoing, chr11.internal, chr11.unresolved], [1, 2, 1, 1]);
  assert.equal(summary.mappedCount, 3);
  assert.equal(summary.unmappedCount, 0);
});

test('Circos panel scopes match ribbon membership, drop orphan genes, and reset missing groups', () => {
  const nodes = [panelNode('A', 'chr11'), panelNode('B', 'chr11'), panelNode('C', 'chr2'), panelNode('Foreign', 'chr17', 'human'), panelNode('Orphan', 'chr3')];
  const edges = [panelEdge('A', 'B'), panelEdge('A', 'C'), panelEdge('A', 'Foreign'), panelEdge('A', 'A'), panelEdge('Missing', 'C')];
  const summary = buildCircosSummary(nodes, edges, mouse);
  assert.equal(summary.edges.length, 3);
  assert.equal(summary.nodes.length, 4);
  assert.equal(summary.unmappedCount, 1);
  const key = 'chr11|||chr2|||activation';
  const ribbon = circosScope(summary, { kind: 'bundle', bundleKey: key });
  assert.deepEqual(ribbon.edges.map(e => e.key), ['A|C']);
  assert.deepEqual(ribbon.nodes.map(n => n.id), ['A', 'C']);
  const chromosome = circosScope(summary, { kind: 'chromosome', chromosome: 'unmapped' });
  assert.deepEqual(chromosome.edges.map(e => e.key), ['A|Foreign']);
  assert.equal(circosScope(summary, { kind: 'bundle', bundleKey: 'removed' }).focus, null);
  assert.equal(circosScope(summary, { kind: 'chromosome', chromosome: 'chr19' }).focus, null);
});

test('the real Circos renderer responds to a panel-controlled chromosome or ribbon focus', () => {
  const nodes = [panelNode('A', 'chr11'), panelNode('B', 'chr2')];
  const edges = [panelEdge('A', 'B')];
  for (const focus of [{ kind: 'chromosome', chromosome: 'chr11' }, { kind: 'bundle', bundleKey: 'chr11|||chr2|||activation' }]) {
    const markup = renderToStaticMarkup(React.createElement(Circos, { genomeReference: mouse, nodes, edges, focus }));
    const doc = new JSDOM(markup).window.document;
    assert.match(doc.querySelector('svg[role="group"]').getAttribute('aria-label'), /^Gene-level Circos view/);
    assert.match(markup, /1 regulation/);
    assert.doesNotMatch(markup, /NaN|Infinity/);
  }
});
