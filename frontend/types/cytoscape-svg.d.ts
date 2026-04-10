import "cytoscape";

declare module "cytoscape-svg" {
  const cytoscapeSvg: (cytoscape: any) => void;
  export default cytoscapeSvg;
}

declare module "cytoscape" {
  interface Core {
    svg(options?: {
      full?: boolean;
      scale?: number;
      bg?: string;
    }): string;
  }
}

export {};