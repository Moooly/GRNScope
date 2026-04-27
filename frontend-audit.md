# GRNScope frontend — audit findings

Prioritized punch list. Severity scale: **P0 = wrong/broken**, **P1 = serious correctness or perf**, **P2 = quality / polish**. File paths are relative to `frontend/`.

---

## A. Network layouts — the four-mode mess

This is where the biggest pain lives. The root cause is in `app/projects/[projectId]/_components/networkGraphLayouts.ts`.

### A1. **All four layouts are edge-blind.** [P0]
The hierarchical, concentric, circular, and even the input to force-directed layouts only look at per-node fields (`degree`, `inDegree`, `outDegree`, `isTF`). They never receive the edge list. The author wrote the disclaimer themselves on line 163:

> "This is a regulator-priority hierarchy, not a strict graph-theory layered layout. Nodes with stronger outgoing regulation are placed closer to the top. A full edge-aware hierarchy would need the edge list as an input."

That comment applies to all four. Without edge information the layouts can't:
- arrange regulators above their direct targets (hierarchical)
- minimize edge crossings (circular)
- group connected components (concentric, circular)
- pull related nodes together (force-directed start positions)

**Fix direction:** rewrite all four to take `(nodes, edges)`. For three of them, just delegate to Cytoscape's built-in algorithms instead of re-implementing them with `preset`:

| Mode | Use Cytoscape built-in | Falls back to current code? |
|------|------------------------|-----------------------------|
| force | `cose-bilkent` (already used) — fine, but pass `idealEdgeLength` based on actual graph stats | keep |
| hierarchical | `dagre` (add `cytoscape-dagre`) — true topological layering with regulators above targets | replace |
| concentric | Cytoscape's built-in `concentric` (already shipped, no extra dep) — uses degree natively | replace |
| circular | Cytoscape's built-in `circle` + reorder by community/barycenter to reduce crossings | replace |

### A2. **Hierarchical "levels" are a triangle, not a hierarchy.** [P0] (`networkGraphLayouts.ts:183-198`)
The level-size progression is `[1, 3, 5, 7, 9, …]` — odd numbers — which packs nodes into a pyramid by *count*, not by graph topology. A node at "level 0" is just whichever node had the highest priority score, not a true source/root. Edges go everywhere because the layering ignores connectivity.

