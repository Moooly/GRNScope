/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act } = React;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
global.window = dom.window;
global.document = dom.window.document;
global.requestAnimationFrame = callback => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.ResizeObserver = class { observe() {} disconnect() {} };
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
require.extensions['.tsx'] = require.extensions['.ts'];
const ProjectOutputExports = require('../app/projects/[projectId]/_components/ProjectOutputExports.tsx').default;
const edge = (id, source, target) => ({ key: id+source+target, source, target, score: 0.9, confidence: 0.8, count: 1, rank: 1, perAlgorithmScores: { [id]: 0.9 }, supportingAlgorithms: [id], direction: 1, directionConfidence: 1, directionCoverage: 1, sign: 1, signConfidence: 1, signCoverage: 1, bootstrapVerified: true });

test('exports unvisited comparison and network tables without triggering browser downloads; unavailable figures stay excluded', async () => {
  const holder = document.createElement('div'); document.body.append(holder);
  const root = createRoot(holder);
  const rows = { A: [edge('A','SOX9','FGF9')], B: [edge('B','SOX9','FGF9')] };
  let outputs = [], anchors = 0;
  const originalClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = () => { anchors++; };
  const onChange = next => { outputs = next; };
  try {
    await act(async () => {
      root.render(React.createElement(ProjectOutputExports, { insights: { algorithmEdgeRows: rows, algorithmMetaMap: new Map([['A',{ directed:true }],['B',{ directed:true }]]), algorithmResults: {}, activeAlgorithmIds:['A','B'], selectedResultScopeId:'global', tasks:[], visualizationContext: null, isContextLoading:false }, networkEdges: rows.A, onChange, onReady() {} }));
    });
    const tables = outputs.filter(output => output.group === 'tables');
    assert.ok(tables.some(output => output.label.includes('method-agreement')));
    assert.ok(tables.some(output => output.label.includes('key regulators')));
    assert.ok(tables.some(output => output.label.includes('Distribution table')));
    assert.ok(!outputs.some(output => output.group === 'figures' && output.label.includes('repeat-run')));
    for (const output of tables) {
      const files = await output.build('svg', new AbortController().signal);
      assert.equal(files.length, 1, output.label);
      assert.match(files[0].filename, /^analysis_outputs\/tables\//);
      assert.ok((await files[0].blob.text()).length > 0);
    }
    assert.equal(anchors, 0, 'collecting a ZIP never clicks separate download links');
    assert.ok(outputs.filter(output => output.group === 'figures').every(output => output.formats.includes('svg') && output.formats.includes('png')));
  } finally {
    await act(async () => root.unmount()); holder.remove();
    dom.window.HTMLAnchorElement.prototype.click = originalClick;
  }
});
