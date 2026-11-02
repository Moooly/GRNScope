/* eslint-disable @typescript-eslint/no-require-imports -- Compile TypeScript for the Node regression harness. */
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
const { createRoot } = require('react-dom/client');
function create(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  root.render(element);
  return {
    container,
    update: (next) => root.render(next),
    unmount: () => { root.unmount(); container.remove(); },
  };
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
require.extensions['.tsx'] = require.extensions['.ts'];
const JobProgressBanner = require('../app/projects/[projectId]/_components/JobProgressBanner.tsx').default;
const useProjectDetailData = require('../app/projects/[projectId]/_hooks/useProjectDetailData.ts').default;
const { loadCompletedAlgorithmResults } = require('../app/projects/[projectId]/_lib/loadResults.ts');
const { startPolling } = require('../app/_lib/polling.ts');
const { getClientId } = require('../app/_lib/clientIdentity.ts');
const { clearCachedResults, setCachedResults, getCachedResults } = require('../app/projects/[projectId]/_lib/resultsCache.ts');
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
global.IS_REACT_ACT_ENVIRONMENT = true;

test('preview results are upgraded; unchanged results are reused; same-job reruns replace saved edges', async (t) => {
  let revision = 1, edgeFetches = 0;
  t.mock.method(global, 'fetch', async (url) => {
    if (url.endsWith('/results')) return json({ job_id: 'same-job', results: [{ algorithm_id: 'A', status: 'Completed', completed_at_timestamp: revision }] });
    edgeFetches++;
    return json({ result: { algorithm_id: 'A', top_edges: url.includes('?limit=') ? [1] : [revision, 2, 3] } });
  });
  const preview = await loadCompletedAlgorithmResults('cache-test', {}, { limit: 1 });
  const full = await loadCompletedAlgorithmResults('cache-test', preview);
  assert.deepEqual(full.A.top_edges, [1, 2, 3]);
  assert.equal(edgeFetches, 2);
  assert.equal(await loadCompletedAlgorithmResults('cache-test', full), full);
  assert.equal(edgeFetches, 2);
  revision = 2;
  const rerun = await loadCompletedAlgorithmResults('cache-test', full);
  assert.deepEqual(rerun.A.top_edges, [2, 2, 3]);
  assert.equal(edgeFetches, 3);
});

test('polling waits for a slow request and aborts cleanly on navigation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  let count = 0, signal;
  const stop = startPolling(async (s) => { count++; signal = s; await pending.promise; }, 5000, true);
  t.mock.timers.tick(20000);
  assert.equal(count, 1);
  pending.resolve();
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(4999);
  assert.equal(count, 1);
  t.mock.timers.tick(1);
  assert.equal(count, 2);
  stop();
  assert.equal(signal.aborted, true);
  t.mock.timers.tick(20000);
  assert.equal(count, 2);
});

test('the last completed task finishes loading and unchanged polls preserve graph inputs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingEdge = deferred();
  let completed = false, edgeSignal, state, root;
  const manifest = { project_id: 'finish-test', project_name: 'Test' };
  t.mock.method(global, 'fetch', async (url, init) => {
    if (url.endsWith('/algorithms')) return json([]);
    if (url.endsWith('/metadata')) return json({ metadata: { gene_count: 2 } });
    if (url.endsWith('/results')) return json({ job_id: 'job', results: completed ? [{ algorithm_id: 'A', status: 'Completed' }] : [] });
    if (url.includes('/results/A')) { edgeSignal = init.signal; return pendingEdge.promise; }
    return json({ project: manifest, latest_job: { job_id: 'job', tasks: [{ algorithm_id: 'A', status: completed ? 'Completed' : 'Running' }] } });
  });
  function Harness() { state = useProjectDetailData({ projectId: 'finish-test', isDemoRoute: false }); return null; }
  await act(async () => { root = create(React.createElement(Harness)); });
  const originalProject = state.project, originalMetadata = state.metadata;
  await act(async () => { t.mock.timers.tick(5000); });
  assert.equal(state.project, originalProject);
  assert.equal(state.metadata, originalMetadata);
  completed = true;
  await act(async () => { t.mock.timers.tick(5000); });
  assert.equal(state.latestJob.tasks[0].status, 'Completed');
  assert.equal(edgeSignal.aborted, false, 'job completion must not abort its final edge request');
  await act(async () => { pendingEdge.resolve(json({ result: { algorithm_id: 'A', top_edges: [{ source: 'X', target: 'Y' }] } })); });
  assert.equal(state.algorithmResults.A.top_edges.length, 1);
  assert.equal(state.isLoadingCompletedResults, false);
  await act(async () => root.unmount());
  clearCachedResults('finish-test');
});

