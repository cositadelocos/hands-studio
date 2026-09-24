import { create } from "zustand";
import type { Vec3 } from "@/studio/math";
import {
  DEFAULT_SPACE,
  OBJECT_COLORS,
  TABLE_TOP,
  TABLE_Z,
  type InteractionSpace,
  type PanoramaSettings,
  type SceneObject,
  type Side,
  type SkyImage,
  type TransformMode,
} from "@/studio/types";

const STORAGE_KEY = "manos.studio.v1";

export interface HandHud {
  confidence: number;
  pinch: boolean;
  pinchDistance: number;
  pointing: boolean;
  wrist: Vec3;
}

export interface AnchorHud {
  id: string;
  label: string;
  active: boolean;
  source: string;
  position: Vec3 | null;
}

export interface LiveReport {
  fps: number;
  latencyMs: number;
  source: "demo" | "mediapipe" | "none";
  handCount: number;
  left: HandHud | null;
  right: HandHud | null;
  hoveredId: string | null;
  grabbedId: string | null;
  grabbingHand: Side | null;
  anchors: AnchorHud[];
}

export type CameraPhase = "demo" | "starting" | "live" | "error";

interface Persisted {
  version: 1;
  pinchThreshold: number;
  handScale: number;
  smoothing: number;
  space: InteractionSpace;
  showLandmarks: boolean;
  showSkeleton: boolean;
  showSpace: boolean;
  showVideo: boolean;
  showOverlay: boolean;
  debug: boolean;
  invertHands: boolean;
  eyeHeight: number;
  transformMode: TransformMode;
  demoDrive: boolean;
  objects: SceneObject[];
}

function defaultObjects(): SceneObject[] {
  return [
    {
      id: "cube-demo",
      name: "Cubo",
      kind: "box",
      position: [-0.35, 0.8, -0.95],
      rotation: [0, 0.4, 0],
      scale: [0.12, 0.12, 0.12],
      visible: true,
      color: OBJECT_COLORS[0],
      grabbable: true,
      selectable: true,
    },
    {
      id: "sphere-demo",
      name: "Esfera",
      kind: "sphere",
      position: [0.38, 0.81, -1.35],
      rotation: [0, 0, 0],
      scale: [0.14, 0.14, 0.14],
      visible: true,
      color: OBJECT_COLORS[1],
      grabbable: true,
      selectable: true,
    },
    {
      id: "torus-demo",
      name: "Toro",
      kind: "torus",
      position: [0, 0.78, -1.05],
      rotation: [Math.PI / 2, 0, 0.25],
      scale: [0.2, 0.2, 0.2],
      visible: true,
      color: OBJECT_COLORS[2],
      grabbable: true,
      selectable: true,
    },
  ];
}

function loadPersisted(): Partial<Persisted> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Persisted;
    if (data.version !== 1 || !Array.isArray(data.objects)) return null;
    return data;
  } catch {
    return null;
  }
}

const saved = loadPersisted();

function spreadObjects(objects: SceneObject[]): SceneObject[] {
  const parked: Record<string, Vec3> = {
    "cube-demo": [-0.35, 0.8, -0.95],
    "sphere-demo": [0.38, 0.81, -1.35],
    "torus-demo": [0, 0.78, -1.05],
  };
  return objects.map((object) => {
    const next = parked[object.id];
    if (!next) return object;
    if (object.position[2] < -0.5) return object;
    return { ...object, position: next };
  });
}

function savedSpace(): InteractionSpace {
  const space = saved?.space;
  if (!space) return DEFAULT_SPACE;
  if (space.width < 4.6 || space.depth < 3.6) return DEFAULT_SPACE;
  return space;
}

export interface StudioState {
  pinchThreshold: number;
  handScale: number;
  smoothing: number;
  space: InteractionSpace;
  showLandmarks: boolean;
  showSkeleton: boolean;
  showSpace: boolean;
  showVideo: boolean;
  showOverlay: boolean;
  debug: boolean;
  invertHands: boolean;
  eyeHeight: number;
  transformMode: TransformMode;
  demoDrive: boolean;
  stayHere: boolean;
  panorama: PanoramaSettings | null;
  sky: SkyImage | null;
  objects: SceneObject[];
  selectedId: string | null;
  setSpace: (patch: Partial<InteractionSpace>) => void;
  patch: (patch: Partial<StudioState>) => void;
  select: (id: string | null) => void;
  setTransformMode: (mode: TransformMode) => void;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  commitTransform: (id: string, transform: Pick<SceneObject, "position" | "rotation" | "scale">) => void;
  addPrimitive: (kind: "box" | "sphere" | "torus" | "cylinder") => void;
  addObject: (object: SceneObject) => void;
  setPanorama: (panorama: PanoramaSettings | null) => void;
  patchPanorama: (patch: Partial<PanoramaSettings>) => void;
  setSky: (sky: SkyImage | null) => void;
  patchSky: (patch: Partial<SkyImage>) => void;
  removeSelected: () => void;
  resetObjects: () => void;
  parkDemoCube: () => void;
}

