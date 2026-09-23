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

test("node sizes span this network's own range with tenfold contrast", () => {
  for (const [lo, hi] of [[1,18],[13,17],[0,723]]) {
    const sizes=[lo,(lo+hi)/2,hi].map(d => nodeDiameter(d,lo,hi));
    assert.ok(sizes.every((s,i) => s>=10 && s<=100 && (!i || s>sizes[i-1])));
    assert.equal(nodeDiameter(hi,lo,hi)/nodeDiameter(lo,lo,hi),10,"smallest to largest is 1:10 whatever the degree range");
  }
  assert.equal(nodeDiameter(5,5,5),40,"a network where every gene is alike draws them alike");
});

test("spacing expands positions without zooming, growing glyphs, or losing records", () => {
  const {applyNetworkSpacing}=require(base+"spacing.ts");
  const cy=cytoscape({headless:true,elements:[
    {data:{id:"a",diameter:6},position:{x:10,y:20}},
    {data:{id:"b",diameter:60},position:{x:110,y:20}},
    {data:{id:"ab",source:"a",target:"b",routeDistances:[20],routeWeights:[0.5]}}
  ],layout:{name:"preset"}});
  try {
    const zoom=cy.zoom(),pan={...cy.pan()},original=cy.nodes().map(n=>({...n.position()}));
    applyNetworkSpacing(cy,1.5);
    assert.equal(cy.$id("b").position("x")-cy.$id("a").position("x"),150);
    assert.equal(cy.zoom(),zoom);assert.deepEqual(cy.pan(),pan);
    assert.deepEqual(cy.nodes().map(n=>n.data("diameter")),[6,60]);
    assert.equal(cy.elements().length,3);assert.deepEqual(cy.$id("ab").data("routeDistances"),[30]);
    applyNetworkSpacing(cy,1);
    cy.nodes().forEach((n,i)=>assert.ok(Math.hypot(n.position("x")-original[i].x,n.position("y")-original[i].y)<1e-9));
  } finally {cy.destroy();}
});

test("preset layouts reserve larger hubs without changing their ordering", () => {
  const {spacePresetPositions}=require(base+"spacing.ts");
  const input={a:{x:0,y:0},b:{x:30,y:0},c:{x:60,y:0}};
  const nodes=[{id:"a",diameter:20},{id:"b",diameter:200},{id:"c",diameter:150}];
  const positions=spacePresetPositions(nodes,input);
  verify({nodes,edges:[]},{positions,routes:{}});
  assert.equal(positions.a.y,positions.b.y);
  assert.equal(positions.b.y,positions.c.y);
  assert.deepEqual(input,{a:{x:0,y:0},b:{x:30,y:0},c:{x:60,y:0}});
});

