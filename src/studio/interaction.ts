import { vadd, vdist, vsub } from "@/studio/math";
import type { Vec3 } from "@/studio/math";
import type { SceneObject, Side, StudioHand } from "@/studio/types";

export interface Hold {
  id: string;
  offset: Vec3;
}

export interface InteractionMemory {
  holds: Partial<Record<Side, Hold>>;
}

export interface RayHit {
  id: string;
  point: Vec3;
  distance: number;
}

export interface InteractionResult {
  holds: Partial<Record<Side, Hold>>;
  moves: { id: string; position: Vec3 }[];
  hoveredId: string | null;
  hoveredBy: Side | null;
  rays: Partial<Record<Side, { origin: Vec3; direction: Vec3; hit: RayHit | null }>>;
}

export function createInteractionMemory(): InteractionMemory {
  return { holds: {} };
}

export function objectRadius(object: SceneObject): number {
  const scale = Math.max(object.scale[0], object.scale[1], object.scale[2]);
  if (object.kind === "sphere") return 0.5 * scale + 0.02;
  if (object.kind === "torus") return 0.42 * scale + 0.02;
  if (object.kind === "cylinder") return 0.55 * scale;
  if (object.kind === "model") return 0.18 * Math.max(scale, 0.4) + 0.04;
  return 0.55 * scale;
}

/**
 * Pinch grabs the pointed object, or the nearest one inside a small radius.
 * Releasing the pinch drops it. Each hand can hold one object.
 */
export function stepInteraction(
  memory: InteractionMemory,
  hands: Partial<Record<Side, StudioHand>>,
  objects: SceneObject[],
  raycast: (origin: Vec3, direction: Vec3) => RayHit | null,
  allowManipulate: boolean,
): InteractionResult {
  const holds: Partial<Record<Side, Hold>> = { ...memory.holds };
  const moves: { id: string; position: Vec3 }[] = [];
  const rays: InteractionResult["rays"] = {};
  let hoveredId: string | null = null;
  let hoveredBy: Side | null = null;

  const taken = (id: string, except?: Side) =>
    (["left", "right"] as const).some((side) => side !== except && holds[side]?.id === id);

  for (const side of ["left", "right"] as const) {
    const hand = hands[side];
    const hold = holds[side];
    if (!hold) continue;
    if (!allowManipulate || !hand?.pinch || !objects.some((object) => object.id === hold.id && object.visible)) {
      delete holds[side];
      continue;
    }
    moves.push({ id: hold.id, position: vadd(hand.pinchPoint, hold.offset) });
  }

  for (const side of ["left", "right"] as const) {
    const hand = hands[side];
    if (!hand) continue;
    const hit = hand.pointing ? raycast(hand.pointOrigin, hand.pointDirection) : null;
    if (hand.pointing) rays[side] = { origin: hand.pointOrigin, direction: hand.pointDirection, hit };
    if (hit && !hoveredId) {
      hoveredId = hit.id;
      hoveredBy = side;
    }
    if (holds[side] || !hand.pinch || !allowManipulate || hand.confidence < 0.35) continue;

    let target = hit && !taken(hit.id) ? hit.id : null;
    const targetObject = objects.find((object) => object.id === target);
    if (targetObject && (!targetObject.grabbable || !targetObject.visible)) target = null;

    if (!target) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const object of objects) {
        if (!object.grabbable || !object.visible || taken(object.id)) continue;
        const distance = vdist(hand.pinchPoint, object.position);
        const limit = objectRadius(object) + 0.04;
        if (distance < limit && distance < bestD) {
          bestD = distance;
          best = object.id;
        }
      }
      target = best;
    }

    if (!target) continue;
    const object = objects.find((item) => item.id === target);
    if (!object) continue;
    holds[side] = { id: target, offset: vsub(object.position, hand.pinchPoint) };
  }

  memory.holds = holds;
  return { holds, moves, hoveredId, hoveredBy, rays };
}
