import "cytoscape";
declare module "cytoscape" {
  interface Core {
    svg(options?: { full?: boolean; scale?: number; bg?: string }): string;
  }
}
