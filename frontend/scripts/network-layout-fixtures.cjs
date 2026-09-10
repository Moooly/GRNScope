const make = (name, count, pairs) => {
  const names = [
    "SRY",
    "SOX9",
    "GATA4",
    "CTNNB1",
    "PGD2",
    "CBX2",
    "NR0B1",
    "WNT4",
    "UGR",
    "RSPO1",
    "FOXL2",
    "NR5A1",
    "WT1mKTS",
    "FGF9",
    "DHH",
    "DMRT1",
    "MAP3K1",
    "SOX8",
    "DMRT1_LONG_LABEL",
  ];
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: names[i] ?? `GENE_${i}`,
    isTF: i % 3 !== 2,
    degree: pairs.filter((p) => p.includes(i)).length,
    inDegree: pairs.filter((p) => p[1] === i).length,
    outDegree: pairs.filter((p) => p[0] === i).length,
  }));
  const edges = pairs.map(([a, b], i) => ({
    key: `edge-${i}`,
    source: nodes[a].id,
    target: nodes[b].id,
    score: 0.8,
    confidence: 0.7,
    bootstrapVerified: true,
    count: 2,
    rank: i + 1,
    supportingAlgorithms: ["one", "two"],
    direction: 1,
    directionConfidence: 0.8,
    directionCoverage: 1,
    sign: i % 3 === 0 ? -1 : 1,
    signConfidence: 0.8,
    signCoverage: 1,
  }));
  return { name, nodes, edges };
};
const sparsePairs = [
  ...Array.from({ length: 13 }, (_, i) => [i, i + 1]),
  [0, 3],
  [0, 5],
  [1, 6],
  [3, 7],
  [4, 9],
  [6, 10],
  [15, 16],
];
module.exports = [
  make("sparse-17-genes-20-edges", 17, sparsePairs),
  make(
    "dense-19-genes-171-edges",
    19,
    Array.from({ length: 19 }, (_, a) =>
      Array.from({ length: 18 - a }, (_, i) => [a, a + i + 1]),
    ).flat(),
  ),
  make(
    "disconnected-24-genes",
    24,
    Array.from({ length: 6 }, (_, g) => [
      [g * 4, g * 4 + 1],
      [g * 4, g * 4 + 2],
      [g * 4 + 1, g * 4 + 3],
    ]).flat(),
  ),
];
