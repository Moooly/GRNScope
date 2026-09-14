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
      assert.ok(Object.values(result.routes).filter(r=>r.distances.some(d=>Math.abs(d)>3)).length>30, "leaf fans should curve together");
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
    assert.ok(result.ab.distances.every(d=>Math.abs(d)<1e-8));
    assert.deepEqual(positions,original);
  }
});

test("direction, evidence and topology updates keep their meaning", () => {
  const nodes=fixture.nodes.slice(0,3);
  const edge=fixture.edges[0];
  const edges=[{...edge,key:"reverse",direction:-1,sign:-1},{...edge,key:"undirected",direction:0,sign:1},{...edge,key:"unverified",bootstrapVerified:false,sign:0}];
  const elements=galaxyElements(nodes,edges);
  const data=id=>elements.find(e=>e.data.id===id).data;
  assert.equal(data("reverse").sourceTip,"tee");
  assert.equal(data("reverse").targetTip,"none");
  assert.equal(data("undirected").sourceTip,"none");
  assert.equal(data("undirected").targetTip,"none");
  assert.equal(data("unverified").confidence,null);
  assert.notEqual(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,edges,"circular"));
  assert.notEqual(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,[edges[0],{...edges[1],target:nodes[2].id},edges[2]],"force"));
  assert.equal(galaxySignature(nodes,edges,"force"),galaxySignature(nodes,edges.map(e=>({...e,score:0.1})),"force"));
});

test("selection releases a bundled relationship without changing topology", () => {
  const input=inputFor(fixture.nodes,fixture.edges), result=buildGalaxy(input);
  const elements=galaxyElements(fixture.nodes,fixture.edges);
  elements.forEach(e=>{ if(result.positions[e.data.id]) e.position=result.positions[e.data.id]; if(result.routes[e.data.id]) {e.data.routeDistances=result.routes[e.data.id].distances;e.data.routeWeights=result.routes[e.data.id].weights;} });
  const cy=cytoscape({headless:true,styleEnabled:true,elements,style:buildNetworkStylesheet(),layout:{name:"preset"}});
  try {
    const e=cy.edges()[0];
    assert.equal(e.style("curve-style"),"unbundled-bezier");
    e.addClass("traced");
    assert.equal(e.style("curve-style"),"bezier");
    e.removeClass("traced");
    assert.equal(e.style("curve-style"),"unbundled-bezier");
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

test("Irf8-like spokes use one smooth arc without local elbows, joins or backtracking", () => {
  // Fixed geometry from the reported close-up: exercise routing only, not layout.
  const positions={Irf8:{x:470,y:374},Tyrobp:{x:254,y:128},Csf1r:{x:774,y:168},Selplg:{x:123,y:356},F13a1:{x:794,y:412},Sell:{x:181,y:594},Ptpn6:{x:432,y:645},Psap:{x:677,y:675}};
  const nodes=Object.keys(positions).map(id=>({id,diameter:id==="Irf8"?114:44,labelWidth:80}));
  const edges=nodes.slice(1).map(n=>({id:`Irf8-${n.id}`,source:"Irf8",target:n.id,sign:1,direction:0}));
  const input={nodes,edges,width:1022,height:812}, original=structuredClone(positions);
  const routes=routeGalaxy(input,positions);
  verify(input,{positions,routes});
  assert.deepEqual(positions,original);
  assert.ok(Object.values(routes).some(r=>Math.abs(r.distances[0])>3),"retain the hub's curved flow");
  for(const e of edges) {
    const r=routes[e.id], s=positions[e.source], t=positions[e.target];
    assert.equal(r.weights.length,1,"a single analytic quadratic, not stitched curve sections");
    const dx=t.x-s.x,dy=t.y-s.y,len=Math.hypot(dx,dy),w=r.weights[0],d=r.distances[0];
    const c={x:s.x+dx*w-dy/len*d,y:s.y+dy*w+dx/len*d};
    const dd={x:2*(t.x-2*c.x+s.x),y:2*(t.y-2*c.y+s.y)};
    let curvature;
    for(let i=0;i<=100;i++) {
      const u=i/100, vx=2*((1-u)*(c.x-s.x)+u*(t.x-c.x)),vy=2*((1-u)*(c.y-s.y)+u*(t.y-c.y));
      assert.ok(vx*dx+vy*dy>0,"curve must not reverse along the connection");
      const cross=vx*dd.y-vy*dd.x;
      if(curvature===undefined) curvature=cross;
      assert.ok(Math.abs(cross-curvature)<1e-7,"no local curvature-sign changes");
    }
  }
});
