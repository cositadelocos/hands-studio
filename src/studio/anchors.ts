import { basisQuat, vcross, vnorm, vsub } from "@/studio/math";
import type { Quat, Vec3 } from "@/studio/math";
import { LANDMARK_NAMES, type Anchor, type Side, type StudioHand } from "@/studio/types";

/**
 * Hand Landmarker landmarks only. A future mesh binds to these anchors,
 * never to MediaPipe directly. Wrist is landmark 0 of the hand model.
 */
const SIDE_POINT: Record<string, (side: Side) => string> = {
  wrist: (side) => (side === "left" ? "Muñeca izquierda" : "Muñeca derecha"),
  thumb_tip: (side) => (side === "left" ? "Pulgar izquierdo" : "Pulgar derecho"),
  index_tip: (side) => (side === "left" ? "Índice izquierdo" : "Índice derecho"),
};

export function palmRotation(points: Vec3[]): Quat | null {
  const wrist = points[0];
  const indexMcp = points[5];
  const middleMcp = points[9];
  const pinkyMcp = points[17];
  if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) return null;
  const y = vnorm(vsub(middleMcp, wrist));
  const rawNormal = vcross(vsub(indexMcp, wrist), vsub(pinkyMcp, wrist));
  if (Math.hypot(rawNormal[0], rawNormal[1], rawNormal[2]) < 1e-6) return null;
  const z = vnorm(rawNormal);
  const x = vnorm(vcross(y, z));
  const zOrtho = vnorm(vcross(x, y));
  return basisQuat(x, y, zOrtho);
}

export function buildAnchors(hands: Partial<Record<Side, StudioHand>>): Anchor[] {
  const anchors: Anchor[] = [];
  for (const side of ["left", "right"] as const) {
    const hand = hands[side];
    const rotation = hand ? palmRotation(hand.points) : null;
    LANDMARK_NAMES.forEach((name, index) => {
      const point = hand?.points[index] ?? null;
      anchors.push({
        id: `${side}.hand.${name}`,
        label: SIDE_POINT[name]?.(side) ?? name,
        side,
        group: "hand",
        position: point,
        rotation: index === 0 ? rotation : null,
        confidence: hand?.confidence ?? 0,
        source: point ? "hand" : "missing",
      });
    });
  }
  return anchors;
}

export const KEY_ANCHOR_IDS = [
  "left.hand.wrist",
  "left.hand.thumb_tip",
  "left.hand.index_tip",
  "right.hand.wrist",
  "right.hand.thumb_tip",
  "right.hand.index_tip",
] as const;