test("a selected 723-neighbour hub never bypasses name or disc collisions", () => {
  const candidates=Array.from({length:724},(_,i) => ({ id:`Gene${i}`,x: i ? 600+Math.cos(i*2.399963)*(60+Math.sqrt(i)*9) : 600,
    y: i ? 350+Math.sin(i*2.399963)*(60+Math.sqrt(i)*9) : 350, radius: i?4:15, width:60, height:17, priority:i?2:4, degree:i?1:723 }));
  const labels=planLabels(candidates,1200,700,90);
  // Names now sit inside their discs, so a tightly packed fan shows fewer of
  // them; the hub is always named and nothing may overlap.
  assert.ok(labels.has("Gene0")); assert.ok(labels.size<90 && labels.size>=1);
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
    // Up to 600 genes a dense input is positioned by its backbone (each
    // gene's three strongest links) and solved as one network; larger inputs
    // keep the bounded-region path.
    if(count>600) {
      assert.equal(Object.keys(result.neighborhoods).length,count);
      assert.ok(new Set(Object.values(result.neighborhoods)).size>=3);
    } else assert.equal(Object.keys(result.neighborhoods).length,0);
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

test("opacity encodes bootstrap confidence only: bridges, zoom and missing values never change it", () => {
  const nodes=fixture.nodes.slice(0,3), base0=fixture.edges[0];
  const edges=[
    {...base0,key:"high",bootstrapVerified:true,confidence:0.9},
    {...base0,key:"mid",bootstrapVerified:true,confidence:0.6},
    {...base0,key:"low",bootstrapVerified:true,confidence:0.2},
    {...base0,key:"none",bootstrapVerified:false,confidence:0.2},
  ];
  const cy=cytoscape({headless:true,styleEnabled:true,elements:galaxyElements(nodes,edges),style:buildNetworkStylesheet()});
  try {
    cy.scratch("galaxyFitZoom",1); cy.edges().data("crossNeighborhood",true); applyPresentation(cy,true);
    const ink=id=>cy.$id(id).data("inkOpacity");
    assert.equal(ink("high"),1); assert.equal(ink("mid"),0.45); assert.equal(ink("low"),0.15);
    assert.equal(ink("none"),1,"an unverified relationship is drawn solid, not penalised");
    cy.zoom(2); applyPresentation(cy,true);
    assert.equal(ink("mid"),0.45,"zoom must not change the confidence channel");
    assert.ok(cy.$id("high").data("zIndex")>cy.$id("low").data("zIndex"),"confident relationships draw on top");
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
  assert.notEqual(galaxySignature(nodes,edges,"force","all"),galaxySignature(nodes,edges,"force","out"),"a new size measure re-solves the layout");
  const weak=edges.map(e=>({...e,score:0.3,count:1}));
  const cy=cytoscape({headless:true,styleEnabled:true,elements:galaxyElements(nodes,weak,{widthBy:"evidence",methodCount:3}),style:buildNetworkStylesheet(),layout:{name:"preset"}});
  try {
    cy.scratch("galaxyFitZoom",1);
    const positions=cy.nodes().map(n=>({...n.position()}));
    applyPresentation(cy,true);
    const thin=cy.edges()[0].data("width");
    galaxyElements(nodes,weak.map(e=>({...e,score:0.95})),{widthBy:"evidence",methodCount:3}).forEach(el=>cy.$id(String(el.data.id)).data(el.data));
    applyPresentation(cy,true);
    assert.ok(cy.edges()[0].data("width")>thin*5,"the strongest evidence step is at least 5x the weakest");
    galaxyElements(nodes,weak.map(e=>({...e,count:3})),{widthBy:"support",methodCount:3}).forEach(el=>cy.$id(String(el.data.id)).data(el.data));
    applyPresentation(cy,true);
    assert.equal(cy.edges()[0].data("widthStep"),3,"all methods = widest step");
    assert.deepEqual(cy.nodes().map(n=>({...n.position()})),positions);
    assert.equal(cy.nodes()[0].style("background-fill"),"solid");
    assert.equal(Number(cy.nodes()[0].style("border-width").replace("px","")),0,"nodes have no rim");
  } finally {cy.destroy();}
});

test("node size follows the chosen measure: targets, all connections or regulators", () => {
  const nodes=[{id:"TF",isTF:true},{id:"A",isTF:false},{id:"B",isTF:false},{id:"C",isTF:false}];
  const e=(key,source,target,direction)=>({key,source,target,score:0.5,confidence:0,count:1,rank:1,supportingAlgorithms:[],direction,directionConfidence:1,directionCoverage:1,sign:1,signConfidence:1,signCoverage:1});
  const edges=[e("1","TF","A",1),e("2","TF","B",1),e("3","TF","C",1),e("4","A","B",0),e("5","C","B",1)];
  const size=(by,id)=>galaxyElements(nodes,edges,{sizeBy:by}).find(x=>x.data.id===id).data.sizeValue;
  assert.equal(size("out","TF"),3); assert.equal(size("in","TF"),0); assert.equal(size("all","TF"),3);
  assert.equal(size("in","B"),2,"the undirected A-B link is not a regulator");
  assert.equal(size("all","B"),3,"but it is a connection");
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

test("sparse networks keep a fixed rim-to-rim edge length and clear space between genes", () => {
  const { EDGE_GAP } = require(base + "theme.ts");
  // No frame: measure the solver itself, before any widening to the canvas.
  const input = { ...inputFor(fixture.nodes, fixture.edges), width: 0, height: 0 }, result = buildGalaxy(input);
  verify(input, result);
  const P = result.positions, D = new Map(input.nodes.map(n => [n.id, n.diameter]));
  const rim = input.edges.filter(e => e.source !== e.target).map(e => Math.hypot(P[e.source].x-P[e.target].x, P[e.source].y-P[e.target].y) - D.get(e.source)/2 - D.get(e.target)/2).sort((a,b)=>a-b);
  const median = rim[Math.floor(rim.length/2)];
  assert.ok(Math.abs(median-EDGE_GAP) <= EDGE_GAP*0.25, `median rim length ${median} should be close to ${EDGE_GAP}`);
  assert.ok(rim[0] > 12, "no edge collapses to a stub");
  for (let i=0;i<input.nodes.length;i++) for (let j=i+1;j<input.nodes.length;j++) {
    const a=input.nodes[i], b=input.nodes[j];
    assert.ok(Math.hypot(P[a.id].x-P[b.id].x, P[a.id].y-P[b.id].y) - (a.diameter+b.diameter)/2 >= 12, `too close: ${a.id} ${b.id}`);
  }
});

test("dense networks are positioned by a backbone of each gene's strongest links; all links stay drawn", () => {
  const { layoutBackbone, occludedEdges } = require(base + "galaxyGeometry.ts");
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, diameter: 30, labelWidth: 20 }));
  const edges = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) edges.push({ id: `${i}-${j}`, source: `g${i}`, target: `g${j}`, sign: 1, direction: 0, weight: ((i * 7 + j * 3) % 10) / 10 });
  const input = { nodes, edges, width: 1000, height: 600 };
  const backbone = layoutBackbone(input);
  assert.ok(backbone.edges.length < edges.length / 2, "the layout ignores most weak links");
  for (const n of nodes) assert.ok(backbone.edges.some(e => e.source === n.id || e.target === n.id), "every gene keeps a link");
  const top = edges.filter(e => e.source === "g0" || e.target === "g0").sort((a, b) => b.weight - a.weight)[0];
  assert.ok(backbone.edges.includes(top), "a gene's strongest link is in the backbone");
  const result = buildGalaxy(input);
  assert.equal(Object.keys(result.positions).length, 12);
  assert.ok(Array.isArray(result.occluded));
  const sparse = { nodes: nodes.slice(0, 3), edges: edges.filter(e => ["0-1", "1-2"].includes(e.id)), width: 1000, height: 600 };
  assert.equal(layoutBackbone(sparse), sparse, "sparse networks use every link");
  const line = { nodes: [{ id: "a", diameter: 10 }, { id: "b", diameter: 10 }, { id: "c", diameter: 40 }], edges: [{ id: "ab", source: "a", target: "b", sign: 1, direction: 0 }] };
  assert.deepEqual(occludedEdges(line, { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, c: { x: 100, y: 5 } }), ["ab"]);
  assert.deepEqual(occludedEdges(line, { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, c: { x: 100, y: 60 } }), []);
});

test("curved links bow uniformly, and reciprocal links separate on their own", () => {
  const positions = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } };
  const nodes = [{ id: "a", diameter: 20, labelWidth: 10 }, { id: "b", diameter: 20, labelWidth: 10 }];
  const edges = [{ id: "ab", source: "a", target: "b", sign: 1, direction: 1 }, { id: "ba", source: "b", target: "a", sign: 1, direction: 1 }];
  const curved = routeGalaxy({ nodes, edges, curved: true }, positions);
  assert.ok(curved.ab.distances[0] > 0 && curved.ab.distances[0] <= 36);
  assert.equal(curved.ab.distances[0], curved.ba.distances[0], "same bow relative to each link's own direction, i.e. opposite sides");
  const straight = routeGalaxy({ nodes, edges: [edges[0]] }, positions);
  assert.equal(Object.keys(straight).length, 0, "without curves a single link stays straight");
});

