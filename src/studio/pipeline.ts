import { vlerp } from "@/studio/math";
import type { Vec3 } from "@/studio/math";
import { assignHands, createWristMemory, type WristMemory } from "@/studio/assign-hands";
import { buildAnchors } from "@/studio/anchors";
import { readGestures } from "@/studio/gestures";
import { mapHand } from "@/studio/space-map";
import type { Anchor, Side, StudioHand, TrackSettings, TrackingFrame } from "@/studio/types";

export interface SmoothMemory {
  points: Partial<Record<Side, Vec3[]>>;
  lost: Record<Side, number>;
}

export interface PipelineMemory {
  wrists: WristMemory;
  smooth: SmoothMemory;
}

export function createPipelineMemory(): PipelineMemory {
  return {
    wrists: createWristMemory(),
    smooth: { points: {}, lost: { left: 0, right: 0 } },
  };
}

function smoothPoints(previous: Vec3[] | undefined, next: Vec3[], alpha: number): Vec3[] {
  if (!previous || previous.length !== next.length) return next.map((point) => [...point] as Vec3);
  return next.map((point, index) => vlerp(previous[index] ?? point, point, alpha));
}

/**
 * Tracking frame → stable hands in studio space → anchors.
 * Interaction and the viewer consume this. They do not read MediaPipe.
 */
export function advanceTracking(
  frame: TrackingFrame,
  memory: PipelineMemory,
  settings: TrackSettings,
): { hands: Partial<Record<Side, StudioHand>>; anchors: Anchor[] } {
  const assigned = assignHands(frame.hands, memory.wrists);
  const hands: Partial<Record<Side, StudioHand>> = {};

  for (const side of ["left", "right"] as const) {
    const raw = assigned[side];
    if (!raw || raw.world.length < 21 || raw.image.length < 21) {
      memory.smooth.lost[side] += 1;
      if (memory.smooth.lost[side] > 6) delete memory.smooth.points[side];
      continue;
    }
    const mapped = mapHand(raw.image, raw.world, settings.space, settings.handScale);
    const alpha = memory.smooth.lost[side] > 4 ? 1 : settings.smoothing;
    const points = smoothPoints(memory.smooth.points[side], mapped, alpha);
    memory.smooth.points[side] = points;
    memory.smooth.lost[side] = 0;
    const gesture = readGestures(points, { pinchThreshold: settings.pinchThreshold });
    hands[side] = {
      side,
      confidence: raw.score,
      points,
      image: raw.image,
      ...gesture,
    };
  }

  return { hands, anchors: buildAnchors(hands) };
}
