import { vdist, vnorm, vsub } from "@/studio/math";
import type { Vec3 } from "@/studio/math";

export interface GestureParams {
  pinchThreshold: number;
  imagePinch?: number;
  wasPinch?: boolean;
}

export interface GestureReading {
  pinch: boolean;
  pinchDistance: number;
  pointing: boolean;
  pointOrigin: Vec3;
  pointDirection: Vec3;
  pinchPoint: Vec3;
}

function extension(points: Vec3[], tip: number, mcp: number): number {
  const wrist = points[0];
  const mcpD = vdist(points[mcp] ?? wrist, wrist);
  if (mcpD < 1e-5) return 0;
  return vdist(points[tip] ?? wrist, wrist) / mcpD;
}

/**
 * Pinch and index-point. New gestures register beside these detectors
 * instead of rewriting the interaction loop.
 */
export function readGestures(points: Vec3[], params: GestureParams): GestureReading {
  const thumb = points[4] ?? points[0] ?? [0, 0, 0];
  const indexTip = points[8] ?? points[0] ?? [0, 0, 0];
  const pinchDistance = vdist(thumb, indexTip);
  const imagePinch = params.imagePinch ?? 1;
  const close = pinchDistance < params.pinchThreshold || imagePinch < 0.085;
  const still = pinchDistance < params.pinchThreshold * 1.8 || imagePinch < 0.14;
  const pinch = params.wasPinch ? still : close;
  const pinchPoint: Vec3 = [
    (thumb[0] + indexTip[0]) * 0.5,
    (thumb[1] + indexTip[1]) * 0.5,
    (thumb[2] + indexTip[2]) * 0.5,
  ];

  const indexExt = extension(points, 8, 5);
  const middleExt = extension(points, 12, 9);
  const ringExt = extension(points, 16, 13);
  const pinkyExt = extension(points, 20, 17);
  const curled = [middleExt, ringExt, pinkyExt].filter((v) => v < 1.12).length;
  const pointing = !pinch && indexExt > 1.12 && curled >= 2;

  const pip = points[6] ?? indexTip;
  let dir = vsub(indexTip, pip);
  if (Math.hypot(dir[0], dir[1], dir[2]) < 1e-4) {
    dir = vsub(indexTip, points[5] ?? indexTip);
  }

  return {
    pinch,
    pinchDistance,
    pointing,
    pointOrigin: indexTip,
    pointDirection: vnorm(dir),
    pinchPoint,
  };
}
