export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>,
) {
  const content = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  downloadBlob(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
    filename,
  );
}

function serializedSvg(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = clone.viewBox.baseVal;
  const width =
    viewBox?.width || svg.getBoundingClientRect().width || svg.clientWidth || 1200;
  const height =
    viewBox?.height || svg.getBoundingClientRect().height || svg.clientHeight || 800;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.querySelector("rect[data-export-background]")) {
    const background = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    background.setAttribute("data-export-background", "true");
    background.setAttribute("x", "0");
    background.setAttribute("y", "0");
    background.setAttribute("width", "100%");
    background.setAttribute("height", "100%");
    background.setAttribute("fill", "white");
    clone.insertBefore(background, clone.firstChild);
  }
  return {
    markup: new XMLSerializer().serializeToString(clone),
    width,
    height,
  };
}

export function downloadSvg(svg: SVGSVGElement, filename: string) {
  const { markup } = serializedSvg(svg);
  downloadBlob(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
    filename,
  );
}

export async function downloadSvgPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2,
) {
  const { markup, width, height } = serializedSvg(svg);
  const sourceUrl = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The image could not be rendered."));
      image.src = sourceUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be prepared.");
    context.scale(scale, scale);
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("PNG export failed.")),
        "image/png",
      );
    });
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
