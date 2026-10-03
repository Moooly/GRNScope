import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection } from "../networkVisualEncoding";
import { nodeDegrees } from "./model";
import type { NodeSizeBy } from "./encoding";

/**
 * The tables and text that go with the figure: a supplementary workbook
 * (Links, Genes, About), a plain CSV, and a ready-to-paste figure legend —
 * all describing exactly the links and genes the figure shows.
 */
export type PaperContext = {
  projectName: string;
  projectId: string;
  methods: string[];
  /** Results Settings, e.g. "Evidence ≥ 0.81; confidence ≥ 0%; …". */
  filters: string;
  scope: string;
  focus: string | null;
  effect: "all" | "activation" | "repression" | "unknown";
  palette: "soft" | "contrast";
  sizeBy: NodeSizeBy;
  widthBy: "evidence" | "support";
  exportedAt?: Date;
};

export type LinkRow = { regulator: string; target: string; effect: string; directed: boolean; evidence: number; confidence: number | null; methods: number; methodNames: string[] };
export type GeneRow = { gene: string; tf: boolean; targets: number; regulators: number; unknown: number; links: number };

export function linkRows(edges: NetworkEdge[]): LinkRow[] {
  return [...edges].sort((a, b) => b.score - a.score).map(e => {
    const directed = hasDirection(e), reversed = directed && e.direction === -1;
    return {
      regulator: reversed ? e.target : e.source, target: reversed ? e.source : e.target,
      effect: e.sign === 1 ? "activation" : e.sign === -1 ? "repression" : "unknown",
      directed, evidence: e.score, confidence: e.bootstrapVerified ? e.confidence : null,
      methods: e.count, methodNames: e.supportingAlgorithms,
    };
  });
}

export function geneRows(nodes: NetworkNode[], edges: NetworkEdge[]): GeneRow[] {
  const d = nodeDegrees(edges);
  return nodes.map(n => ({ gene: n.id, tf: n.isTF, targets: d.out.get(n.id) ?? 0, regulators: d.in.get(n.id) ?? 0, unknown: d.unknown.get(n.id) ?? 0, links: d.all.get(n.id) ?? 0 }))
    .filter(g => g.links > 0)
    .sort((a, b) => b.links - a.links || b.targets - a.targets || a.gene.localeCompare(b.gene));
}

/** Only the settings that actually cut something (drops "≥ 0%", "support ≥ 1"). */
export function activeFilters(filters: string) {
  return filters.split(";").map(s => s.trim()).filter(s => s && !/≥ 0%$/.test(s) && !/^support ≥ 1$/i.test(s) && !/≥ 0\.00$/.test(s));
}

const LINK_HEAD = ["regulator", "target", "effect", "direction_resolved", "evidence", "bootstrap_confidence", "methods_agreeing", "methods"];
function linkCells(r: LinkRow): (string | number)[] {
  return [r.regulator, r.target, r.effect, r.directed ? "yes" : "no", Number(r.evidence.toFixed(3)), r.confidence === null ? "" : Number(r.confidence.toFixed(3)), r.methods, r.methodNames.join("; ")];
}

export function linksCsv(edges: NetworkEdge[]) {
  const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [LINK_HEAD, ...linkRows(edges).map(linkCells)].map(r => r.map(cell).join(",")).join("\n") + "\n";
}

// ---- Figure legend -----------------------------------------------------

const list = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function figureLegend(nodes: NetworkNode[], edges: NetworkEdge[], ctx: PaperContext) {
  const genes = geneRows(nodes, edges);
  const soft = ctx.palette === "soft";
  const directed = edges.some(hasDirection), undirected = edges.some(e => !hasDirection(e));
  const signs = new Set(edges.map(e => e.sign));
  const faded = edges.some(e => e.bootstrapVerified && e.confidence < 0.8);
  const filters = activeFilters(ctx.filters);
  const sentences = [
    `Network of ${genes.length} genes and ${edges.length} regulatory ${edges.length === 1 ? "edge" : "edges"}`
      + `${filters.length ? ` (${filters.join("; ").replace(/^Evidence/, "evidence")})` : ""}`
      + `${ctx.methods.length ? `, inferred ${ctx.methods.length > 1 ? `by consensus of ${ctx.methods.length} methods (${list(ctx.methods)})` : `with ${ctx.methods[0]}`}` : ""}`
      + `${ctx.focus ? `, showing the direct neighbourhood of ${ctx.focus}` : ""}`
      + `${ctx.effect !== "all" ? `; ${ctx.effect === "unknown" ? "edges of unknown sign" : `${ctx.effect} edges`} only` : ""}.`,
    `${soft ? "Blue" : "Orange"} circles, transcription factors; ${soft ? "yellow" : "grey"} circles, other genes; circle size, ${ctx.sizeBy === "out" ? "number of target genes" : ctx.sizeBy === "in" ? "number of regulators" : "number of edges"}.`,
    ...(directed ? [`Each circle is split by edge direction (dark, regulates; light, regulated by${undirected ? "; pale, direction unknown" : ""}).`] : []),
    [signs.has(1) ? "Arrowheads, activation" : "", signs.has(-1) ? "bars, repression" : "", signs.has(0) ? "no tip, sign unknown" : "", undirected ? "dashed lines, direction not resolved" : ""].filter(Boolean).join("; ").replace(/^./, c => c.toUpperCase()) + ".",
    `Line width, ${ctx.widthBy === "support" ? "number of methods reporting the edge" : "evidence (per-target rank, 0–1)"}${faded ? "; faded lines, bootstrap confidence below 0.8" : ""}.`,
  ].filter(s => s !== ".");
  return `Gene regulatory network inferred with GRNScope. ${sentences.join(" ")}`;
}

