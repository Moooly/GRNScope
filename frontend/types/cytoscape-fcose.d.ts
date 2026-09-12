declare module "cytoscape-fcose" {
  const fcose: (cytoscape: typeof import("cytoscape")) => void;
  export default fcose;
}
