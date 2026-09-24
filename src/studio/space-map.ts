import { clamp, lerp } from "@/studio/math";
import type { Vec3 } from "@/studio/math";
import type { InteractionSpace, NormPoint } from "@/studio/types";

const SPAN_NEAR = 0.035;
const SPAN_RANGE = 0.16;

export function palmSpan(image: NormPoint[]): number {
  const wrist = image[0];
  const middle = image[9];
  if (!wrist || !middle) return SPAN_NEAR;
  return Math.hypot(wrist.x - middle.x, wrist.y - middle.y);
}

/** Image wrist + apparent size → a point inside the interaction volume. */
export function mapWrist(image: NormPoint, span: number, space: InteractionSpace): Vec3 {
  const closeness = closenessFromSpan(span);
  const back = space.offsetZ - space.depth * 0.5;
  const front = space.offsetZ + space.depth * 0.5;
  const z = lerp(back, front, closeness);
  return [(image.x - 0.5) * space.width, (0.55 - image.y) * space.height, z];
}

export function wristToImage(wrist: Vec3, space: InteractionSpace): { x: number; y: number } {
  return {
    x: wrist[0] / space.width + 0.5,
    y: 0.55 - wrist[1] / space.height,
  };
}

export function closenessFromSpan(span: number): number {
  return clamp((span - SPAN_NEAR) / SPAN_RANGE, 0, 1);
}

/** Inverse of mapWrist's depth term, so the demo can place a hand at a chosen Z. */
export function spanForDepth(z: number, space: InteractionSpace): number {
  const back = space.offsetZ - space.depth * 0.5;
  const front = space.offsetZ + space.depth * 0.5;
  const closeness = clamp((z - back) / (front - back || 1), 0, 1);
  return SPAN_NEAR + closeness * SPAN_RANGE;
}

/**
 * Metric finger shape (world, wrist-relative) placed on the image anchor.
 * Callers pass Y-up world landmarks.
 */
export function mapHand(
  image: NormPoint[],
  world: Vec3[],
  space: InteractionSpace,
  handScale: number,
  span = palmSpan(image),
): Vec3[] {
  const anchor = mapWrist(image[0] ?? { x: 0.5, y: 0.5, z: 0 }, span, space);
  const origin = world[0] ?? [0, 0, 0];
  return world.map((point) => [
    anchor[0] + (point[0] - origin[0]) * handScale,
    anchor[1] + (point[1] - origin[1]) * handScale,
    anchor[2] + (point[2] - origin[2]) * handScale,
  ]);
}