// ---- XLSX (written directly: a zip of a few XML parts) ----------------

type Cell = string | number | { v: string | number; s: number };
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Styles: 0 plain · 1 header (bold, rule below) · 2 italic gene · 3 0.000 · 4 wrapped text · 5 bold label. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><i/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="2"><border/><border><bottom style="medium"><color rgb="FF000000"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(rows: Cell[][], widths: number[], freezeHeader: boolean) {
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const { v, s } = typeof cell === "object" ? cell : { v: cell, s: 0 };
    const ref = `${colName(c)}${r + 1}`;
    if (v === "") return "";
    return typeof v === "number" ? `<c r="${ref}" s="${s}"><v>${v}</v></c>` : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const pane = freezeHeader ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

export async function supplementaryWorkbook(nodes: NetworkNode[], edges: NetworkEdge[], ctx: PaperContext): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const links = linkRows(edges), genes = geneRows(nodes, edges);
  const head = (cells: string[]) => cells.map(v => ({ v, s: 1 }));
  const gene = (v: string) => ({ v, s: 2 });
  const num = (v: number | "") => v === "" ? "" : { v, s: 3 };
  const linkSheet: Cell[][] = [head(LINK_HEAD), ...links.map(r => {
    const c = linkCells(r);
    return [gene(r.regulator), gene(r.target), c[2], c[3], num(r.evidence), r.confidence === null ? "" : num(r.confidence), r.methods, c[7]] as Cell[];
  })];
  const geneSheet: Cell[][] = [head(["gene", "transcription_factor", "targets", "regulators", "direction_unknown", "edges"]),
    ...genes.map(g => [gene(g.gene), g.tf ? "yes" : "no", g.targets, g.regulators, g.unknown, g.links] as Cell[])];
  const when = ctx.exportedAt ?? new Date();
  const about: [string, string][] = [
    ["Project", `${ctx.projectName} (${ctx.projectId})`],
    ["Exported", `${when.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Software", "GRNScope"],
    ["Methods", `${ctx.methods.join(", ")} (${ctx.methods.length})`],
    ["Scope", ctx.scope],
    ["Filters", ctx.filters || "None"],
    ...(ctx.focus ? [["Neighbourhood", ctx.focus] as [string, string]] : []),
    ...(ctx.effect !== "all" ? [["Edges shown", `${ctx.effect} only`] as [string, string]] : []),
    ["evidence", "Per-target rank of the regulator (0–1; 1 = strongest regulator of that target), averaged across methods."],
    ["bootstrap_confidence", "Share of bootstrap runs that recover the edge; empty when not verified."],
    ["direction_resolved", "yes when the methods agree on which gene regulates which; otherwise the regulator column is the listed source."],
    ["methods_agreeing", `Number of the ${ctx.methods.length} selected methods that report the edge.`],
    ["Contents", `Edges: ${links.length} rows · Genes: ${genes.length} rows — the same edges and genes as the exported figure.`],
    ["Figure legend", figureLegend(nodes, edges, ctx)],
  ];
  const aboutSheet: Cell[][] = about.map(([k, v]) => [{ v: k, s: 5 }, { v, s: 4 }]);
  const sheets = [
    { name: "Edges", xml: sheetXml(linkSheet, [14, 14, 12, 18, 10, 20, 17, 44], true) },
    { name: "Genes", xml: sheetXml(geneSheet, [14, 20, 10, 12, 18, 8], true) },
    { name: "About", xml: sheetXml(aboutSheet, [22, 100], false) },
  ];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---- Saving ------------------------------------------------------------

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function paperFileBase(ctx: PaperContext, when = new Date()) {
  const safe = (ctx.projectName || "network").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "network";
  const day = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `${safe}-network-${day}`;
}
