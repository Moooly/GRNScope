/** SVG sizing, style inlining, and legends for network figure exports. */

const CIRCOS_EXPORT_STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
];
const WEBSITE_EXPORT_FONT_FAMILY = "Arial, Helvetica, sans-serif";
const NETWORK_EXPORT_LEGEND_HEIGHT = 92;

export function getSvgExportSize(svgElement: SVGSVGElement) {
  const viewBox = svgElement.getAttribute("viewBox");
  const viewBoxValues = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value));

  const viewBoxWidth =
    viewBoxValues && viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[2])
      ? viewBoxValues[2]
      : 0;
  const viewBoxHeight =
    viewBoxValues && viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[3])
      ? viewBoxValues[3]
      : 0;

  const fallbackWidth = svgElement.viewBox.baseVal.width || svgElement.clientWidth || 780;
  const fallbackHeight = svgElement.viewBox.baseVal.height || svgElement.clientHeight || 780;
  const width = viewBoxWidth > 0 ? viewBoxWidth : fallbackWidth;
  const height = viewBoxHeight > 0 ? viewBoxHeight : fallbackHeight;

  return {
    width,
    height,
    viewBox: viewBox ?? `0 0 ${width} ${height}`,
  };
}

export function inlineSvgComputedStyles(sourceSvg: SVGSVGElement, clonedSvg: SVGSVGElement) {
  const sourceElements = [
    sourceSvg,
    ...Array.from(sourceSvg.querySelectorAll<SVGElement>("*")),
  ];
  const clonedElements = [
    clonedSvg,
    ...Array.from(clonedSvg.querySelectorAll<SVGElement>("*")),
  ];

  sourceElements.forEach((sourceElement, index) => {
    const clonedElement = clonedElements[index];
    if (!clonedElement) return;

    const computedStyle = window.getComputedStyle(sourceElement);
    const inlineStyle = CIRCOS_EXPORT_STYLE_PROPERTIES
      .map((property) => {
        const value = computedStyle.getPropertyValue(property);
        return value ? `${property}:${value}` : "";
      })
      .filter(Boolean)
      .join(";");

    if (inlineStyle) {
      clonedElement.setAttribute("style", inlineStyle);
    }
    clonedElement.removeAttribute("class");
  });
}

function appendSvgElement(
  parent: Element,
  tagName: string,
  attributes: Record<string, string | number>,
  text?: string,
) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });
  if (text !== undefined) element.textContent = text;
  parent.appendChild(element);
  return element;
}

export function appendNetworkExportLegend(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
  variant: "network" | "circos",
) {
  const legendTop = height;
  const legendBottom = height + NETWORK_EXPORT_LEGEND_HEIGHT;
  svgElement.style.fontFamily = WEBSITE_EXPORT_FONT_FAMILY;
  svgElement.setAttribute("viewBox", `0 0 ${width} ${legendBottom}`);
  svgElement.setAttribute("width", String(width));
  svgElement.setAttribute("height", String(legendBottom));

  const legend = appendSvgElement(svgElement, "g", {
    "aria-label": "Network legend",
    "font-family": WEBSITE_EXPORT_FONT_FAMILY,
  });
  appendSvgElement(legend, "rect", {
    x: 0,
    y: legendTop,
    width,
    height: NETWORK_EXPORT_LEGEND_HEIGHT,
    fill: "#f8fafc",
  });
  appendSvgElement(legend, "line", {
    x1: 0,
    x2: width,
    y1: legendTop,
    y2: legendTop,
    stroke: "#dbe4ee",
  });
  appendSvgElement(
    legend,
    "text",
    {
      x: 24,
      y: legendTop + 24,
      fill: "#475569",
      "font-size": 12,
      "font-weight": 700,
    },
    "Legend",
  );

  const firstRowY = legendTop + 45;
  const secondRowY = legendTop + 72;
  const columnWidth = Math.max(150, (width - 48) / 3);
  const addText = (x: number, y: number, label: string) =>
    appendSvgElement(
      legend,
      "text",
      {
        x,
        y,
        fill: "#475569",
        "font-size": 11,
        "font-weight": 600,
      },
      label,
    );

  const addLineMeaning = (
    column: number,
    y: number,
    label: string,
    head: "arrow" | "tee" | "none",
    color = "#64748b",
    dashed = false,
  ) => {
    const x = 24 + column * columnWidth;
    appendSvgElement(legend, "line", {
      x1: x,
      x2: x + 34,
      y1: y - 4,
      y2: y - 4,
      stroke: color,
      "stroke-width": 2.5,
      "stroke-linecap": "round",
      ...(dashed ? { "stroke-dasharray": "6 5" } : {}),
    });
    if (head === "arrow") {
      appendSvgElement(legend, "path", {
        d: `M ${x + 28} ${y - 10} L ${x + 38} ${y - 4} L ${x + 28} ${y + 2} Z`,
        fill: color,
      });
    } else if (head === "tee") {
      appendSvgElement(legend, "line", {
        x1: x + 35,
        x2: x + 35,
        y1: y - 11,
        y2: y + 3,
        stroke: color,
        "stroke-width": 3,
        "stroke-linecap": "round",
      });
    }
    addText(x + 47, y, label);
  };

  if (variant === "circos") {
    addLineMeaning(0, firstRowY, "Source chromosome", "none", "#4f7fb8");
    addLineMeaning(1, firstRowY, "Activation target", "arrow", "#64748b");
    addLineMeaning(2, firstRowY, "Repression target", "tee", "#64748b");
    const x = 24;
    appendSvgElement(legend, "line", {
      x1: x,
      x2: x + 38,
      y1: secondRowY - 4,
      y2: secondRowY - 4,
      stroke: "#64748b",
      "stroke-width": 7,
      "stroke-linecap": "round",
      opacity: 0.78,
    });
    addText(
      x + 48,
      secondRowY,
      "Overview width = regulation count · opacity = evidence",
    );
  } else {
    addLineMeaning(0, firstRowY, "Activation", "arrow", "#168f98");
    addLineMeaning(1, firstRowY, "Repression", "tee", "#d66c4d");
    addLineMeaning(2, firstRowY, "Uncertain regulation", "none", "#8290a3", true);

    const firstX = 24;
    const tfCenterX = firstX + 9;
    const tfCenterY = secondRowY - 5;
    appendSvgElement(legend, "polygon", {
      points: `${tfCenterX},${tfCenterY - 10} ${tfCenterX + 10},${tfCenterY} ${tfCenterX},${tfCenterY + 10} ${tfCenterX - 10},${tfCenterY}`,
      fill: "#5c83d8",
      stroke: "#ffffff",
      "stroke-width": 1.5,
    });
    addText(firstX + 30, secondRowY, "Transcription factor");

    const secondX = 24 + columnWidth;
    appendSvgElement(legend, "circle", {
      cx: secondX + 8,
      cy: secondRowY - 5,
      r: 9,
      fill: "#5c83d8",
      stroke: "#334155",
      "stroke-width": 1.5,
    });
    addText(secondX + 27, secondRowY, "Other gene");

    const thirdX = 24 + columnWidth * 2;
    appendSvgElement(legend, "line", {
      x1: thirdX,
      x2: thirdX + 38,
      y1: secondRowY - 5,
      y2: secondRowY - 5,
      stroke: "#64748b",
      "stroke-width": 5,
      "stroke-linecap": "round",
    });
    addText(thirdX + 48, secondRowY, "Width = evidence · opacity = confidence");
  }

  return {
    width,
    height: legendBottom,
  };
}
