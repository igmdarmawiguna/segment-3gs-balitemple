import { projectWorldPoint } from "./capture";
import type { SplatGrid } from "./splatIndex";
import type { Aabb, CameraPose, DecodedMask, Vec3 } from "./types";

export interface LiftDeps { grid: SplatGrid }
export interface LiftOptions {
  /** World-space thickness behind the nearest projected surface. */
  depthBand?: number;
  /** Robust scene span, independent of stray Gaussians. */
  sceneScale?: number;
  /** Fraction of scene span; smaller values select thinner surfaces. */
  depthRatio?: number;
  /** Inward mask margin in capture pixels. Zero preserves fine edges. */
  edgeMargin?: number;
}
export interface LiftResult {
  indices: Uint32Array;
  centroid: Vec3;
  aabb: Aabb;
  score: number;
}

interface Projection {
  centers: Float32Array;
  pixel: Int32Array;
  depth: Float32Array;
  front: Float32Array;
}
// Reuse projection/depth buffers for every instance and concept in one captured view.
const projections = new WeakMap<CameraPose, Projection>();

function projectScene(grid: SplatGrid, pose: CameraPose): Projection {
  const cached = projections.get(pose);
  if (cached?.centers === grid.centers) return cached;
  const count = grid.centers.length / 3;
  const pixel = new Int32Array(count).fill(-1);
  const depth = new Float32Array(count);
  const front = new Float32Array(pose.width * pose.height).fill(Infinity);
  for (let i = 0; i < count; i++) {
    const q = projectWorldPoint(pose, grid.centers[i * 3]!, grid.centers[i * 3 + 1]!, grid.centers[i * 3 + 2]!);
    if (!Number.isFinite(q.depth) || q.depth <= 0 || !Number.isFinite(q.px) || !Number.isFinite(q.py)) continue;
    if (q.px < 0 || q.py < 0 || q.px >= pose.width || q.py >= pose.height) continue;
    const at = Math.floor(q.py) * pose.width + Math.floor(q.px);
    pixel[i] = at;
    depth[i] = q.depth;
    front[at] = Math.min(front[at]!, q.depth);
  }
  const result = { centers: grid.centers, pixel, depth, front };
  projections.set(pose, result);
  return result;
}

export function erodeMask(mask: DecodedMask, radius: number): Uint8Array {
  const r = Math.max(0, Math.min(4, Math.floor(radius)));
  if (!r) return mask.data;
  const { width: w, height: h, data } = mask;
  // Summed-area table: square erosion in O(width * height), independent of radius.
  const stride = w + 1;
  const sum = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x]! > 0 ? 1 : 0;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  const out = new Uint8Array(w * h);
  const area = (2 * r + 1) ** 2;
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const a = (y - r) * stride, b = (y + r + 1) * stride;
      const n = sum[b + x + r + 1]! - sum[a + x + r + 1]! - sum[b + x - r]! + sum[a + x - r]!;
      if (n === area) out[y * w + x] = 255;
    }
  }
  return out;
}

export function liftMask(
  deps: LiftDeps, pose: CameraPose, mask: DecodedMask,
  _anchorPixel: { x: number; y: number } | null, options: LiftOptions = {},
): LiftResult | null {
  if (mask.width !== pose.width || mask.height !== pose.height) throw new Error("Mask and captured view dimensions differ");
  const scene = deps.grid.worldBounds;
  const scale = options.sceneScale ?? Math.max(...scene.max.map((v, i) => v - scene.min[i]!));
  const thickness = options.depthBand ?? Math.max(scale * (options.depthRatio ?? 0.005), 1e-7);
  if (!Number.isFinite(thickness) || thickness <= 0) throw new Error("Surface thickness must be positive");
  const data = erodeMask(mask, options.edgeMargin ?? 0);
  const projection = projectScene(deps.grid, pose);
  const selected: number[] = [];
  for (let i = 0; i < projection.pixel.length; i++) {
    const at = projection.pixel[i]!;
    if (at < 0 || !data[at]) continue;
    // Depth is local to each image pixel, so slanted reliefs are preserved while
    // hidden walls/back faces at the same pixel are rejected. This is a center-depth
    // approximation, not an alpha-composited Gaussian depth render.
    if (projection.depth[i]! - projection.front[at]! <= thickness) selected.push(i);
  }
  if (!selected.length) return null;
  const indices = Uint32Array.from(selected);
  return { indices, ...computeBounds(deps.grid.centers, indices), score: mask.score };
}

export function computeBounds(centers: Float32Array, indices: Uint32Array): { centroid: Vec3; aabb: Aabb } {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < indices.length; k += 1) {
    const i = indices[k]!;
    const x = centers[i * 3]!;
    const y = centers[i * 3 + 1]!;
    const z = centers[i * 3 + 2]!;
    sx += x;
    sy += y;
    sz += z;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  const n = indices.length || 1;
  return { centroid: [sx / n, sy / n, sz / n], aabb: { min, max } };
}