test("arrowheads scale with their line and stay clearly visible", () => {
  const { arrowScaleFor } = require(base + "presentation.ts");
  // Rendered head length in screen px: 0.3 of cytoscape's arrow size.
  const head = (px, zoom) => 0.3 * Math.max(Math.pow(px / zoom * 13.37, 0.9), 29) * arrowScaleFor(px, zoom) * zoom;
  for (const zoom of [0.5, 1, 2]) {
    assert.ok(Math.abs(head(0.6, zoom) - 5.2) < 0.01, "thin link: a 5 px head at any zoom");
    assert.ok(Math.abs(head(3.6, zoom) - 11.2) < 0.01, "thick link: an 11 px head");
  }
});

test("a round arrangement is widened towards a wide canvas, by at most 1.8x, without overlaps", () => {
  const { fillFrame } = require(base + "galaxyGeometry.ts");
  const nodes = new Map(["a","b","c","d"].map(id => [id, { id, diameter: 20, labelWidth: 10 }]));
  const positions = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 0, y: 100 }, d: { x: 100, y: 100 } };
  fillFrame(positions, nodes, 1600, 600);
  assert.ok(Math.abs((positions.b.x - positions.a.x) - 180) < 1e-9, "capped at 1.8x");
  assert.equal(positions.c.y - positions.a.y, 100, "height untouched");
  const input = inputFor(fixture.nodes, fixture.edges), result = buildGalaxy({ ...input, width: 1600, height: 600 });
  verify(input, result);
  const xs = Object.values(result.positions).map(p => p.x), ys = Object.values(result.positions).map(p => p.y);
  assert.ok((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys)) > 1.5, "the arrangement uses the wide frame");
});

