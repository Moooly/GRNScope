"use client";

import { useMemo, useRef, useState } from "react";
import type { Core } from "cytoscape";
import NetworkCanvas from "../projects/[projectId]/_components/network/NetworkCanvas";
import type { NetworkNode, NetworkEdge, NetworkLayoutMode } from "../projects/[projectId]/_components/networkGraphTypes";
import { exportNetworkFigure } from "../projects/[projectId]/_components/networkFigureExport";
import "../projects/[projectId]/_components/networkWorkspace.css";

function fixture(count: number) {
  const hubs = ["HUB_A", "HUB_B", "HUB_C", "HUB_D", "HUB_E", "SUBHUB_A", "SUBHUB_B"];
  const nodes: NetworkNode[] = Array.from({ length: count }, (_,i) => ({ id: hubs[i] ?? `GENE_${String(i-6).padStart(3,"0")}`, isTF:i<7, degree:0,inDegree:0,outDegree:0 }));
  const edges: NetworkEdge[] = [];
  const add = (a: number,b: number) => {
    if(!nodes[a]||!nodes[b]) return;
    edges.push({ key:`${a}-${b}`,source:nodes[a].id,target:nodes[b].id,score:0.65,confidence:0.8,bootstrapVerified:true,count:2,rank:edges.length+1,supportingAlgorithms:["Example A","Example B"],direction:1,directionConfidence:1,directionCoverage:1,sign:1,signConfidence:1,signCoverage:1 });
    nodes[a].outDegree++;nodes[a].degree++;nodes[b].inDegree++;nodes[b].degree++;
  };
  [[0,1],[0,2],[0,3],[1,2],[2,4],[4,5],[3,6]].forEach(([a,b])=>add(a,b));
  for(let i=7;i<count;i++) {
    const hub=(i-7)%7;
    add(hub,i);
    if(i%17===0) add((hub+1)%7,i);
    if(i%29===0 && i+1<count) add(i,i+1);
  }
  return {nodes,edges};
}

export default function NetworkLab() {
  const [count,setCount]=useState(180);
  const [layout,setLayout]=useState<NetworkLayoutMode>("force");
  const [gene,setGene]=useState<string|null>(null);
  const [edge,setEdge]=useState<string|null>(null);
  const graph=useRef<Core|null>(null);
  const data=useMemo(()=>fixture(count),[count]);
  const download=async(format:"svg"|"png")=>{
    if(graph.current) await exportNetworkFigure(graph.current,format,"synthetic-galaxy",{metric:"evidence",scope:"Synthetic layout fixture — not biological results",methodCount:2,geneCount:data.nodes.length,edgeCount:data.edges.length,matchingEdges:data.edges.length,methods:["Example A","Example B"],filters:"None",focus:gene,highlightedMethod:null});
  };
  return <main style={{padding:"24px",maxWidth:1600,margin:"0 auto",background:"#f4f7f6",color:"#273d39"}}>
    <h1 style={{fontSize:24,fontWeight:600}}>Galaxy layout lab</h1>
    <p style={{color:"#64748b",margin:"6px 0 18px"}}>Synthetic branching network for visual testing. These are not project results.</p>
    <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
      {[20,100,180,1000].map(n=><button key={n} onClick={()=>{setCount(n);setGene(null);setEdge(null);}} aria-pressed={count===n} style={{padding:"8px 16px",border:"1px solid #cad5d5",borderRadius:8,color:"#273d39",background:count===n?"#d8e8e5":"white"}}>{n} genes</button>)}
      <select aria-label="Test layout" value={layout} onChange={e=>setLayout(e.target.value as NetworkLayoutMode)}><option value="force">Galaxy</option><option value="circular">Circular</option><option value="hierarchical">Hierarchical</option></select>
      <button onClick={()=>download("svg")}>Export SVG</button><button onClick={()=>download("png")}>Export PNG</button>
      <span role="status">{gene??edge??"No selection"}</span>
    </div>
    <section className="grn-atlas"><div className="grn-graph-region" style={{height:"72vh",minHeight:500}}>
      <NetworkCanvas {...data} layout={layout} selectedGene={gene} selectedEdgeKey={edge} onSelectGene={setGene} onSelectEdge={setEdge} onGraphReady={cy=>{graph.current=cy;}} />
    </div></section>
  </main>;
}
