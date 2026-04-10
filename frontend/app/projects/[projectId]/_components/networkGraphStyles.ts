export function getNetworkGraphStylesheet() {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: "#f8fafc",
        "font-size": 11,
        "font-weight": 700,
        "text-wrap": "none",
        "text-max-width": 96,
        "text-valign": "center",
        "text-halign": "center",
        "text-outline-width": 3,
        "text-outline-color": "#0f172a",
        "min-zoomed-font-size": 9,
        width: "mapData(degree, 1, 20, 24, 78)",
        height: "mapData(degree, 1, 20, 24, 78)",
        "overlay-opacity": 0,
        "border-width": 2,
        "border-opacity": 0.95,
        "background-opacity": 0.97,
        "shadow-blur": 18,
        "shadow-opacity": 0.2,
        "shadow-offset-x": 0,
        "shadow-offset-y": 8,
        "shadow-color": "#0f172a",
        "text-margin-y": 0,
      },
    },
    {
      selector: 'node[isTF = 1]',
      style: {
        shape: "diamond",
        "background-color": "#14b8a6",
        "border-width": 3,
        "border-color": "#0f766e",
      },
    },
    {
      selector: 'node[isTF = 0]',
      style: {
        shape: "ellipse",
        "background-color": "#64748b",
        "border-width": 3,
        "border-color": "#334155",
      },
    },
    {
      selector: 'node[degree >= 8]',
      style: {
        "font-size": 12,
      },
    },
    {
      selector: 'node[degree < 3]',
      style: {
        "font-size": 9,
      },
    },
    {
      selector: "edge",
      style: {
        width: "mapData(score, 0, 1, 0.9, 3.8)",
        "line-color": "#9fb1c5",
        opacity: 0.28,
        "curve-style": "bezier",
        "source-endpoint": "outside-to-node",
        "target-endpoint": "outside-to-node",
        "line-cap": "round",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#9fb1c5",
        "arrow-scale": 0.72,
        "overlay-opacity": 0,
        "z-index": 1,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.25]',
      style: {
        "line-color": "#94a3b8",
        "target-arrow-color": "#94a3b8",
        opacity: 0.34,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.5]',
      style: {
        "line-color": "#5eead4",
        "target-arrow-color": "#5eead4",
        opacity: 0.46,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.75]',
      style: {
        "line-color": "#2dd4bf",
        "target-arrow-color": "#2dd4bf",
        opacity: 0.58,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.99]',
      style: {
        "line-color": "#0f766e",
        "target-arrow-color": "#0f766e",
        opacity: 0.72,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 5,
        "border-color": "#2563eb",
        "shadow-blur": 28,
        "shadow-opacity": 0.32,
        "shadow-color": "#60a5fa",
      },
    },
    {
      selector: "edge:selected",
      style: {
        width: 5.8,
        "line-color": "#2563eb",
        "target-arrow-color": "#2563eb",
        opacity: 1,
        "z-index": 12,
        "underlay-color": "rgba(37, 99, 235, 0.18)",
        "underlay-padding": 4,
        "underlay-opacity": 1,
      },
    },
    {
      selector: "edge.hovered",
      style: {
        width: 6.6,
        "line-color": "#14b8a6",
        "target-arrow-color": "#14b8a6",
        opacity: 0.96,
        "z-index": 11,
        "underlay-color": "rgba(20, 184, 166, 0.2)",
        "underlay-padding": 4,
        "underlay-opacity": 1,
      },
    },
  ];
}