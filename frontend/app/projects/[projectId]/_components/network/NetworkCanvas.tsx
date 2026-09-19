"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { buildCircularPositions, buildConcentricPositions, buildHierarchicalPositions } from "../networkGraphLayouts";
import type { NetworkGraphProps } from "../networkGraphTypes";
import { NETWORK_SCALE } from "./theme";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyLabelBudget } from "./labels";
import { galaxyElements, galaxySignature, galaxyInput, galaxyInputFromElements } from "./model";
import { applyPresentation } from "./presentation";
import type { GalaxyResult, Point } from "./galaxyGeometry";

function fit(cy: Core) {
  if (cy.destroyed() || cy.nodes().empty()) return;
  const box=cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false });
  const padding=NETWORK_SCALE.fitPadding;
  const zoom=Math.max(cy.minZoom(), Math.min(cy.nodes().length <= 40 ? 2.5 : NETWORK_SCALE.maxFitZoom,(cy.width()-2*padding)/Math.max(1,box.w),(cy.height()-2*padding)/Math.max(1,box.h)));
  cy.viewport({zoom,pan:{x:cy.width()/2-(box.x1+box.w/2)*zoom,y:cy.height()/2-(box.y1+box.h/2)*zoom}});
  cy.scratch("galaxyFitZoom", cy.zoom());
  cy.scratch("galaxyCameraTouched", false);
  applyPresentation(cy, true);
}

function select(cy: Core, props: NetworkGraphProps) {
  const { selectedGene, selectedEdgeKey } = props;
  cy.batch(() => {
    cy.elements().removeClass("traced traced-neighbour muted");
    const focus = selectedEdgeKey ? cy.$id(selectedEdgeKey) : selectedGene ? cy.$id(selectedGene) : cy.collection();
    if (focus.empty()) return;
    const neighborhood = selectedEdgeKey ? focus.union(focus.connectedNodes()) : focus.closedNeighborhood();
    focus.addClass("traced");
    neighborhood.difference(focus).addClass("traced-neighbour");
    cy.elements().difference(neighborhood).addClass("muted");
  });
  applyLabelBudget(cy);
}

