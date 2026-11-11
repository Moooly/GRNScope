/* eslint-disable @typescript-eslint/no-require-imports -- Render the real benchmark figure. */
const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
const { SummaryHeatmap } = require('../app/projects/[projectId]/_components/BenchmarkFigures.tsx');
const row = {id:'A',auprcRatio:2.8,eprRatio:1,auroc:.6,activation:null,inhibition:0,stability:null,runtime:null,pr:[],roc:[]};
const render = bootstrap => renderToStaticMarkup(React.createElement(SummaryHeatmap,{rows:[{...row,bootstrap}],showSigned:true,showStability:false}));
test('forest uses the saved-run median and range rather than the final-network score',()=>{
  const markup=render({run_count:3,unavailable_run_count:1,median:1.4,minimum:.8,maximum:1.7});
  assert.match(markup,/1.40 \[0.80–1.70\]/);
  assert.match(markup,/3 scored runs; 1 unavailable/);
  assert.match(markup,/bootstrap range/);
  assert.doesNotMatch(markup,/95% CI|p vs|NaN|Infinity/);
  assert.match(markup,/3\*/);
});
test('one run has a square without claiming a range, missing archives stay unavailable',()=>{
  assert.match(render({run_count:1,unavailable_run_count:0,median:1.2,minimum:1.2,maximum:1.2}),/1.20 \[one run\]/);
  const markup=render(null);
  assert.match(markup,/unavailable/);
  assert.doesNotMatch(markup,/95% CI|NaN|Infinity/);
});
