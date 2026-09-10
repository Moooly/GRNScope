// Synthetic topology for layout validation, not a biological inference result.
const nodes = [],
  edges = [];
function node(id) {
  nodes.push({
    id,
    isTF: id.startsWith("HUB"),
    degree: 0,
    inDegree: 0,
    outDegree: 0,
  });
  return id;
}
function link(source, target) {
  edges.push({
    key: `${source}-${target}`,
    source,
    target,
    score: 0.8,
    confidence: 0.7,
    bootstrapVerified: true,
    count: 2,
    rank: edges.length + 1,
    supportingAlgorithms: ["one", "two"],
    direction: 1,
    directionConfidence: 1,
    directionCoverage: 1,
    sign: 1,
    signConfidence: 1,
    signCoverage: 1,
  });
}
for (let i = 0; i < 6; i++) node(`HUB_${i}`);
for (let i = 1; i < 6; i++) link("HUB_0", `HUB_${i}`);
link("HUB_1", "HUB_2");
link("HUB_2", "HUB_3");
for (let h = 0; h < 6; h++)
  for (let i = 0; i < 22; i++) link(`HUB_${h}`, node(`LEAF_${h}_${i}`));
for (let i = 0; i < 8; i++)
  link(i === 0 ? "HUB_4" : `CHAIN_${i - 1}`, node(`CHAIN_${i}`));
for (const e of edges) {
  const a = nodes.find((n) => n.id === e.source),
    b = nodes.find((n) => n.id === e.target);
  a.degree++;
  a.outDegree++;
  b.degree++;
  b.inDegree++;
}
module.exports = { name: "synthetic-146-gene-branching-network", nodes, edges };
