/* eslint-disable @typescript-eslint/no-require-imports -- Pure TypeScript test harness. */
const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { trajectoryDisplayOrientation } = require('../app/projects/[projectId]/_lib/trajectoryOrientation.ts');
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} != ${b}`);

test('right and top starting positions rotate toward the right', () => {
  for (const [root, tip] of [[{x:5,y:-2},{x:0,y:3}], [{x:0,y:5},{x:0,y:0}]]) {
    const orientation = trajectoryDisplayOrientation([{ points: [root,tip] }]);
    const start = orientation.project(root), end = orientation.project(tip);
    assert.ok(end.x > start.x);
    close(end.y,start.y);
  }
});
test('one rigid transform preserves distances, angles and original data', () => {
  const paths = [{ name:'a',points:[{x:5,y:0,pseudotime:0},{x:0,y:3,pseudotime:7}] },{ name:'b',points:[{x:5,y:0,pseudotime:0},{x:0,y:-3,pseudotime:9}] }];
  const before=JSON.stringify(paths);
  const {project} = trajectoryDisplayOrientation(paths);
  const [a,b,c]=[{x:5,y:0},{x:0,y:3},{x:0,y:-3}];
  const distance=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
  close(distance(a,b),distance(project(a),project(b)));
  close(distance(b,c),distance(project(b),project(c)));
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  close(cross(a,b,c),cross(project(a),project(b),project(c)));
  assert.equal(JSON.stringify(paths),before);
  assert.deepEqual(trajectoryDisplayOrientation([...paths].reverse()).project(b),project(b));
});
test('empty, coincident and symmetric paths stay finite', () => {
  for (const paths of [[],[{points:[{x:1,y:1},{x:1,y:1}]}],[{points:[{x:0,y:0},{x:-2,y:0}]},{points:[{x:0,y:0},{x:2,y:0}]}]]) {
    const p=trajectoryDisplayOrientation(paths).project({x:3,y:4});
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  }
});