function persist(state: StudioState): void {
  const data: Persisted = {
    version: 1,
    pinchThreshold: state.pinchThreshold,
    handScale: state.handScale,
    smoothing: state.smoothing,
    space: state.space,
    showLandmarks: state.showLandmarks,
    showSkeleton: state.showSkeleton,
    showSpace: state.showSpace,
    showVideo: state.showVideo,
    showOverlay: state.showOverlay,
    debug: state.debug,
    invertHands: state.invertHands,
    eyeHeight: state.eyeHeight,
    transformMode: state.transformMode,
    demoDrive: state.demoDrive,
    objects: state.objects.filter((object) => object.kind !== "model"),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export const useStudio = create<StudioState>((set, get) => ({
  pinchThreshold: saved?.pinchThreshold ?? 0.034,
  handScale: saved?.handScale ?? 1,
  smoothing: saved?.smoothing ?? 0.55,
  space: savedSpace(),
  showLandmarks: saved?.showLandmarks ?? true,
  showSkeleton: saved?.showSkeleton ?? true,
  showSpace: saved?.showSpace ?? true,
  showVideo: saved?.showVideo ?? true,
  showOverlay: saved?.showOverlay ?? true,
  debug: saved?.debug ?? true,
  invertHands: saved?.invertHands ?? false,
  eyeHeight: saved?.eyeHeight ?? 1.25,
  transformMode: saved?.transformMode ?? "translate",
  demoDrive: saved?.demoDrive ?? true,
  stayHere: true,
  panorama: null,
  sky: null,
  objects: saved?.objects?.length ? spreadObjects(saved.objects) : defaultObjects(),
  selectedId: null,
  setSpace: (patch) => set((state) => ({ space: { ...state.space, ...patch } })),
  patch: (patch) => set(patch),
  select: (id) => set({ selectedId: id }),
  setTransformMode: (mode) => set({ transformMode: mode }),
  updateObject: (id, patch) =>
    set((state) => ({
      objects: state.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    })),
  commitTransform: (id, transform) =>
    set((state) => ({
      objects: state.objects.map((object) => (object.id === id ? { ...object, ...transform } : object)),
    })),
  addPrimitive: (kind) =>
    set((state) => {
      const index = state.objects.length;
      const scale = kind === "sphere" ? 0.14 : kind === "torus" ? 0.2 : kind === "cylinder" ? 0.14 : 0.12;
      const y = TABLE_TOP + (kind === "torus" ? 0.04 : scale * 0.5);
      const object: SceneObject = {
        id: `${kind}-${crypto.randomUUID().slice(0, 6)}`,
        name: kind === "box" ? "Cubo" : kind === "sphere" ? "Esfera" : kind === "torus" ? "Toro" : "Cilindro",
        kind,
        position: [((index % 5) - 2) * 0.28, y, TABLE_Z - 0.05],
        rotation: kind === "torus" ? [Math.PI / 2, 0, 0] : [0, 0, 0],
        scale: [scale, scale, scale],
        visible: true,
        color: OBJECT_COLORS[index % OBJECT_COLORS.length] ?? OBJECT_COLORS[0],
        grabbable: true,
        selectable: true,
      };
      return { objects: [...state.objects, object], selectedId: object.id };
    }),
  addObject: (object) => set((state) => ({ objects: [...state.objects, object], selectedId: object.id })),
  setPanorama: (panorama) => set({ panorama }),
  patchPanorama: (patch) =>
    set((state) => ({ panorama: state.panorama ? { ...state.panorama, ...patch } : null })),
  setSky: (sky) => set({ sky }),
  patchSky: (patch) => set((state) => ({ sky: state.sky ? { ...state.sky, ...patch } : null })),
  removeSelected: () =>
    set((state) => ({
      objects: state.objects.filter((object) => object.id !== state.selectedId),
      selectedId: null,
    })),
  resetObjects: () => set({ objects: defaultObjects(), selectedId: null }),
  parkDemoCube: () =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === "cube-demo"
          ? { ...object, position: [-0.35, 0.8, -0.95], rotation: [0, 0.4, 0], scale: [0.12, 0.12, 0.12] }
          : object,
      ),
    })),
}));

if (typeof window !== "undefined") {
  useStudio.subscribe((state) => persist(state));
}

const emptyReport: LiveReport = {
  fps: 0,
  latencyMs: 0,
  source: "none",
  handCount: 0,
  left: null,
  right: null,
  hoveredId: null,
  grabbedId: null,
  grabbingHand: null,
  anchors: [],
};

interface LiveState {
  report: LiveReport;
  camera: CameraPhase;
  cameraError: string | null;
  facing: "user" | "environment";
  recording: boolean;
  notice: string | null;
  setReport: (report: LiveReport) => void;
  setCamera: (camera: CameraPhase, error?: string | null) => void;
  setFacing: (facing: "user" | "environment") => void;
  setRecording: (recording: boolean) => void;
  setNotice: (notice: string | null) => void;
}

export const useLive = create<LiveState>((set) => ({
  report: emptyReport,
  camera: "demo",
  cameraError: null,
  facing: "user",
  recording: false,
  notice: null,
  setReport: (report) => set({ report }),
  setCamera: (camera, error = null) => set({ camera, cameraError: error }),
  setFacing: (facing) => set({ facing }),
  setRecording: (recording) => set({ recording }),
  setNotice: (notice) => set({ notice }),
}));

export function formatMeters(value: number): string {
  return `${(value * 100).toFixed(1)} cm`;
}