**Fix:** topological sort on the directed graph (Kahn's algorithm). Sources go on top; assign each node `level = 1 + max(level of regulators)`. Cycles handled by SCC condensation.

### A3. **Concentric forces 2 nodes to the center when N>10.** [P1] (`networkGraphLayouts.ts:88-101`)
A concentric layout should have one center (the highest-degree hub) with rings of decreasing degree around it. The current code arbitrarily promotes 2 hubs to a tiny inner ring of radius 84, which looks like a misaligned layout, not "two competing hubs." Either drop to one center always, or use Cytoscape's built-in `concentric` which handles this correctly.

### A4. **Circular: single ring with hard-coded max radius 390.** [P1] (`networkGraphLayouts.ts:55-62`)
With 62-px-wide nodes, the perimeter `2π·390 ≈ 2450px` only fits ~39 nodes before they overlap. At 100+ nodes (which a top-N of 1000 can easily produce) you get severe overlap. Either use Cytoscape's `circle` (auto-scales radius) or scale radius linearly with `nodes.length`.

### A5. **Circular ignores edge structure → maximum crossings.** [P1]
Sorting nodes by `(isTF * 10 + outDegree * 3 + degree * 1.1 - inDegree * 0.25)` is arbitrary and will produce a circle where many edges cross the middle. Use a barycenter ordering (place each node near the average angular position of its neighbors, iterate) or 2-opt edge-crossing reduction. Even a one-pass barycenter pass dramatically cleans up the visual.

### A6. **Force layout passes `randomize: true` based on a stale cache check.** [P1] (`NetworkGraph.tsx:282-289`, `networkGraphLayouts.ts:286`)
The cache lookup decides "should we randomize" but the cache is a per-`(layout, signature)` map. When edges change, the signature changes, so `randomize` becomes true and the layout starts from scratch — every Top-N or threshold change kicks off a full force simulation. With 1k+ edges that's 1-3 seconds of CPU, and the user sees nodes flying around.

**Fix:** pass *previous positions* as starting positions to cose-bilkent (it accepts this), so changing the edge set tweaks the existing layout instead of restarting. Only randomize on the very first run.

### A7. **Manual disconnected-component packing fights the force layout.** [P1] (`NetworkGraph.tsx:138-205`)
After cose-bilkent runs, the code re-positions disconnected components into a grid. This causes a visible "jump" at the end of the layout animation and breaks any user-restored positions. cose-bilkent has `componentSpacing` and `tile: true` for exactly this; configure those instead of post-processing positions.

### A8. **`packDisconnectedComponents` runs even when there's only one component.** [P2] (`NetworkGraph.tsx:138`)
Early-return is correct (`if (groups.length <= 1) return`), but `getConnectedNodeGroups` still walks the whole adjacency map first. Cheap on small graphs, but runs on every layout change.

### A9. **Layout changes blow up cached positions for the *previous* layout.** [P1] (`NetworkGraph.tsx:494-505`)
When `signatureChanged && layoutChanged`, the cache for the new layout is empty so it re-runs from scratch — fine. But the new positions then *overwrite* `lastNodePositionsRef`, which is shared across layouts. So switching `force → circular → force` re-randomizes the force layout instead of returning to your last force positions.

**Fix:** keep `lastNodePositionsRef` per-layout (it already has `layoutPositionCacheRef` for that purpose; just stop merging into the global ref).

---

## B. NetworkGraph component — performance & correctness

### B1. **Two layers of silent edge truncation that bypass your two sliders.** [P0]
Design intent (per project owner): the detail page exposes exactly three controls — algorithm selection, confidence threshold, consensus threshold. Nothing else should shape the network. Today, two hidden truncations override that:

1. **Hidden Top-N state.** `[projectId]/page.tsx:39` declares `const [topN, setTopN] = useState(1)`, and `[projectId]/page.tsx:649-650` auto-sets it to `Math.floor(maxAvailableTopN / 2)` — i.e. half of whatever the backend sent in `top_edges`. The value is then used at `[projectId]/page.tsx:112` as `edges.slice(0, topN)`, capping each algorithm's edge list before consensus runs. The state is also passed to `ResultsControlsSection` as `topN`/`maxAvailableTopN`/`onChangeTopN` (`ResultsControlsSection.tsx:8-10, 25-27`) but no UI element consumes them — dead-wired plumbing left over from a removed feature.
2. **Hard 220-edge cap in the viz.** `NetworkVisualizationSection.tsx:149`:
   ```tsx
   edges={filteredNetworkEdges.slice(0, 220).map(...)}
   ```

Combined effect on a typical run: backend sends 5,000 edges per algorithm → silent slice to 2,500 → 0.8 confidence filter (default) drops most of those → consensus runs on the remainder → viz shows at most 220. The user thinks the consensus is sparse, but neither slider explains why.

**Fix (matches the "three controls only" intent):**
1. **Remove the hidden Top-N slicing** in `[projectId]/page.tsx:112`. Pass the full `top_edges` through to the confidence filter; let confidence and consensus do all the shaping. Delete `topN`, `setTopN`, `hasTouchedTopN`, `maxAvailableTopN`, and the auto-set effect at lines 648-651.
2. **Remove the 220 cap** in `NetworkVisualizationSection.tsx:149`. If perf becomes the real concern at very large edge counts, fix it via the rendering path (B2/B3/B6) instead of a hidden numeric cap.
3. **Drop the dead Top-N props** from `ResultsControlsSection` (props on lines 8-10, 25-27). The component should only see `selectedAlgorithmIds`, `confidenceThreshold`, `consensusThreshold` and their setters — matching the rendered UI.
4. **Lower the default confidence threshold** from 0.8 (`[projectId]/page.tsx:41`) to something permissive like 0.0 or 0.3, so a fresh project doesn't open with most edges already filtered out (also covered in C7).

### B2. **`elementsSignature` is `JSON.stringify` of all node + edge data.** [P1] (`networkGraphLayouts.ts:355-372`)
This serializes the entire graph (including `score`, `visualScore`, `count`) to a string on every render to detect changes. At 5k edges that's ~500KB of JSON serialization per render. And it triggers full graph rebuilds on cosmetic changes (e.g. a score float drift in the 6th decimal place).

**Fix:** signature should be a structural hash (just the set of `${source}->${target}` keys, joined and hashed). Score/visualScore changes should trigger a *style refresh* (`cy.style().update()`), not a full rebuild.

### B3. **NetworkGraph receives fresh array refs every render.** [P1] (`NetworkVisualizationSection.tsx:142-157`, `[projectId]/page.tsx:1245-1246`)
The parent passes `networkNodes.map(...)` and `filteredNetworkEdges.slice(0,220).map(...)` directly in JSX. New array references on every render → `useMemo` in NetworkGraph sees "different" nodes/edges every parent render → graph rebuilds even when data is logically unchanged. Wrap these mappings in `useMemo` upstream, or have NetworkGraph accept the upstream types directly.

### B4. **No `ResizeObserver` on the container.** [P1] (`NetworkGraph.tsx`)
When the sidebar opens/closes, the window resizes, or the inspector panel toggles, the Cytoscape canvas keeps its old internal size. `cy.resize()` is only called inside layout effects, not on container resize. Add a `ResizeObserver` that calls `cy.resize()` and `cy.fit()`.

### B5. **`coseBilkent(cytoscape)` registers at module import.** [P2] (`NetworkGraph.tsx:22`)
Runs even before the user opens a project. `cytoscape-cose-bilkent` is ~80KB compressed; it should be lazy-loaded next to `cytoscape-svg` (which is already done via dynamic `import` on line 309).

### B6. **Cytoscape itself bundled into the project page chunk.** [P1]
`import cytoscape from "cytoscape"` at top of NetworkGraph.tsx forces the cytoscape core (~600KB) into the project-detail bundle. Wrap NetworkGraph with `next/dynamic({ ssr: false })` and load it only when results exist. This will move ~600KB out of the initial route bundle.

### B7. **`as any` × 4 hides Cytoscape type errors.** [P2] (`NetworkGraph.tsx:324, 414, 546, 553`)
The stylesheet typing in cytoscape v3 is `Stylesheet[]` with a strict `style` shape; the casts mask real type drift. Move the stylesheet into a typed builder that returns `Stylesheet[]` and let TS catch invalid keys (e.g. `text-outline-opacity` is not a valid key on all node types).

### B8. **`textureOnViewport: true`** [P2] is good for big graphs but combined with `bezier` curves still slows down at 1k+ edges. For graphs > 500 edges, use `haystack` or `straight` curve style and reserve bezier for ≤ 200.

### B9. **The init effect uses `[]` deps but reads many props via closure.** [P2] (`NetworkGraph.tsx:476`)
ESLint rule `react-hooks/exhaustive-deps` is being silenced by the empty array. The second effect handles updates so behaviour is correct, but a future maintainer will trip on this. Add an eslint-disable comment with rationale.

### B10. **`NodeInfo.topRegulators / topTargets` aren't actually "top".** [P2] (`[projectId]/page.tsx:264-265`)
They're the entire list of regulators/targets (deduped). The UI then `.slice(0, 8)`s them — but the slicing happens *after* dedup, in arbitrary order, not by score. Either rename the fields to `regulators` / `targets`, or sort by edge confidence before slicing.

---

## C. Project detail page — state & data flow

### C1. **Polling fires every 1 second when active.** [P1] (`[projectId]/page.tsx:28, 856-860`)
```ts
const POLL_INTERVAL_MS = 1000;
```
The spec (§7.6) says 5 seconds. Each poll does N+2 fetches (project, results list, one per completed algorithm). With 8 algorithms in flight, that's 80 requests/min/user.

### C2. **Polling re-fetches every completed algorithm's full result on every tick.** [P1] (`[projectId]/page.tsx:825-840`)
There's no incremental update; once an algorithm completes, every poll re-downloads its top edges (potentially MBs). Solutions in order of effort: (1) skip already-loaded algorithms, (2) add `If-Modified-Since`/ETag, (3) move to SSE / WebSocket push.

### C3. **Polling never pauses when the tab is hidden.** [P2]
Add a `document.visibilityState` check — if hidden, skip the tick. Saves significant cycles when users leave the tab open.

### C4. **`setSelectedAlgorithmIds(completedAlgorithmIds)` overwrites user selection.** [P1] (`[projectId]/page.tsx:78-80`)
Whenever a new algorithm completes, the user's hand-picked subset is wiped and replaced with all completed IDs. So if you're inspecting "PIDC only" and GENIE3 finishes, your view jumps to consensus. Fix: only auto-select on the *first* time the list becomes non-empty, or merge new completions into the existing selection.

### C5. **Initial-load and polling effects duplicate ~70% of their code.** [P2] (`[projectId]/page.tsx:703-866`)
Two `useEffect` blocks fetch the same three endpoints, parse the same shape, and dispatch the same setters. Extract a single `loadProjectData(projectId, signal)` function and call it from both, or use a small data layer (TanStack Query / SWR) which would also give caching, dedupe, retry, and tab-visibility handling for free.

### C6. **No abort on superseded fetches.** [P2]
Both effects use a `cancelled` boolean to short-circuit `setState` after navigation, but the underlying `fetch` keeps running. Pass `AbortSignal` from `AbortController` and abort on cleanup.

### C7. **Confidence threshold defaults to 0.8.** [P1] (`[projectId]/page.tsx:41`)
With min-max-normalized scores, 0.8 already filters out roughly 80% of the ranked list before consensus runs. New users will see "consensus is empty" and not understand why. Default to 0.0 or 0.3.

### C8. **`top_edges` defaults to `normalized_score: 1` when missing.** [P1] (`[projectId]/page.tsx:116`)
```ts
clamp(Number(edge.normalized_score ?? 1), 0, 1)
```
If the backend forgets to include `normalized_score`, every edge becomes confidence 1.0 — surviving any confidence threshold. Should be `0` or, better, mark as "unknown" and exclude from confidence-filtered consensus.

### C9. **Selection-keyed state survives view changes.** [P2]
`selectedGene`, `selectedEdgeKey`, `isolatedGene` are top-level state and persist across algorithm-set / threshold changes. There's a guard at line 656-658 that nulls `selectedGene` if it's not in the current node set, but no equivalent guard for `selectedEdgeKey` or `isolatedGene` — both can dangle.

### C10. **`Help` link in `ResultsControlsSection` points to a route that doesn't exist.** [P2] (`ResultsControlsSection.tsx:50-52`)
`/projects/${projectId}/results-controls-help` and `/projects/results-controls-help` — neither route exists in `app/`. Either build the page or remove the link.

---

## D. URLs, API client, error handling

### D1. **Double slash in URL breaks strict middlewares.** [P1] (`projects/page.tsx:144`)
```ts
fetch(`${API_BASE}//projects/${projectId}`)
```
Note the `//` after `${API_BASE}`. FastAPI happens to be tolerant, but any reverse proxy or HTTP cache that normalizes paths will treat this as a different URL. Pure typo bug.

### D2. **No centralized API client.** [P2]
Every component builds its own `fetch(\`${API_BASE}/...\`)`, parses JSON, handles `!ok` ad hoc, sometimes silently swallows errors with empty `catch {}`. Extract a thin client (`api.getProject(id)`, `api.listResults(id)`) — gives you one place for auth headers, base URL, error typing, and cancellation.

### D3. **`API_BASE` is read inside the component on `projects/page.tsx`** (`projects/page.tsx:16`) **but at module scope on `[projectId]/page.tsx`** (line 27). [P2]
Inconsistent. Pick module scope (the Next.js way: `process.env.NEXT_PUBLIC_API_URL` is replaced at build time).

### D4. **Empty `catch {}` blocks lose all error info.** [P2] (multiple)
e.g. `[projectId]/page.tsx:741, 768, 783, 851`. Even in production, log to a server-bound endpoint or at minimum `console.error` so you can diagnose user-reported issues. Right now a transient 500 is invisible.

### D5. **CSV export doesn't handle `\r` in cell values.** [P2] (`[projectId]/page.tsx:551-559`)
The escape regex is `/[",\n]/`. Carriage returns embedded in gene names won't be quoted. Probably never happens for gene IDs but a 30-second fix.

### D6. **`URL.revokeObjectURL(objectUrl)` after `setTimeout(0)`.** [P2] (`[projectId]/page.tsx:545, 612`)
The download click is synchronous but the browser's URL release races with the navigation. Use a longer delay (e.g. 1s) or `window.requestIdleCallback`.

---

## E. Architecture & Next.js usage

### E1. **Root `layout.tsx` is `"use client"`.** [P0] (`app/layout.tsx:1`)
This is the most impactful single fix on the list. A client root layout forces every page below to render through the client runtime, defeating Next.js 16 React Server Components. Server-only data fetching, smaller hydration payloads, and streaming all become impossible.

**Fix:** make `layout.tsx` a server component. Extract the bits that need client state (the login indicator, the active-nav highlight) into a small `<HeaderClient />` island. The header SVG, links, and styling stay server-rendered.

### E2. **`localStorage.getItem("grnscope-demo-login")` as auth.** [P1] (`layout.tsx:19`)
Trivially spoofable; any user can flip a localStorage key to "true" and access the workspace nav. Acceptable for a prototype, but flag it visibly in a TODO so it doesn't ship. The spec (§1.2) calls for a 24h session token — hook the header to that token's existence (read from cookie, not localStorage; httpOnly when possible).

### E3. **`next.config.ts` is empty.** [P1]
No compression, no image optimization config, no compiler options, no `experimental.optimizePackageImports`. At minimum add:
```ts
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    optimizePackageImports: ['cytoscape', 'cytoscape-cose-bilkent'],
  },
};
```

### E4. **Two separate algorithm catalogs that drift.** [P1]
`app/projects/_data/algorithms.ts` (12 entries, minimal fields) and `app/algorithms/page.tsx:35-345` (12 entries, rich fields with `strengths`, `limitations`, `paperUrl`, `dockerVersion`, `detail`). Manually keeping both in sync. Consolidate into one source — ideally fetched from the backend per spec §13.3 ("registers the new algorithm by creating an entry in the algorithm database. Upon saving, the new algorithm immediately appears in the public algorithm directory") — but at minimum a single shared TS module.

### E5. **`AlgorithmCatalogItem.publicationYear` and `publishedYear` both exist.** [P2] (`_lib/types.ts:69-70`) — no callers seem to use them; dead.

### E6. **`AGENTS.md` warns "This is NOT the Next.js you know"** but the codebase still uses patterns that may have been changed in 16.x (e.g. `useParams` returning a Promise in some 16 builds, or new caching defaults). Worth running `next build` and reading any deprecation warnings.

### E7. **Stray `app/login.html` next to `app/login/page.tsx`.** [P2]
The `.html` file shouldn't be in the App Router tree; if it's a static fallback, move it to `public/`.

---

## F. Smaller & dead code

- **`EdgeAnalysisTableSection` has 5 unused props** that the parent still passes (`columnMenuRef`, `isColumnMenuOpen`, `setIsColumnMenuOpen`, `visibleAlgorithmColumns`, `setVisibleAlgorithmColumns`) — `void`'d on lines 63-67. The column-visibility menu (spec §10.4) was either never built or removed; either implement it or delete the props.
- **`recommendedIds` in `_data/algorithms.ts`** is `["PIDC", "GENIE3", "GRNBOOST2"]`; the spec §6.2 says recommended is "PIDC, GENIE3, and GRNBoost2" — matches. Keep.
- **Spec gaps in landing page** (`app/page.tsx`): no platform statistics bar (§14.3), no recently-added-methods card (§14.5), no sample-dataset download (§3.4 calls for it on the landing page too).
- **Many components ship a hex color literal `#1b75a6`** (the brand blue) inline, no Tailwind theme token, no CSS variable. Centralize as `--gs-blue-700` or extend Tailwind theme — currently a refactor of a single brand decision means find/replace across 30+ files.
- **Modals are inconsistent**: some use `createPortal` (`NetworkVisualizationSection`), some don't (`[projectId]/page.tsx` download + error modals). At larger viewports the non-portaled ones can clip inside ancestors with `overflow: hidden`. Standardize via portal.

---

## Suggested order to tackle

If you pick any 5 things to do first, I'd suggest:

1. **B1** — remove the silent 220-edge cap (one-line user-visible fix).
2. **A1 + A2 + A3 + A4 + A5** as one task — replace the four custom layouts with Cytoscape's built-in `concentric`/`circle`/`dagre` and proper edge-aware ordering. This is the user-reported pain.
3. **E1** — make root layout a server component. Single biggest perf and architectural improvement; unblocks RSC-era patterns elsewhere.
4. **C1 + C2** — fix polling cadence and avoid re-downloading already-cached results.
5. **D1** — fix the double-slash URL.

Items A6, B3, B4, B6, C7, C8 are next-tier and each takes minutes to hours.

Items in F can be addressed opportunistically.
