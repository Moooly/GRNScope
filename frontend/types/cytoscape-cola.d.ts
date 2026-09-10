declare module "cytoscape-cola" {
  const cola: (cytoscape: typeof import("cytoscape")) => void;
  export default cola;
}
