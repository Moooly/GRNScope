export type Algorithm = {
  id: string;
  name: string;
  description: string;
  category: string;
  year: string;
  journal: string;
  runtime: string;
  runtimeMinutes: number;
  directed: boolean;
  signed: boolean;
  requiresPseudotime: boolean;
};