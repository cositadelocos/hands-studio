import type { NormPoint, RawHand, Side } from "@/studio/types";

export interface WristMemory {
  left?: NormPoint;
  right?: NormPoint;
  lost: Record<Side, number>;
}

function dist2(a: NormPoint, b: NormPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Keeps left/right stable across frames. MediaPipe labels can flip;
 * a nearby previous wrist wins over a fresh label.
 */
export function assignHands(
  hands: RawHand[],
  memory: WristMemory,
): Partial<Record<Side, RawHand>> {
  const slots: Partial<Record<Side, RawHand>> = {};
  const used = new Set<number>();

  for (const side of ["left", "right"] as const) {
    const prev = memory[side];
    if (!prev || memory.lost[side] > 8) continue;
    let best = -1;
    let bestD = 0.2;
    hands.forEach((hand, index) => {
      if (used.has(index)) return;
      const d = dist2(hand.image[0] ?? { x: 0, y: 0, z: 0 }, prev);
      if (d < bestD) {
        bestD = d;
        best = index;
      }
    });
    if (best >= 0) {
      slots[side] = hands[best];
      used.add(best);
    }
  }

  hands.forEach((hand, index) => {
    if (used.has(index)) return;
    if (!slots[hand.handedness]) {
      slots[hand.handedness] = hand;
      used.add(index);
    }
  });

  hands.forEach((hand, index) => {
    if (used.has(index)) return;
    const other: Side = hand.handedness === "left" ? "right" : "left";
    if (!slots[other]) {
      slots[other] = hand;
      used.add(index);
    }
  });

  for (const side of ["left", "right"] as const) {
    const hand = slots[side];
    if (hand?.image[0]) {
      memory[side] = hand.image[0];
      memory.lost[side] = 0;
    } else {
      memory.lost[side] += 1;
      if (memory.lost[side] > 8) delete memory[side];
    }
  }

  return slots;
}

export function createWristMemory(): WristMemory {
  return { lost: { left: 0, right: 0 } };
}
