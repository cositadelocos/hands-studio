import { rotX, vadd, vmul, vnorm, vsub } from "@/studio/math";
import type { Vec3 } from "@/studio/math";
import { spanForDepth, wristToImage } from "@/studio/space-map";
import { DEFAULT_SPACE, type InteractionSpace, type NormPoint, type RawHand, type Side, type TrackingFrame } from "@/studio/types";

type Curls = { thumb: number; index: number; middle: number; ring: number; pinky: number };

const OPEN: Curls = { thumb: 0.15, index: 0.08, middle: 0.08, ring: 0.1, pinky: 0.16 };
const POINT: Curls = { thumb: 0.35, index: 0.02, middle: 0.86, ring: 0.9, pinky: 0.92 };
const PINCH: Curls = { thumb: 0.78, index: 0.74, middle: 0.42, ring: 0.48, pinky: 0.55 };

function lerpCurl(a: Curls, b: Curls, t: number): Curls {
  const k = Math.min(1, Math.max(0, t));
  return {
    thumb: a.thumb + (b.thumb - a.thumb) * k,
    index: a.index + (b.index - a.index) * k,
    middle: a.middle + (b.middle - a.middle) * k,
    ring: a.ring + (b.ring - a.ring) * k,
    pinky: a.pinky + (b.pinky - a.pinky) * k,
  };
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function poseLocal(side: Side, curl: Curls): Vec3[] {
  const sx = side === "right" ? 1 : -1;
  const points: Vec3[] = Array.from({ length: 21 }, () => [0, 0, 0]);
  const curlAxis: Vec3 = [sx, 0, 0];
  const fingers: { curl: number; mcp: Vec3; dir: Vec3; indices: number[] }[] = [
    { curl: curl.index, mcp: [sx * 0.033, 0.086, 0.004], dir: vnorm([sx * 0.05, 1, 0]), indices: [5, 6, 7, 8] },
    { curl: curl.middle, mcp: [sx * 0.01, 0.092, 0.002], dir: vnorm([sx * 0.01, 1, 0]), indices: [9, 10, 11, 12] },
    { curl: curl.ring, mcp: [sx * -0.014, 0.086, 0.002], dir: vnorm([sx * -0.04, 1, 0]), indices: [13, 14, 15, 16] },
    { curl: curl.pinky, mcp: [sx * -0.036, 0.072, 0.004], dir: vnorm([sx * -0.1, 1, 0]), indices: [17, 18, 19, 20] },
  ];
  const lengths = [0.032, 0.022, 0.018];
  for (const finger of fingers) {
    let pos = finger.mcp;
    let dir = finger.dir;
    points[finger.indices[0]!] = pos;
    const angles = [-1.2 * finger.curl, -1.55 * finger.curl, -1.2 * finger.curl];
    for (let i = 0; i < 3; i += 1) {
      dir = vnorm(rotate(dir, curlAxis, angles[i] ?? 0));
      pos = vadd(pos, vmul(dir, lengths[i] ?? 0));
      points[finger.indices[i + 1]!] = pos;
    }
  }
  points[1] = [sx * 0.026, 0.03, 0.014];
  let tdir = vnorm([sx * 0.9, 0.42, 0.2]);
  let tpos = points[1];
  const thumbLengths = [0.034, 0.026, 0.022];
  const thumbAngles = [-0.35 * curl.thumb, -1.05 * curl.thumb, -0.85 * curl.thumb];
  const thumbAxis: Vec3 = [0, 0, sx];
  for (let i = 0; i < 3; i += 1) {
    tdir = vnorm(rotate(tdir, thumbAxis, thumbAngles[i] ?? 0));
    tpos = vadd(tpos, vmul(tdir, thumbLengths[i] ?? 0));
    points[i + 2] = tpos;
  }
  const pitched = points.map((point) => rotX(point, -0.95));
  if (curl.thumb > 0.65 && curl.index > 0.6) {
    const mid: Vec3 = [
      ((pitched[4]?.[0] ?? 0) + (pitched[8]?.[0] ?? 0)) * 0.5,
      ((pitched[4]?.[1] ?? 0) + (pitched[8]?.[1] ?? 0)) * 0.5,
      ((pitched[4]?.[2] ?? 0) + (pitched[8]?.[2] ?? 0)) * 0.5,
    ];
    const gap = 0.016;
    pitched[4] = vadd(mid, [sx * gap, gap * 0.15, 0]);
    pitched[8] = vadd(mid, [sx * -gap * 0.2, -gap * 0.1, 0.004]);
  }
  return pitched;
}

function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = vnorm(axis);
  const cross: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ];
}

