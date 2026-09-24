import { vdist } from "@/studio/math";
import type { Vec3 } from "@/studio/math";
import type { InteractionSpace, SceneObject, Side, StudioHand } from "@/studio/types";

export interface Hold {
  id: string;
  offsetX: number;
  offsetZ: number;
  baseY: number;
  imageY: number;
  span: number;
  last: Vec3;
  miss: number;
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

function pinchImageY(hand: StudioHand): number {
  const thumb = hand.image[4];
  const index = hand.image[8];
  if (!thumb || !index) return 0.5;
  return (thumb.y + index.y) * 0.5;
}
function seenId(
  hit: RayHit | null,
  taken: (id: string) => boolean,
  objects: SceneObject[],
): string | null {
  if (!hit || taken(hit.id)) return null;
  const object = objects.find((item) => item.id === hit.id);
  if (!object?.grabbable || !object.visible) return null;
  return hit.id;
}

function nearestPlanar(
  objects: SceneObject[],
  point: Vec3,
  taken: (id: string) => boolean,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const object of objects) {
    if (!object.grabbable || !object.visible || taken(object.id)) continue;
    const distance = vdist(point, object.position);
    const limit = objectRadius(object) + 0.28;
    if (distance < limit && distance < bestD) {
      bestD = distance;
      best = object.id;
    }
  }
  return best;
}

/**
 * Pinch grabs whatever sits under the hand in the view, front or back.
 * While held, moving toward the lens pulls the object forward; moving away pushes it back.
 */
export function stepInteraction(
  memory: InteractionMemory,
  hands: Partial<Record<Side, StudioHand>>,
  objects: SceneObject[],
  raycast: (origin: Vec3, direction: Vec3) => RayHit | null,
  pickThrough: (point: Vec3) => RayHit | null,
  space: InteractionSpace,
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
    const keep = allowManipulate && objects.some((object) => object.id === hold.id && object.visible);
    if (!keep || !hand) {
      if (!keep) {
        delete holds[side];
        continue;
      }
      hold.miss += 1;
      if (hold.miss > 6) {
        delete holds[side];
        continue;
      }
      moves.push({ id: hold.id, position: hold.last });
      continue;
    }
    if (!hand.pinch) {
      delete holds[side];
      continue;
    }
    hold.miss = 0;
    const position: Vec3 = [
      hand.pinchPoint[0] + hold.offsetX,
      hold.baseY + (hold.imageY - pinchImageY(hand)) * 1.7,
      hand.pinchPoint[2] + hold.offsetZ,
    ];
    hold.last = position;
    moves.push({ id: hold.id, position });
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
    const aimed = pickThrough(hand.pinchPoint);
    if (aimed && !hoveredId) {
      hoveredId = aimed.id;
      hoveredBy = side;
    }
    if (holds[side] || !hand.pinch || !allowManipulate || hand.confidence < 0.2) continue;

    let target = seenId(aimed, taken, objects);
    if (!target && hit) target = seenId(hit, taken, objects);
    if (!target) target = nearestPlanar(objects, hand.pinchPoint, taken);

    if (!target) continue;
    const object = objects.find((item) => item.id === target);
    if (!object) continue;
    holds[side] = {
      id: target,
      offsetX: object.position[0] - hand.pinchPoint[0],
      offsetZ: object.position[2] - hand.pinchPoint[2],
      baseY: object.position[1],
      imageY: pinchImageY(hand),
      span: hand.span,
      last: [object.position[0], object.position[1], object.position[2]],
      miss: 0,
    };
  }

  memory.holds = holds;
  return { holds, moves, hoveredId, hoveredBy, rays };
}
