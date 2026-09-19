/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const cytoscape = require("cytoscape");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const base = "../app/projects/[projectId]/_components/network/";
const { buildGalaxy, galaxyStructure, routeGalaxy } = require(base + "galaxyGeometry.ts");
const { galaxyElements, galaxySignature, galaxyInput } = require(base + "model.ts");
const { buildNetworkStylesheet } = require(base + "stylesheet.ts");
const { nodeDiameter, applyPresentation } = require(base + "presentation.ts");
const { exportNetworkFigure } = require(base + "../networkFigureExport.ts");
const { planLabels, labelsOverlap } = require(base + "labels.ts");
const { partitionSkeleton } = require(base + "neighborhoods.ts");
const fixture = require("./network-branch-fixture.cjs");
function inputFor(nodes, edges) {
  const cy = cytoscape({ headless: true, styleEnabled: true, elements: galaxyElements(nodes, edges), style: buildNetworkStylesheet(), layout: { name: "preset" } });
  const input = { ...galaxyInput(cy), width: 1200, height: 700 };
  cy.destroy(); return input;
}
function verify(input, result) {
  assert.deepEqual(Object.keys(result.positions).sort(), input.nodes.map(n=>n.id).sort());
  for (const p of Object.values(result.positions)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  for (const r of Object.values(result.routes)) {
    assert.equal(r.distances.length, r.weights.length);
    assert.ok(r.distances.every(Number.isFinite));
    assert.ok(r.weights.every((w,i)=>Number.isFinite(w) && w>0 && w<1 && (!i || w>=r.weights[i-1])));
  }
  const nodes = new Map(input.nodes.map(n=>[n.id,n]));
  for (const e of input.edges) {
    const r=result.routes[e.id];
    if(!r) continue;
    const s=result.positions[e.source], t=result.positions[e.target], len=Math.hypot(t.x-s.x,t.y-s.y);
    assert.ok(Math.hypot(r.weights[0]*len,r.distances[0])>nodes.get(e.source).diameter/2+2, `source handle inside ${e.id}`);
    assert.ok(Math.hypot((1-r.weights.at(-1))*len,r.distances.at(-1))>nodes.get(e.target).diameter/2+2, `target handle inside ${e.id}`);
  }
  for (let i=0;i<input.nodes.length;i++) for(let j=i+1;j<input.nodes.length;j++) {
    const a=input.nodes[i], b=input.nodes[j], p=result.positions[a.id], q=result.positions[b.id];
    assert.ok(Math.hypot(p.x-q.x,p.y-q.y)>=(a.diameter+b.diameter)/2, `overlap: ${a.id} ${b.id}`);
  }
}

test("galaxy retains every gene through expansion and separates hubs from their satellites", () => {
  for (const size of [20,100,146]) {
    const nodes=fixture.nodes.slice(0,size), ids=new Set(nodes.map(n=>n.id));
    const edges=fixture.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
    const input=inputFor(nodes,edges), original=structuredClone(input);
    const result=buildGalaxy(input);
    verify(input,result); assert.deepEqual(input,original);
    if(size===146) {
      const distances = (id, others) => others.map(other=>Math.hypot(result.positions[id].x-result.positions[other].x,result.positions[id].y-result.positions[other].y));
      const leaves=distances("HUB_1",nodes.filter(n=>n.id.startsWith("LEAF_1_")).map(n=>n.id));
      assert.ok(Math.max(...leaves)-Math.min(...leaves)>20, "satellites must not be a fixed-radius ring");
      assert.ok(distances("HUB_1",["HUB_0","HUB_2"]).every(d=>d>Math.max(...leaves)));
      assert.equal(Object.keys(result.routes).length, 0, "unique links should remain straight and individually traceable");
    }
  }
});

test("empty, singleton, reciprocal, loop, cyclic and disconnected inputs remain finite", () => {
  const nodes=["A","B","C","D","E","F"].map(id=>({id,diameter:10,labelWidth:30}));
  const edge=(id,source,target)=>({id,source,target,sign:1,direction:0});
  for(const input of [
    {nodes:[],edges:[],width:1000,height:600},
    {nodes:nodes.slice(0,1),edges:[],width:1000,height:600},
    {nodes,edges:[edge("ab","A","B"),edge("ba","B","A"),edge("loop","A","A"),edge("cd","C","D"),edge("de","D","E"),edge("ec","E","C")],width:1000,height:600},
  ]) verify(input,buildGalaxy(input));
  const simple={nodes:nodes.slice(0,2),edges:[edge("ab","A","B"),edge("ba","B","A")],width:1000,height:600};
  assert.equal(galaxyStructure(simple).neighbors.get("A").size,1);
  const result=buildGalaxy(simple);
  assert.notEqual(result.routes.ab.distances[0]*result.routes.ba.distances[0],0);
});

test("routing preserves endpoints and does not bundle opposing signs or directions", () => {
  const positions={a:{x:0,y:0},b:{x:300,y:40},c:{x:300,y:95}};
  const first={id:"ab",source:"a",target:"b",sign:1,direction:1};
  for(const second of [ {id:"ac",source:"a",target:"c",sign:-1,direction:1}, {id:"ac",source:"a",target:"c",sign:1,direction:-1} ]) {
    const original=structuredClone(positions);
    const result=routeGalaxy({edges:[first,second]},positions);
    assert.deepEqual(result, {}, "distinct connections do not acquire shared bends");
    assert.deepEqual(positions,original);
  }
});

test("direction, evidence and topology updates keep their meaning", () => {
  const nodes=fixture.nodes.slice(0,3);
  const edge=fixture.edges[0];
  const edges=[
    {...edge,key:"reverse",direction:-1,sign:-1},
    {...edge,key:"undirected",direction:0,sign:1},
    {...edge,key:"unsignedDirected",direction:1,sign:0},
    {...edge,key:"unverified",bootstrapVerified:false,sign:0,direction:0},
  ];
  const elements=galaxyElements(nodes,edges);
  const data=id=>elements.find(e=>e.data.id===id).data;

  // The glyph states the EFFECT; where it sits states what is known about
  // direction. A resolved direction puts one mark on the regulated end.
  assert.equal(data("reverse").sourceTip,"tee");
  assert.equal(data("reverse").targetTip,"none");

  // Unresolved direction must not look like bidirectional regulation.
  assert.equal(data("undirected").sourceTip,"none");
  assert.equal(data("undirected").targetTip,"none");
  assert.equal(data("undirected").sign,1);

  // Direction without an effect still marks the regulated end, hollow, because
  // there is a direction to state even though there is no effect to state.
  assert.equal(data("unsignedDirected").targetTip,"triangle");
  assert.equal(data("unsignedDirected").sourceTip,"none");
  assert.equal(data("unsignedDirected").arrowFill,"hollow");

  // Neither effect nor direction: nothing to say, so nothing is drawn.
  assert.equal(data("unverified").sourceTip,"none");
  assert.equal(data("unverified").targetTip,"none");
  assert.equal(data("unverified").confidence,null);
  assert.notEqual(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,edges,"circular"));
  assert.notEqual(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,[edges[0],{...edges[1],target:nodes[2].id},edges[2]],"force"));
  assert.equal(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,edges.map(e=>({...e,score:0.1})),"force"));
});

