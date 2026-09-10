declare module "cytoscape-svg" {
  const cytoscapeSvg: (cytoscape: typeof import("cytoscape")) => void;
  export default cytoscapeSvg;
}