test('navigating while metadata and edges load cannot publish the previous project', async (t) => {
  const oldMetadata = deferred(), oldEdges = deferred();
  let state, root, oldSignal;
  t.mock.method(global, 'fetch', async (url, init) => {
    if (url.endsWith('/algorithms')) return json([]);
    const old = url.includes('/old/');
    if (url.endsWith('/metadata')) return old ? oldMetadata.promise : json({ metadata: { gene_count: 9 } });
    if (url.endsWith('/results')) return json({ results: [{ algorithm_id: 'A', status: 'Completed' }] });
    if (url.includes('/results/A')) {
      if (old) { oldSignal = init.signal; return oldEdges.promise; }
      return json({ result: { algorithm_id: 'A', top_edges: ['new'] } });
    }
    return json({ project: { project_id: url.endsWith('/old') ? 'old' : 'new' }, latest_job: null });
  });
  function Harness({ id }) { state = useProjectDetailData({ projectId: id, isDemoRoute: false }); return null; }
  await act(async () => { root = create(React.createElement(Harness, { id: 'old' })); });
  await act(async () => root.update(React.createElement(Harness, { id: 'new' })));
  assert.equal(oldSignal.aborted, true);
  await act(async () => {
    oldMetadata.resolve(json({ metadata: { gene_count: 1 } }));
    oldEdges.resolve(json({ result: { algorithm_id: 'A', top_edges: ['old'] } }));
  });
  assert.equal(state.project.project_id, 'new');
  assert.equal(state.metadata.gene_count, 9);
  assert.deepEqual(state.algorithmResults.A.top_edges, ['new']);
  await act(async () => root.unmount());
  clearCachedResults('new');
});

test('the full-result cache evicts older projects and superseded jobs', () => {
  const result = {};
  for (let i = 0; i < 4; i++) setCachedResults(`bounded-${i}`, 'job', result);
  assert.equal(getCachedResults('bounded-0', 'job'), undefined);
  assert.equal(getCachedResults('bounded-1', 'job'), result);
  setCachedResults('bounded-1', 'rerun', result);
  assert.equal(getCachedResults('bounded-1', 'job'), undefined);
  assert.equal(getCachedResults('bounded-1', 'rerun'), result);
  for (let i = 0; i < 4; i++) clearCachedResults(`bounded-${i}`);
});

test('a malformed browser cookie recovers instead of breaking every API request', (t) => {
  const previous = global.document;
  global.document = { cookie: 'grnscope_client_id=%invalid' };
  t.after(() => { if (previous === undefined) delete global.document; else global.document = previous; });
  assert.match(getClientId(), /^[A-Za-z0-9_-]{16,128}$/);
});