test("selection keeps connection routes and node positions stable", () => {
  const input=inputFor(fixture.nodes,fixture.edges), result=buildGalaxy(input);
  const elements=galaxyElements(fixture.nodes,fixture.edges);
  elements.forEach(e=>{ if(result.positions[e.data.id]) e.position=result.positions[e.data.id]; if(result.routes[e.data.id]) {e.data.routeDistances=result.routes[e.data.id].distances;e.data.routeWeights=result.routes[e.data.id].weights;} });
  const cy=cytoscape({headless:true,styleEnabled:true,elements,style:buildNetworkStylesheet(),layout:{name:"preset"}});
  try {
    const e=cy.edges()[0];
    assert.equal(e.style("curve-style"),"bezier");
    e.addClass("traced");
    assert.equal(e.style("curve-style"),"bezier");
    e.removeClass("traced");
    assert.equal(e.style("curve-style"),"bezier");
    assert.deepEqual(cy.nodes().map(n=>n.id()).sort(),fixture.nodes.map(n=>n.id).sort());
  } finally {cy.destroy();}
});

test("large hubs retain valid handles and overlapping drags fall back to native routing", () => {
  const nodes=[{id:"a",diameter:64,labelWidth:50},{id:"b",diameter:10,labelWidth:30}];
  const edges=[{id:"ab",source:"a",target:"b",sign:1,direction:1}];
  const input={nodes,edges,width:1000,height:600};
  const positions={a:{x:0,y:0},b:{x:65,y:0}};
  verify(input,{positions,routes:routeGalaxy(input,positions)});
  assert.deepEqual(routeGalaxy(input,{a:{x:0,y:0},b:{x:20,y:0}}),{});
});

