/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const JSZip = require('jszip');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const { buildProjectPackage, safeOutputPath, edgeOutputFile } = require('../app/projects/[projectId]/_lib/projectPackage.ts');
const base = async () => {
  const zip = new JSZip();
  zip.file('demo_data/project_manifest.json', JSON.stringify({ files: [{ path: 'original_inputs/input.csv', sha256: 'existing-checksum' }] }));
  zip.file('demo_data/original_inputs/input.csv', 'gene,cell\nA,1');
  return zip.generateAsync({ type: 'arraybuffer' });
};
const output = (path, text, id = path) => ({ id, label: id, group: 'tables', build: async () => [{ filename: path, blob: new Blob([text]) }] });
const build = async (outputs, options = {}) => buildProjectPackage({ base: await base(), outputs, format: 'svg', settings: { scope: 'global', evidence_threshold: 0.5 }, signal: new AbortController().signal, onProgress() {}, ...options });

test('ZIP includes only chosen outputs and preserves input configuration, with a real output inventory', async () => {
  const zip = await JSZip.loadAsync(Buffer.from(await (await build([output('analysis_outputs/tables/summary.csv', 'method,score\nA,1')])).arrayBuffer()));
  const manifest = JSON.parse(await zip.file('demo_data/project_manifest.json').async('string'));
  assert.equal(await zip.file('demo_data/original_inputs/input.csv').async('string'), 'gene,cell\nA,1');
  assert.equal(manifest.files[0].sha256, 'existing-checksum');
  assert.equal(manifest.export_settings.evidence_threshold, 0.5);
  assert.equal(manifest.analysis_outputs.files.length, 1);
  assert.equal(manifest.analysis_outputs.files[0].path, 'analysis_outputs/tables/summary.csv');
  assert.equal(manifest.analysis_outputs.files[0].size_bytes, 16);
  assert.match(manifest.analysis_outputs.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(zip.file('demo_data/analysis_outputs/figures/chart.svg'), null);
});

test('figure generation is awaited and receives the requested format', async () => {
  const figure = { id: 'figure', label: 'Chart', group: 'figures', async build(format) { await new Promise(resolve => setTimeout(resolve, 5)); return [{ filename: `analysis_outputs/figures/chart.${format}`, blob: new Blob(['raster']) }]; } };
  const zip = await JSZip.loadAsync(Buffer.from(await (await build([figure], { format: 'png' })).arrayBuffer()));
  assert.equal(await zip.file('demo_data/analysis_outputs/figures/chart.png').async('string'), 'raster');
});

test('unavailable outputs fail visibly instead of silently creating an incomplete ZIP', async () => {
  await assert.rejects(build([{ id: 'missing', label: 'Missing chart', group: 'figures', build: async () => [] }]), /Missing chart could not be generated/);
  await assert.rejects(build([output('analysis_outputs/tables/same.csv', 'first'), output('analysis_outputs/tables/same.csv', 'second')]), /same filename/);
});

test('ZIP rejects unsafe paths and stops on cancellation', async () => {
  for (const path of ['../secret', '/absolute', 'analysis_outputs/../input', 'analysis_outputs\\secret', 'analysis_outputs//file']) assert.throws(() => safeOutputPath(path));
  await assert.rejects(build([output('original_inputs/overwrite.csv', 'bad')]), /outside/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(build([], { signal: controller.signal }), { name: 'AbortError' });
});

test('method CSV preserves evidence, confidence, direction and bootstrap details', async () => {
  const file = edgeOutputFile('edges.csv', [{ rank: 1, source: 'A', target: 'B', score: 0.9, confidence: 0.75, perAlgorithmRawScores: { M: -0.5 }, bootstrapSelectedRuns: 3, bootstrapRunCount: 4, count: 1, supportingAlgorithms: ['M'], direction: 1, directionConfidence: 1, sign: -1, signConfidence: 0.8 }]);
  const csv = await file.blob.text();
  assert.match(csv, /"runs_recovered","bootstrap_runs"/);
  assert.match(csv, /"M:-0.5"/);
  assert.match(csv, /"3","4","1","1","-1","0.8"/);
});