test("genes are split by link direction in their own colour, only when the view has directed links", () => {
  const nodes=[{id:"TF",isTF:true},{id:"A",isTF:false},{id:"B",isTF:false}];
  const e=(key,source,target,direction)=>({key,source,target,score:0.8,confidence:0,count:1,rank:1,supportingAlgorithms:[],direction,directionConfidence:1,directionCoverage:1,sign:1,signConfidence:1,signCoverage:1});
  const els=galaxyElements(nodes,[e("1","TF","A",1),e("2","TF","B",1),e("3","A","TF",0),e("4","B","TF",1)]);
  const tf=els.find(x=>x.data.id==="TF").data;
  // TF regulates A and B, is regulated by B, and has one undirected link with A.
  assert.equal(tf.pieSize,"100%");
  assert.equal(Math.round(tf.pieOut),50); assert.equal(Math.round(tf.pieIn),25); assert.equal(Math.round(tf.pieUnknown),25);

  const undirected=galaxyElements(nodes,[e("1","TF","A",0)]);
  assert.equal(undirected.find(x=>x.data.id==="TF").data.pieSize,"0%","no split without any direction");
  const cy=cytoscape({headless:true,styleEnabled:true,elements:els,style:buildNetworkStylesheet()});
  try {
    assert.equal(cy.$id("TF").style("border-width"),"0px");
    assert.notEqual(cy.$id("TF").style("pie-1-background-color"), cy.$id("A").style("pie-1-background-color"), "TFs and other genes keep their own hue");
    assert.equal(cy.$id("TF").style("pie-1-background-color"), "rgb(143,174,208)", "the darkest slice is the TF's own soft blue");
  } finally { cy.destroy(); }
});

test("the links filter keeps genes in place, hides other effects and fades genes left without links", () => {
  const { passesEffect } = require(base + "encoding.ts");
  assert.ok(passesEffect(1,"activation") && !passesEffect(-1,"activation") && passesEffect(-1,"repression") && passesEffect(0,"unknown") && passesEffect(-1,"all"));
  const nodes=[{id:"A",isTF:true},{id:"B",isTF:false},{id:"C",isTF:false}];
  const e=(key,source,target,sign)=>({key,source,target,score:0.8,confidence:0,count:1,rank:1,supportingAlgorithms:[],direction:1,directionConfidence:1,directionCoverage:1,sign,signConfidence:1,signCoverage:1});
  const cy=cytoscape({headless:true,styleEnabled:true,elements:galaxyElements(nodes,[e("ab","A","B",1),e("ac","A","C",-1)]),style:buildNetworkStylesheet()});
  try {
    cy.edges().forEach(x=>x.data("effectHidden",!passesEffect(x.data("sign"),"activation")));
    cy.nodes().forEach(n=>n.data("effectFaded",n.connectedEdges().every(x=>x.data("effectHidden"))));
    assert.equal(cy.$id("ac").style("display"),"none");
    assert.equal(cy.$id("ab").style("display"),"element");
    assert.equal(Number(cy.$id("C").style("opacity")),0.25);
    assert.equal(Number(cy.$id("B").style("opacity")),1);
  } finally { cy.destroy(); }
});