test("spokes remain straight, while reciprocal records retain separate lanes on selection", () => {
  const nodes=fixture.nodes.slice(0,3), edge=fixture.edges[0];
  const edges=[{...edge,key:"forward"},{...edge,key:"reverse",source:edge.target,target:edge.source}];
  const input=inputFor(nodes,edges), result=buildGalaxy(input);
  const elements=galaxyElements(nodes,edges);
  elements.forEach(e=> { if(result.positions[e.data.id]) e.position=result.positions[e.data.id]; if(result.routes[e.data.id]) Object.assign(e.data,{routeDistances:result.routes[e.data.id].distances,routeWeights:result.routes[e.data.id].weights}); });
  const cy=cytoscape({headless:true,styleEnabled:true,elements,style:buildNetworkStylesheet(),layout:{name:"preset"}});
  try {
    const before=cy.nodes().map(n=>({...n.position()}));
    const e=cy.$id("forward"), control=e.data("routeDistances");
    assert.equal(e.style("curve-style"),"unbundled-bezier");
    e.addClass("traced");
    assert.equal(e.style("curve-style"),"unbundled-bezier");
    assert.deepEqual(e.data("routeDistances"),control);
    assert.deepEqual(cy.nodes().map(n=>({...n.position()})),before);
    verify(input,result);
  } finally {cy.destroy();}
});

test("density-aware sizes stay bounded, monotonic, and smaller in dense cores", () => {
  for (const [n,e] of [[19,67],[100,1738],[1193,7104]]) {
    const sizes=[1,3,10,50,723].map(d => nodeDiameter(d,n,e));
    assert.ok(sizes.every((s,i) => s>=7 && s<=34 && (!i || s>=sizes[i-1])));
  }
  assert.ok(nodeDiameter(34,100,1738)<nodeDiameter(34,100,200));
});

test("a selected 723-neighbour hub never bypasses name or disc collisions", () => {
  const candidates=Array.from({length:724},(_,i) => ({ id:`Gene${i}`,x: i ? 600+Math.cos(i*2.399963)*(60+Math.sqrt(i)*9) : 600,
    y: i ? 350+Math.sin(i*2.399963)*(60+Math.sqrt(i)*9) : 350, radius: i?4:15, width:60, height:17, priority:i?2:4, degree:i?1:723 }));
  const labels=planLabels(candidates,1200,700,90);
  assert.ok(labels.has("Gene0")); assert.ok(labels.size<90 && labels.size>5);
  const entries=[...labels.entries()];
  entries.forEach(([id,{rect:r}],i) => {
    entries.slice(i+1).forEach(([,p])=>assert.ok(!labelsOverlap(r,p.rect)));
    candidates.filter(n=>n.id!==id).forEach(n=>assert.ok(Math.hypot(Math.max(r.x1,Math.min(r.x2,n.x))-n.x,Math.max(r.y1,Math.min(r.y2,n.y))-n.y)>=n.radius+3));
  });
  const cy=cytoscape({headless:true,styleEnabled:true,elements:[{data:{id:"A",label:"",fullLabel:"A",diameter:10,labelSize:12,labelHalign:"center",labelValign:"bottom",labelOffsetX:0,labelOffsetY:4}}],style:buildNetworkStylesheet()});
  try { for(const state of ["traced","traced-neighbour","hovered"]) { cy.$id("A").classes(state); assert.equal(cy.$id("A").style("label"),""); } } finally {cy.destroy();}
});

