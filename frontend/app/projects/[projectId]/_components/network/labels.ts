import type { Core, NodeSingular } from "cytoscape";
import { labelBudget } from "./encoding";

/**
 * Which gene names are on screen.
 *
 * Two rules, both in rendered pixels because that is the space the collision
 * actually happens in. The old version measured with a hardcoded seven pixels
 * per character and twenty-five pixel rows -- figures that were correct at
 * exactly one zoom nobody was ever at -- and it compared positions at the node
 * centre while drawing the labels below the node, so it was testing the wrong
 * points with the wrong sizes and let 188 pairs overlap at a hundred genes.
 *
 *   1. A name may not touch another name.
 *   2. There is a budget, and the best-connected genes spend it.
 *
 * Rule 2 matters as much as rule 1: a canvas where every name that happens to
 * find a gap gets drawn is a word search, even when nothing technically
 * collides.
 */

type Rect = { x1: number; x2: number; y1: number; y2: number };

function labelRect(node: NodeSingular, text: string): Rect {
  const fontPx = parseFloat(String(node.renderedStyle("font-size"))) || 10;
  // 0.58em is close enough to the mean advance width of the UI face for a
  // collision test; being a little generous is the safe direction.
  const width = Math.max(fontPx * 2, text.length * fontPx * 0.58);
  const height = fontPx * 1.55;
  const position = node.renderedPosition();
  const margin = Math.abs(
    parseFloat(String(node.renderedStyle("text-margin-y"))) || 0,
  );
  // The label sits below the disc, so its centre is a node-radius plus the
  // margin plus half a line below the node's own centre.
  const centreY =
    position.y + node.renderedHeight() / 2 + margin + height / 2;
  return {
    x1: position.x - width / 2,
    x2: position.x + width / 2,
    y1: centreY - height / 2,
    y2: centreY + height / 2,
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x1 < b.x2 + 3 && b.x1 < a.x2 + 3 && a.y1 < b.y2 + 2 && b.y1 < a.y2 + 2;

export function applyLabelBudget(cy: Core) {
  if (cy.destroyed()) return;
  const nodes = cy.nodes();
  const budget = labelBudget(nodes.length);
  const width = cy.width();
  const height = cy.height();

  // Anything the reader has asked about keeps its name whatever the budget
  // says; then the rest compete, best connected first.
  const ordered = nodes.toArray().sort((a, b) => {
    const priority = (n: NodeSingular) =>
      n.selected() || n.hasClass("traced") || n.hasClass("traced-neighbour")
        ? 1
        : 0;
    return (
      priority(b) - priority(a) ||
      (Number(b.data("degree")) || 0) - (Number(a.data("degree")) || 0)
    );
  });

  const taken: Rect[] = [];
  cy.batch(() => {
    ordered.forEach((node) => {
      const text = String(node.data("fullLabel") ?? "");
      const position = node.renderedPosition();
      const onScreen =
        position.x > -40 &&
        position.x < width + 40 &&
        position.y > -40 &&
        position.y < height + 40;
      const priority =
        node.selected() ||
        node.hasClass("traced") ||
        node.hasClass("traced-neighbour");

      let show = false;
      if (text) {
        if (priority) show = true;
        else if (onScreen && taken.length < budget) {
          const rect = labelRect(node, text);
          show = !taken.some((other) => overlaps(rect, other));
        }
      }

      if (show) taken.push(labelRect(node, text));
      const next = show ? text : "";
      if (node.data("label") !== next) node.data("label", next);
    });
  });
}
