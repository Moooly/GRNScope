type Point = { x: number; y: number };
type Path = { points: Point[] };

/** A rigid display rotation shared by all cells and lineages. No refitting. */
export function trajectoryDisplayOrientation(paths: Path[]) {
  const usable = paths.filter(path => path.points.length > 1 && path.points.every(
    point => Number.isFinite(point.x) && Number.isFinite(point.y),
  ));
  if (!usable.length) return { rotated: false, project: (point: Point): Point => ({ ...point }) };
  const mean = (points: Point[]): Point => ({
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  });
  const root = mean(usable.map(path => path.points[0]));
  const tips = usable.map(path => path.points[path.points.length - 1]);
  let late = mean(tips);
  // Symmetric branches can cancel. Choose a tip deterministically in that case.
  if (Math.hypot(late.x - root.x, late.y - root.y) < 1e-12) {
    late = [...tips].sort((a, b) =>
      Math.hypot(b.x - root.x, b.y - root.y) - Math.hypot(a.x - root.x, a.y - root.y)
      || a.x - b.x || a.y - b.y,
    )[0];
  }
  const dx = late.x - root.x;
  const dy = late.y - root.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) return { rotated: false, project: (point: Point): Point => ({ ...point }) };
  const cosine = dx / length;
  const sine = dy / length;
  return {
    rotated: Math.abs(cosine - 1) > 1e-12 || Math.abs(sine) > 1e-12,
    project: (point: Point): Point => ({
      x: (point.x - root.x) * cosine + (point.y - root.y) * sine,
      y: -(point.x - root.x) * sine + (point.y - root.y) * cosine,
    }),
  };
}