test("dense 100- and 1193-node views retain every record and form bounded layout regions", () => {
  for (const count of [100,1193]) {
    const nodes=Array.from({length:count},(_,i)=>({id:`n${i}`,diameter:10,labelWidth:32}));
    const edges=[],pairs=new Set();
    const add=(a,b)=>{ const id=[a,b].sort((x,y)=>x-y).join(":"); if(a===b||pairs.has(id))return; pairs.add(id);edges.push({id,source:`n${a}`,target:`n${b}`,sign:1,direction:0}); };
    for(let i=0;i<count;i++) { for(let k=1;k<=6;k++) add(i,(Math.floor(i/30)*30+(i+k)%30)%count); if(i%7===0)add(i,(i+31)%count); }
    const input={nodes,edges,width:1200,height:700}, original=structuredClone(input), start=performance.now();
    const result=buildGalaxy(input);
    verify(input,result);assert.deepEqual(input,original);
    assert.equal(Object.keys(result.routes).length,0,"unique records use native straight links");
    assert.equal(Object.keys(result.neighborhoods).length,count);
    assert.ok(new Set(Object.values(result.neighborhoods)).size>=3);
    const structure=galaxyStructure(input), partition=partitionSkeleton([...structure.core],structure.neighbors);
    assert.deepEqual(partition,partitionSkeleton([...structure.core].reverse(),structure.neighbors));
    assert.ok(partition.every(g=>g.length<=72));
    assert.ok(performance.now()-start<15000,"bounded solves should not stall for large dense graphs");
  }
});

test("a giant satellite fan fills an area instead of forcing a thousand-node ring", () => {
  const nodes=Array.from({length:724},(_,i)=>({id:`n${i}`,diameter:i?7:30,labelWidth:30}));
  const edges=nodes.slice(1).map(n=>({id:n.id,source:"n0",target:n.id,sign:1,direction:0}));
  const input={nodes,edges,width:1200,height:700},result=buildGalaxy(input);
  verify(input,result);
  const p=result.positions.n0,distances=nodes.slice(1).map(n=>Math.hypot(result.positions[n.id].x-p.x,result.positions[n.id].y-p.y));
  assert.ok(Math.max(...distances)<2000);
  assert.ok(Math.min(...distances)<Math.max(...distances)*0.6);
});

test("bridges retain the same readable ink as local links and emphasis preserves every edge", () => {
  const nodes=fixture.nodes.slice(0,3),edges=fixture.edges.slice(0,1);
  const cy=cytoscape({headless:true,styleEnabled:true,elements:galaxyElements(nodes,edges),style:buildNetworkStylesheet()});
  try {
    cy.scratch("galaxyFitZoom",1); cy.edges().data("crossNeighborhood",true);
    applyPresentation(cy); const count=cy.edges().length;
    // The ladder is asserted as an ordering with a legibility floor rather than
    // as three fixed numbers. The exact values are a property of the ground the
    // canvas sits on -- they were raised when the galaxy moved from charcoal to
    // the site's white stage -- but the relationship between them is the design.
    const overview=cy.edges()[0].data("inkOpacity");
    cy.zoom(2); applyPresentation(cy); const detail=cy.edges()[0].data("inkOpacity");
    cy.scratch("galaxyEmphasize",true); applyPresentation(cy); const emphasized=cy.edges()[0].data("inkOpacity");
    assert.ok(overview>=0.4,`overview ink ${overview} is below the visible floor`);
    assert.ok(detail>overview,`zooming in must add ink (${detail} vs ${overview})`);
    assert.ok(emphasized>detail,`emphasis must add ink (${emphasized} vs ${detail})`);
    cy.scratch("galaxyEmphasize",false); cy.zoom(1); cy.edges().data("crossNeighborhood",false); applyPresentation(cy,true);
    assert.equal(cy.edges()[0].data("inkOpacity"),overview,"layout partition must not hide bridges");
    assert.equal(cy.edges().length,count);
  } finally {cy.destroy();}
  const reserved={x1:0,x2:300,y1:0,y2:100};
  const labels=planLabels([{id:"A",x:100,y:40,radius:5,width:40,height:15,priority:4,degree:10}],1200,700,20,[reserved]);
  assert.equal(labels.size,0,"captions and controls reserve their own space");
});

