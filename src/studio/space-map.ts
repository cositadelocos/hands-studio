import { clamp, lerp } from "@/studio/math";
import type { Vec3 } from "@/studio/math";
import type { InteractionSpace, NormPoint } from "@/studio/types";

const SPAN_NEAR = 0.035;
const SPAN_RANGE = 0.16;
/** Hands stay in front of the camera, in a band you can see head-on. */
const HAND_HALF_X = 0.38;
const HAND_Y_BIAS = 0.55;
const HAND_Y_SPAN = 0.4;
const HAND_Z_NEAR = -0.48;
const HAND_Z_FAR = -0.7;

export function palmSpan(image: NormPoint[]): number {
  const wrist = image[0];
  const middle = image[9];
  if (!wrist || !middle) return SPAN_NEAR;
  return Math.hypot(wrist.x - middle.x, wrist.y - middle.y);
}

/** Image wrist + apparent size → a point in front of the viewpoint. */
export function mapWrist(image: NormPoint, span: number, _space: InteractionSpace): Vec3 {
  const closeness = closenessFromSpan(span);
  return [
    (image.x - 0.5) * HAND_HALF_X * 2,
    (HAND_Y_BIAS - image.y) * HAND_Y_SPAN,
    lerp(HAND_Z_FAR, HAND_Z_NEAR, closeness),
  ];
}

export function wristToImage(wrist: Vec3, _space: InteractionSpace): { x: number; y: number } {
  return {
    x: wrist[0] / (HAND_HALF_X * 2) + 0.5,
    y: HAND_Y_BIAS - wrist[1] / HAND_Y_SPAN,
  };
}

export function closenessFromSpan(span: number): number {
  return clamp((span - SPAN_NEAR) / SPAN_RANGE, 0, 1);
}

/** Inverse of mapWrist's depth term, so the demo can place a hand at a chosen Z. */
export function spanForDepth(z: number, _space: InteractionSpace): number {
  const span = HAND_Z_NEAR - HAND_Z_FAR || 1;
  const closeness = clamp((z - HAND_Z_FAR) / span, 0, 1);
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
