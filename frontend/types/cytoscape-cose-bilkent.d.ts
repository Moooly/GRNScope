declare module "cytoscape-cose-bilkent" {
  const coseBilkent: (cytoscape: typeof import("cytoscape")) => void;
  export default coseBilkent;
}