test("an unsigned relationship is never coloured as an activation", () => {
  // Colour is the sign channel and it has three values, not two. Before this,
  // "not repression" was drawn teal, so an edge whose sign no method resolved
  // was pixel-identical to a confirmed activation -- and since that case also
  // draws no end glyph, there was nothing at all to tell them apart.
  const nodes=fixture.nodes.slice(0,3);
  const edge=fixture.edges[0];
  const edges=[
    {...edge,key:"up",sign:1,direction:0},
    {...edge,key:"down",sign:-1,direction:0},
    {...edge,key:"nosign",sign:0,direction:0},
  ];
  const cy=cytoscape({headless:true,styleEnabled:true,elements:galaxyElements(nodes,edges),style:buildNetworkStylesheet()});
  try {
    const colour=id=>cy.$id(id).style("line-color");
    assert.notEqual(colour("nosign"),colour("up"),"unsigned must not read as activation");
    assert.notEqual(colour("nosign"),colour("down"),"unsigned must not read as repression");
    assert.notEqual(colour("up"),colour("down"));
  } finally {cy.destroy();}
});

test("an updating graph cannot be exported with new filters but old geometry", async () => {
  const cy=cytoscape({headless:true});
  try {
    cy.scratch("galaxyBusy",true);
    await assert.rejects(exportNetworkFigure(cy,"svg","test",{}),/still arranging/);
  } finally {cy.destroy();}
});


test("appearance and sign updates do not trigger a new layout", () => {
  const nodes=fixture.nodes.slice(0,3), edges=fixture.edges.slice(0,1);
  assert.equal(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,edges.map(e=>({...e,sign:-1,direction:-1})),"force"));
  const cy=cytoscape({headless:true,styleEnabled:true,elements:galaxyElements(nodes,edges),style:buildNetworkStylesheet(),layout:{name:"preset"}});
  try {
    cy.scratch("galaxyFitZoom",1);
    const positions=cy.nodes().map(n=>({...n.position()}));
    cy.scratch("publicationWeighted",false); applyPresentation(cy,true);
    const uniform=cy.edges()[0].data("width");
    cy.scratch("publicationWeighted",true); applyPresentation(cy,true);
    assert.notEqual(cy.edges()[0].data("width"),uniform);
    assert.deepEqual(cy.nodes().map(n=>({...n.position()})),positions);
    assert.equal(cy.nodes()[0].style("background-fill"),"solid");
  } finally {cy.destroy();}
});

test("pinning a low-degree label gives it priority without allowing overlap", () => {
  const candidates=[{id:"Pinned",x:200,y:200,radius:5,width:80,height:18,priority:5,degree:1},{id:"Hub",x:210,y:200,radius:5,width:80,height:18,priority:1,degree:100}];
  const labels=planLabels(candidates,500,400,1);
  assert.ok(labels.has("Pinned")); assert.equal(labels.size,1);
});

test("opening ranking never uses unverified bootstrap values", () => {
  const {selectOpeningEdges}=require(base+"../networkOpeningView.ts");
  const edges=Array.from({length:14},(_,i)=>({key:String(i),supportingAlgorithms:["A"],score:i/14,confidence:1-i/14,bootstrapVerified:false}));
  const shown=selectOpeningEdges(edges,1,false);
  assert.equal(shown.shown,12); assert.equal(shown.total,14);
  assert.equal(shown.edges[0].key,"13");
  assert.equal(selectOpeningEdges(edges,1,true).edges.length,14);
});
