"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { buildCircularPositions, buildConcentricPositions, buildHierarchicalPositions } from "../networkGraphLayouts";
import type { NetworkGraphProps } from "../networkGraphTypes";
import { NETWORK_SCALE, NETWORK_THEME } from "./theme";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyLabelBudget } from "./labels";
import { galaxyElements, galaxySignature, galaxyInput } from "./model";
import type { GalaxyResult, Point } from "./galaxyGeometry";

function fit(cy: Core) {
  if (cy.destroyed() || cy.nodes().empty()) return;
  const box=cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false });
  const padding=NETWORK_SCALE.fitPadding;
  const zoom=Math.max(cy.minZoom(), Math.min(NETWORK_SCALE.maxFitZoom,(cy.width()-2*padding)/Math.max(1,box.w),(cy.height()-2*padding)/Math.max(1,box.h)));
  cy.viewport({zoom,pan:{x:cy.width()/2-(box.x1+box.w/2)*zoom,y:cy.height()/2-(box.y1+box.h/2)*zoom}});
  cy.scratch("galaxyFitZoom", cy.zoom());
  cy.scratch("galaxyCameraTouched", false);
  cy.nodes().forEach(n => { n.data("labelSize", Math.min(14, 8.5 + Math.sqrt(Number(n.data("degree"))) * 0.65) / cy.zoom()); });
  cy.edges().forEach(e => { e.data("width", (0.5 + Number(e.data("evidence")) * 0.55) / cy.zoom()); });
  applyLabelBudget(cy);
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
  const revision = useRef(0);
  const latest = useRef(props);
  const busy = useRef(false);
  const [arranging, setArranging] = useState(false);
  const [error, setError] = useState("");
  const [rerun, setRerun] = useState(0);
  const stopWorker = useCallback(() => {
    ++revision.current;
    workerRef.current?.terminate();
    workerRef.current = null;
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
    latest.current.onGraphReady?.(cy);
    cy.on("tap", "node", e => { latest.current.onSelectEdge(null); latest.current.onSelectGene(e.target.id()); });
    cy.on("tap", "edge", e => { latest.current.onSelectGene(null); latest.current.onSelectEdge(e.target.id()); });
    cy.on("tap", e => { if (e.target === cy) { latest.current.onSelectGene(null); latest.current.onSelectEdge(null); } });
    cy.on("mouseover", "node, edge", e => e.target.addClass("hovered"));
    cy.on("mouseout", "node, edge", e => e.target.removeClass("hovered"));
    let frame = 0;
    cy.on("zoom pan", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (cy.destroyed() || busy.current) return;
        cy.edges().toggleClass("detail", cy.zoom() > Math.max(0.9, Number(cy.scratch("galaxyFitZoom") ?? 1) * 1.6));
        applyLabelBudget(cy);
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
    cy.batch(() => {
      cy.elements().remove();
      const next = galaxyElements(latest.current.nodes, latest.current.edges);
      let index = 0;
      next.forEach(element => {
        if (element.data.source !== undefined) return;
        const angle = index * 2.399963, radius = 120 * Math.sqrt(++index);
        element.position = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      });
      cy.add(next);
    });
    if (!cy.nodes().length) { busy.current = false; setArranging(false); return; }
    busy.current = true; setArranging(true); setError("");
    const input = galaxyInput(cy);
    const { nodes, edges, layout } = latest.current;
    const positions = layout === "force" ? undefined : layout === "hierarchical"
      ? buildHierarchicalPositions(nodes, edges) : layout === "concentric"
      ? buildConcentricPositions(nodes, edges) : buildCircularPositions(nodes, edges);
    let initial = true;
    const finish = (result: GalaxyResult) => {
      cy.batch(() => {
        if (initial) cy.nodes().positions(n => result.positions[n.id()] ?? { x: 0, y: 0 });
        cy.edges().forEach(e => {
          const route = result.routes[e.id()];
          if (route) e.data({ routeDistances: route.distances, routeWeights: route.weights });
          else e.removeData("routeDistances routeWeights");
        });
      });
      busy.current = false; setArranging(false);
      if (initial) { fit(cy); select(cy, latest.current); }
      initial = false;
    };
    const fail = (message: string) => {
      busy.current = false; setArranging(false); setError(message);
      const fallback = buildCircularPositions(nodes, edges);
      cy.nodes().positions(n => fallback[n.id()] ?? { x: 0, y: 0 });
      fit(cy); select(cy, latest.current);
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
    } catch { fail("The layout could not start. Try resetting it."); }
    return stopWorker;
  }, [signature, rerun, stopWorker]);

  useEffect(() => {
    const cy = coreRef.current;
    if (!cy || cy.destroyed()) return;
    cy.batch(() => elements.forEach(element => {
      const item = cy.$id(String(element.data.id));
      if (item.empty()) return;
      const labelSize = item.data("labelSize");
      item.data(element.data);
      if (item.isNode() && labelSize) item.data("labelSize", labelSize);
      if (item.isEdge() && cy.scratch("galaxyFitZoom")) item.data("width", (0.5 + Number(item.data("evidence")) * 0.55) / Number(cy.scratch("galaxyFitZoom")));
    }));
    select(cy, latest.current);
  }, [elements, props.selectedGene, props.selectedEdgeKey]);

  return <>
    <div ref={containerRef} className="grn-canvas" role="group" tabIndex={0} aria-label={`Galaxy network: ${props.nodes.length} genes and ${props.edges.length} relationships. Arrow keys browse genes; Escape clears selection.`}
      onKeyDown={event=>{
        if(event.key === "Escape") { props.onSelectGene(null); props.onSelectEdge(null); return; }
        if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
        const ids=[...props.nodes].sort((a,b)=>b.degree-a.degree||a.id.localeCompare(b.id)).map(n=>n.id);
        if(!ids.length) return;
        event.preventDefault();
        const current=props.selectedGene ? ids.indexOf(props.selectedGene) : -1;
        const step=event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        props.onSelectEdge(null); props.onSelectGene(ids[(current+step+ids.length)%ids.length]);
      }} style={{ background: NETWORK_THEME.ground, opacity: arranging ? 0 : 1, transition: "opacity 220ms" }} />
    <div className="galaxy-caption" aria-hidden="true"><span>REGULATORY GALAXY</span><small>{props.nodes.length.toLocaleString()} genes · {props.edges.length.toLocaleString()} relationships</small></div>
    {arranging && <div className="galaxy-status" role="status">Arranging neighborhoods…</div>}
    {error && <div className="galaxy-error" role="alert">{error}</div>}
    <div className="galaxy-controls">
      <button type="button" onClick={() => coreRef.current && fit(coreRef.current)} disabled={arranging} title="Fit the whole network">Fit view</button>
      <button type="button" onClick={() => setRerun(n => n + 1)} disabled={arranging} title="Restore the galaxy arrangement">Reset layout</button>
    </div>
  </>;
}
