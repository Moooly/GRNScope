/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the installed tooling adapter. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const match = require('minimatch');

test('legacy ESLint plugins retain callable glob matching and defaults', () => {
  assert.equal(match('component.tsx', '*.{ts,tsx}'), true);
  assert.equal(match('components/Chart.tsx', '**/*.tsx'), true);
  assert.equal(match('components/Chart.tsx', '*.tsx'), false);
  assert.equal(match('Component.TSX', '*.tsx', { nocase: true }), true);
  assert.equal(match('.hidden.ts', '*.ts'), false);
  assert.equal(match('.hidden.ts', '*.ts', { dot: true }), true);
  assert.equal(match.defaults({ nocase: true })('A.TS', '*.ts'), true);
  assert.equal(match.defaults({ nocase: true }).defaults({ dot: true })('.A.TS', '*.ts'), true);
  assert.deepEqual(match.match(['a.ts', 'b.js'], '*.ts'), ['a.ts']);
  assert.deepEqual(['a.ts', 'b.js'].filter(match.filter('*.ts')), ['a.ts']);
});

test('modern named exports and ESM default imports use the patched engine', async () => {
  assert.equal(new match.Minimatch('**/*.ts').match('app/page.ts'), true);
  const esm = await import('minimatch');
  assert.equal(esm.default('page.ts', '*.ts'), true);
  assert.equal(esm.minimatch('page.ts', '*.ts'), true);
  assert.equal(new esm.Minimatch('*.tsx').match('page.tsx'), true);
  assert.equal(require('minimatch-modern/package.json').version, '11.0.3');
});
