import type { Quat, Vec3 } from "@/studio/math";

export type Side = "left" | "right";
export type TrackingSourceKind = "demo" | "mediapipe";
export type TransformMode = "translate" | "rotate" | "scale";
export type ObjectKind = "box" | "sphere" | "torus" | "cylinder" | "model";
export type AnchorSource = "hand" | "missing";

export interface NormPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** One detected hand, before identity lock and before the studio mapping. */
export interface RawHand {
  handedness: Side;
  score: number;
  image: NormPoint[];
  /** Y-up meters. Index 0 is the wrist. */
  world: Vec3[];
}

export interface TrackingFrame {
  timestamp: number;
  latencyMs: number;
  source: TrackingSourceKind;
  hands: RawHand[];
}

export interface InteractionSpace {
  width: number;
  height: number;
  depth: number;
  offsetZ: number;
}

export interface StudioHand {
  side: Side;
  confidence: number;
  points: Vec3[];
  image: NormPoint[];
  pinch: boolean;
  pinchDistance: number;
  pointing: boolean;
  pointOrigin: Vec3;
  pointDirection: Vec3;
  pinchPoint: Vec3;
  /** Apparent palm size in the image. Larger means the hand is closer to the lens. */
  span: number;
}

export interface Anchor {
  id: string;
  label: string;
  side: Side;
  group: "hand";
  position: Vec3 | null;
  rotation: Quat | null;
  confidence: number;
  source: AnchorSource;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: ObjectKind;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  color: string;
  grabbable: boolean;
  selectable: boolean;
}

export interface TrackSettings {
  space: InteractionSpace;
  handScale: number;
  pinchThreshold: number;
  smoothing: number;
  invertHands: boolean;
}

export const LANDMARK_NAMES = [
  "wrist",
  "thumb_cmc",
  "thumb_mcp",
  "thumb_ip",
  "thumb_tip",
  "index_mcp",
  "index_pip",
  "index_dip",
  "index_tip",
  "middle_mcp",
  "middle_pip",
  "middle_dip",
  "middle_tip",
  "ring_mcp",
  "ring_pip",
  "ring_dip",
  "ring_tip",
  "pinky_mcp",
  "pinky_pip",
  "pinky_dip",
  "pinky_tip",
] as const;

export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

export const DEFAULT_SPACE: InteractionSpace = {
  width: 2.8,
  height: 1.7,
  depth: 2.2,
  offsetZ: 0,
};

/** Eye height at the middle of the table. */
export const STUDIO_EYE = 1.25;

export const TABLE_TOP = 0.74;
export const TABLE_WIDTH = 2.4;
export const TABLE_DEPTH = 2;

export interface PanoramaSettings {
  name: string;
  position: Vec3;
  scale: number;
  rotation: number;
}

export const OBJECT_COLORS = ["#e59a4a", "#3dbeb6", "#e07a5f"] as const;