interface Pose {
  wrist: Vec3;
  curl: Curls;
}

function demoPoses(time: number, cube: Vec3): { left: Pose; right: Pose } {
  const u = ((time % 14) + 14) % 14;
  const leftPresent: Pose = { wrist: [-0.24, 0.3, 0.12], curl: OPEN };
  const rightPresent: Pose = { wrist: [0.26, 0.32, 0.1], curl: POINT };

  let left = leftPresent;
  if (u >= 2.2 && u < 4) {
    const k = smooth((u - 2.2) / 1.6);
    left = {
      wrist: mixWrist(leftPresent.wrist, reachWrist("left", OPEN, cube), k),
      curl: OPEN,
    };
  } else if (u >= 4 && u < 4.7) {
    const k = smooth((u - 4) / 0.7);
    left = { wrist: reachWrist("left", PINCH, cube), curl: lerpCurl(OPEN, PINCH, k) };
  } else if (u >= 4.7 && u < 7.8) {
    const k = smooth((u - 4.7) / 2.8);
    left = {
      wrist: mixWrist(reachWrist("left", PINCH, cube), reachWrist("left", PINCH, vadd(cube, [0.22, 0, 0.02])), k),
      curl: PINCH,
    };
  } else if (u >= 7.8 && u < 9.2) {
    const k = smooth((u - 7.8) / 1.2);
    left = {
      wrist: mixWrist(reachWrist("left", PINCH, vadd(cube, [0.22, 0, 0.02])), leftPresent.wrist, k),
      curl: lerpCurl(PINCH, OPEN, k),
    };
  }

  let right = rightPresent;
  if (u >= 9 && u < 11.5) {
    const k = smooth((u - 9) / 1.2);
    right = { wrist: [0.22, 0.34 + Math.sin(time * 2.2) * 0.02, 0.12], curl: lerpCurl(POINT, OPEN, k) };
  } else if (u >= 11.5) {
    right = { wrist: rightPresent.wrist, curl: lerpCurl(OPEN, POINT, smooth((u - 11.5) / 1.4)) };
  } else {
    right = {
      wrist: [rightPresent.wrist[0], rightPresent.wrist[1] + Math.sin(time * 1.4) * 0.012, rightPresent.wrist[2]],
      curl: POINT,
    };
  }

  left = {
    wrist: [left.wrist[0], left.wrist[1] + Math.sin(time * 1.6) * 0.008, left.wrist[2]],
    curl: left.curl,
  };
  return { left, right };
}

function mixWrist(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function reachWrist(side: Side, curl: Curls, target: Vec3): Vec3 {
  const local = poseLocal(side, curl);
  const mid = vmul(vadd(local[4] ?? [0, 0, 0], local[8] ?? [0, 0, 0]), 0.5);
  return vsub(target, mid);
}

function toRaw(side: Side, pose: Pose, space: InteractionSpace): RawHand {
  const world = poseLocal(side, pose.curl);
  const imgWrist = wristToImage(pose.wrist, space);
  const middle = world[9] ?? [0, 0.09, 0];
  const flat = Math.hypot(middle[0], middle[1]) || 0.05;
  const k = spanForDepth(pose.wrist[2], space) / flat;
  const image: NormPoint[] = world.map((point) => ({
    x: imgWrist.x + point[0] * k,
    y: imgWrist.y - point[1] * k,
    z: point[2],
    visibility: 0.99,
  }));
  return { handedness: side, score: 0.99, image, world };
}

export function sampleDemo(timestamp: number, space: InteractionSpace = DEFAULT_SPACE, cube: Vec3 = [-0.18, 0.06, 0.02]): TrackingFrame {
  const poses = demoPoses(timestamp / 1000, cube);
  return {
    timestamp,
    latencyMs: 0,
    source: "demo",
    hands: [toRaw("left", poses.left, space), toRaw("right", poses.right, space)],
  };
}