/** Worker-owned geometry; the visible graph owns camera and interaction. */
export default function NetworkCanvas(props: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<Core | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revision = useRef(0);
  const latest = useRef(props);
  const busy = useRef(false);
  const [arranging, setArranging] = useState(false);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState({ nodes: 0, edges: 0, neighborhoods: 0 });
  const [emphasized, setEmphasized] = useState(false);
  const [weighted, setWeighted] = useState(true);
  const [pins, setPins] = useState<string[]>([]);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const stopWorker = useCallback(() => {
    ++revision.current;
    workerRef.current?.terminate();
    workerRef.current = null;
    clearTimeout(timeoutRef.current);
  }, []);
  useEffect(() => { latest.current = props; });
  const signature = useMemo(() => galaxySignature(props.nodes, props.edges, props.layout), [props.nodes, props.edges, props.layout]);
  const elements = useMemo(() => galaxyElements(props.nodes, props.edges), [props.nodes, props.edges]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current, elements: [], style: buildNetworkStylesheet(),
      layout: { name: "preset" }, minZoom: NETWORK_SCALE.minZoom, maxZoom: NETWORK_SCALE.maxZoom,
      pixelRatio: "auto", textureOnViewport: false, motionBlur: false,
      selectionType: "single", boxSelectionEnabled: false,
    });
    coreRef.current = cy;
    cy.scratch("galaxy", true);
    cy.scratch("publicationWeighted", true);
    latest.current.onGraphReady?.(cy);
    cy.on("tap", "node", e => { latest.current.onSelectEdge(null); latest.current.onSelectGene(e.target.id()); });
    cy.on("tap", "edge", e => { latest.current.onSelectGene(null); latest.current.onSelectEdge(e.target.id()); });
    cy.on("tap", e => { if (e.target === cy) { latest.current.onSelectGene(null); latest.current.onSelectEdge(null); } });
    cy.on("mouseover", "node, edge", e => { e.target.addClass("hovered"); applyLabelBudget(cy); });
    cy.on("mouseout", "node, edge", e => { e.target.removeClass("hovered"); applyLabelBudget(cy); });
    let frame = 0;
    cy.on("zoom pan", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (cy.destroyed() || busy.current) return;
        applyPresentation(cy);
      });
    });
    cy.on("dragpan scrollzoom", () => cy.scratch("galaxyCameraTouched", true));
    cy.on("dragfree", "node", () => {
      const input = galaxyInput(cy);
      const positions: Record<string, Point> = {};
      cy.nodes().forEach(n => { positions[n.id()] = { ...n.position() }; });
      workerRef.current?.postMessage({ id: ++revision.current, input, positions });
      applyLabelBudget(cy);
    });
    const observer = new ResizeObserver(() => {
      if (cy.destroyed()) return;
      cy.resize();
      if (!busy.current && !cy.scratch("galaxyCameraTouched")) fit(cy);
    });
    observer.observe(containerRef.current);
    return () => {
      stopWorker();
      observer.disconnect(); cancelAnimationFrame(frame);
      latest.current.onGraphReady?.(null);
      cy.destroy(); coreRef.current = null;
    };
  }, [stopWorker]);

  useEffect(() => {
    const cy = coreRef.current;
    if (!cy || cy.destroyed()) return;
    workerRef.current?.terminate();
    const id = ++revision.current;
    const next = galaxyElements(latest.current.nodes, latest.current.edges);
    const hasNodes = latest.current.nodes.length > 0;
    busy.current = hasNodes;
    cy.scratch("galaxyBusy", hasNodes);
    // Publish the external worker's lifecycle after this synchronization pass.
    queueMicrotask(() => {
      if (cy.destroyed() || id !== revision.current) return;
      setArranging(busy.current);
      if (busy.current) setError("");
      if (!hasNodes) setRendered({ nodes: 0, edges: 0, neighborhoods: 0 });
    });
    if (!latest.current.nodes.length) { cy.elements().remove(); return stopWorker; }
    // Keep the previous view visible until a complete new arrangement arrives.
    const input = galaxyInputFromElements(next, cy.width(), cy.height());
    const { nodes, edges, layout } = latest.current;
    const positions = layout === "force" ? undefined : layout === "hierarchical"
      ? buildHierarchicalPositions(nodes, edges) : layout === "concentric"
      ? buildConcentricPositions(nodes, edges) : buildCircularPositions(nodes, edges);
    let initial = true;
    const finish = (result: GalaxyResult) => {
      clearTimeout(timeoutRef.current);
      cy.batch(() => {
        if (initial) {
          cy.elements().remove();
          cy.add(galaxyElements(latest.current.nodes, latest.current.edges));
          cy.nodes().positions(n => result.positions[n.id()] ?? { x: 0, y: 0 });
          cy.nodes().forEach(n => { n.data({ layoutNeighborhood: result.neighborhoods?.[n.id()] ?? "", layoutAnchor: result.neighborhoods?.[n.id()] === n.id() }); });
          cy.edges().forEach(e => { e.data("crossNeighborhood", Boolean(e.source().data("layoutNeighborhood") && e.source().data("layoutNeighborhood") !== e.target().data("layoutNeighborhood"))); });
          const neighborhoods = new Set(Object.values(result.neighborhoods ?? {})).size;
          cy.scratch("galaxyNeighborhoods", neighborhoods);
          setRendered({ nodes: cy.nodes().length, edges: cy.edges().length, neighborhoods });
        }
        cy.edges().forEach(e => {
          const route = result.routes[e.id()];
          if (route) e.data({ routeDistances: route.distances, routeWeights: route.weights });
          else e.removeData("routeDistances routeWeights");
        });
      });
      busy.current = false; cy.scratch("galaxyBusy", false); setArranging(false);
      if (initial) { fit(cy); select(cy, latest.current); }
      initial = false;
    };
    const fail = (message: string) => {
      clearTimeout(timeoutRef.current);
      workerRef.current?.terminate(); workerRef.current = null;
      setError(message);
      const fallback = buildCircularPositions(nodes, edges);
      finish({ positions: fallback, routes: {}, components: 0 });
    };
    try {
      const worker = new Worker(new URL("./galaxy.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ id: number; result?: GalaxyResult; error?: string }>) => {
        if (cy.destroyed() || event.data.id !== revision.current) return;
        if (event.data.result) finish(event.data.result);
        else fail(event.data.error ?? "The layout could not finish. Try resetting it.");
      };
      worker.onerror = () => {
        if (!cy.destroyed() && workerRef.current === worker) fail("The layout could not load. Try resetting it.");
      };
      worker.postMessage({ id, input, positions });
      timeoutRef.current = setTimeout(() => {
        if (!cy.destroyed() && initial && id === revision.current) fail("This arrangement took too long. Showing a circular fallback; use Reset layout to retry.");
      }, 45000);
    } catch { fail("The layout could not start. Try resetting it."); }
    return stopWorker;
  }, [signature, layoutRevision, stopWorker]);

  useEffect(() => {
    const cy = coreRef.current;
    if (!cy || cy.destroyed() || busy.current) return;
    cy.batch(() => elements.forEach(element => {
      const item = cy.$id(String(element.data.id));
      if (item.empty()) return;
      const labelSize = item.data("labelSize");
      item.data(element.data);
      if (item.isNode() && labelSize) item.data("labelSize", labelSize);
    }));
    select(cy, latest.current);
    applyPresentation(cy, true);
  }, [elements, props.selectedGene, props.selectedEdgeKey]);

  useEffect(() => {
    const cy = coreRef.current;
    if (!cy || cy.destroyed()) return;
    cy.scratch("publicationPins", pins);
    applyLabelBudget(cy);
  }, [pins]);

  const visiblePins = pins.filter(id => props.nodes.some(n => n.id === id));
  const selected = props.selectedGene;
  return <>
    <div ref={containerRef} className="grn-canvas" role="group" tabIndex={0} aria-busy={arranging} aria-label={`Regulatory network: ${rendered.nodes} genes and ${rendered.edges} relationships. Arrow keys browse genes; Escape clears selection.`}
      onKeyDown={event=>{
        if (arranging) return;
        if(event.key === "Escape") { props.onSelectGene(null); props.onSelectEdge(null); return; }
        if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
        const ids=[...props.nodes].sort((a,b)=>b.degree-a.degree||a.id.localeCompare(b.id)).map(n=>n.id);
        if(!ids.length) return;
        event.preventDefault();
        const current=props.selectedGene ? ids.indexOf(props.selectedGene) : -1;
        const step=event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        props.onSelectEdge(null); props.onSelectGene(ids[(current+step+ids.length)%ids.length]);
      }} style={{ background: "transparent", opacity: arranging ? 0.45 : 1, pointerEvents: arranging ? "none" : "auto", transition: "opacity 220ms" }} />
    {/* Two figures, read as figures. The sentence this replaced set the counts
      * in the same small grey type as the words around them, so the numbers --
      * the only part anyone actually reads off a figure caption -- had to be
      * picked out of running text. Here each number carries its own label
      * underneath and the pair is divided by a hairline.
      *
      * The div keeps its class whatever is inside it: the stylesheet uses
      * :has(.galaxy-caption) to tell this canvas from the other layouts. */}
    <div className="galaxy-caption" aria-hidden="true">
      <div className="galaxy-stats">
        <div className="galaxy-stat">
          <span className="galaxy-stat-value">{rendered.nodes.toLocaleString()}</span>
          <span className="galaxy-stat-label">Genes</span>
        </div>
        <div className="galaxy-stat">
          <span className="galaxy-stat-value">
            {rendered.edges.toLocaleString()}
            {props.totalRelationships && props.totalRelationships > rendered.edges
              ? <em>of {props.totalRelationships.toLocaleString()}</em>
              : null}
          </span>
          <span className="galaxy-stat-label">Relationships</span>
        </div>
      </div>
      {rendered.neighborhoods > 1 && <small>{rendered.neighborhoods} layout groups · spacing reflects connectivity</small>}
    </div>
    {arranging && <div className="galaxy-status" role="status">Arranging neighborhoods…{rendered.nodes > 0 ? " Previous view shown." : ""}</div>}
    {error && <div className="galaxy-error" role="alert">{error}</div>}
    <div className="galaxy-controls" aria-label="Figure controls">
      <button type="button" disabled={arranging} onClick={() => { if (coreRef.current) fit(coreRef.current); }}>Fit view</button>
      <button type="button" disabled={arranging} title="Restore the computed arrangement after dragging" onClick={() => setLayoutRevision(value => value + 1)}>Reset layout</button>
      <button type="button" aria-pressed={weighted} disabled={arranging} title="Line width: evidence on a fixed 0–1 scale, or uniform" onClick={() => {
        const next = !weighted; setWeighted(next);
        if (coreRef.current) { coreRef.current.scratch("publicationWeighted", next); applyPresentation(coreRef.current, true); }
      }}>{weighted ? "Width: evidence" : "Width: uniform"}</button>
      {selected && <button type="button" disabled={arranging} aria-pressed={pins.includes(selected)} onClick={() => setPins(current => current.includes(selected) ? current.filter(id => id !== selected) : [...current, selected])}>
        {pins.includes(selected) ? "Unpin" : "Pin"} {selected} label
      </button>}
      {visiblePins.length > 0 && <button type="button" onClick={() => setPins([])} title={visiblePins.join(", ")}>Clear {visiblePins.length} pinned {visiblePins.length === 1 ? "label" : "labels"}</button>}
      {rendered.edges > rendered.nodes * 3 && <button type="button" aria-pressed={emphasized} disabled={arranging} onClick={() => {
        const next = !emphasized; setEmphasized(next);
        if (coreRef.current) { coreRef.current.scratch("galaxyEmphasize", next); applyPresentation(coreRef.current); }
      }}>{emphasized ? "Quiet links" : "Emphasize links"}</button>}
    </div>
  </>;
}