test('a failed first-paint request recovers using the complete saved result', async (t) => {
  let state, root;
  t.mock.method(global, 'fetch', async (url) => {
    if (url.endsWith('/algorithms')) return json([]);
    if (url.endsWith('/metadata')) return json({ metadata: {} });
    if (url.endsWith('/results')) return json({ results: [{ algorithm_id: 'A', status: 'Completed' }] });
    if (url.includes('?limit=')) return new Response('', { status: 503 });
    if (url.endsWith('/results/A')) return json({ result: { algorithm_id: 'A', top_edges: ['recovered'] } });
    return json({ project: { project_id: 'preview-retry' }, latest_job: null });
  });
  function Harness() { state = useProjectDetailData({ projectId: 'preview-retry', isDemoRoute: false }); return null; }
  await act(async () => { root = create(React.createElement(Harness)); });
  assert.deepEqual(state.algorithmResults.A.top_edges, ['recovered']);
  assert.equal(state.completedResultsError, '');
  assert.equal(state.isLoadingCompletedResults, false);
  await act(async () => root.unmount());
  clearCachedResults('preview-retry');
});

test('an explicit refresh supersedes an old in-flight result without stale replacement', async (t) => {
  const oldEdges = deferred();
  let refreshed = false, oldSignal, state, root;
  t.mock.method(global, 'fetch', async (url, init) => {
    if (url.endsWith('/algorithms')) return json([]);
    if (url.endsWith('/metadata')) return json({ metadata: {} });
    if (url.endsWith('/results')) return json({ results: [{ algorithm_id: 'A', status: 'Completed', completed_at_timestamp: refreshed ? 2 : 1 }] });
    if (url.includes('/results/A')) {
      if (!refreshed) { oldSignal = init.signal; return oldEdges.promise; }
      return json({ result: { algorithm_id: 'A', top_edges: ['fresh'] } });
    }
    return json({ project: { project_id: 'refresh-test' }, latest_job: null });
  });
  function Harness() { state = useProjectDetailData({ projectId: 'refresh-test', isDemoRoute: false }); return null; }
  await act(async () => { root = create(React.createElement(Harness)); });
  refreshed = true;
  await act(async () => state.refreshProjectData());
  assert.equal(oldSignal.aborted, true);
  await act(async () => oldEdges.resolve(json({ result: { algorithm_id: 'A', top_edges: ['stale'] } })));
  assert.deepEqual(state.algorithmResults.A.top_edges, ['fresh']);
  assert.equal(state.isLoadingProject, false);
  assert.equal(state.isLoadingCompletedResults, false);
  await act(async () => root.unmount());
  clearCachedResults('refresh-test');
});


test('a rejected email save shows the server message and makes retry available', async () => {
  let root;
  await act(async () => {
    root = create(React.createElement(JobProgressBanner, {
      tasks: [{ algorithm_id: 'A', status: 'Running' }],
      onSaveNotificationEmail: async () => { throw new Error('Email notifications are not available yet.'); },
    }));
  });
  await act(async () => root.container.querySelector('[aria-label="Email me when analysis is done"]').click());
  const input = root.container.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'qa@example.invalid');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => root.container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.match(root.container.textContent, /Email notifications are not available yet/);
  assert.equal(root.container.querySelector('[type="submit"]').disabled, false);
  await act(async () => root.unmount());
});


test('cached results are reannotated when the project species changes within the same job', async (t) => {
  let species = 'human', requests = 0;
  t.mock.method(global, 'fetch', async (url) => {
    if (url.endsWith('/results')) return json({ job_id: 'same-job', results: [{ algorithm_id: 'A', status: 'Completed' }] });
    requests++;
    return json({ result: { algorithm_id: 'A', top_edges: [], genome_reference: { species } } });
  });
  const human = await loadCompletedAlgorithmResults('species-cache', {}, { coordinateSpecies: 'human' });
  species = 'mouse';
  const mouse = await loadCompletedAlgorithmResults('species-cache', human, { coordinateSpecies: 'mouse' });
  assert.equal(mouse.A.genome_reference.species, 'mouse');
  assert.equal(requests, 2);
  assert.equal(await loadCompletedAlgorithmResults('species-cache', mouse, { coordinateSpecies: 'mouse' }), mouse);
  assert.equal(requests, 2);
});
