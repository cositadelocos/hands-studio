import { drainCommand, pushCommand, type StudioCommand } from "@/studio/commands";
import { sampleDemo } from "@/studio/demo-source";
import { createInteractionMemory, stepInteraction } from "@/studio/interaction";
import type { Vec3 } from "@/studio/math";
import { cameraErrorMessage, MediaPipeSource, type FacingMode } from "@/studio/mediapipe-source";
import { drawOverlay } from "@/studio/overlay";
import { advanceTracking, createPipelineMemory } from "@/studio/pipeline";
import { downloadBlob, makeSample, SessionRecorder } from "@/studio/recorder";
import { SceneEngine, type FrameView } from "@/studio/scene-engine";
import { useLive, useStudio, type HandHud, type StudioState } from "@/studio/store";
import type { Side, StudioHand } from "@/studio/types";
import { STUDIO_EYE } from "@/studio/types";

const DEMO_CUBE: Vec3 = [-0.35, 0.8, -0.95];

import { KEY_ANCHOR_IDS, palmRotation } from "@/studio/anchors";

function stampName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function hud(hand: StudioHand | undefined): HandHud | null {
  if (!hand) return null;
  return {
    confidence: hand.confidence,
    pinch: hand.pinch,
    pinchDistance: hand.pinchDistance,
    pointing: hand.pointing,
    wrist: hand.points[0] ?? [0, 0, 0],
  };
}

function viewFrom(studio: StudioState, extra: Partial<FrameView> = {}): FrameView {
  return {
    objects: studio.objects,
    selectedId: studio.selectedId,
    mode: studio.transformMode,
    space: studio.space,
    showSpace: studio.showSpace,
    showLandmarks: studio.showLandmarks,
    showSkeleton: studio.showSkeleton,
    showVideo: false,
    debug: studio.debug,
    videoCanvas: null,
    videoRevision: 0,
    hands: {},
    rays: {},
    moves: [],
    hoveredId: null,
    stayHere: studio.stayHere,
    eyeHeight: studio.eyeHeight,
    panorama: studio.panorama,
    ...extra,
  };
}

export function startRuntime(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  overlay: HTMLCanvasElement,
): () => void {
  const engine = new SceneEngine(canvas);
  const mediapipe = new MediaPipeSource(video);
  const memory = createPipelineMemory();
  const interaction = createInteractionMemory();
  const recorder = new SessionRecorder();
  let mode: "demo" | "camera" = "demo";
  let cameraToken = 0;
  let frames = 0;
  let fpsStamp = performance.now();
  let fps = 0;
  let lastHud = 0;
  let lastCycle = -1;
  let snapshotNext = false;
  let draining = false;
  let overlayRevision = -1;
  let stopQueued = false;
  const held: Partial<Record<Side, string>> = {};

  engine.onSelect = (id) => useStudio.getState().select(id);
  engine.onTransform = (id, transform) => useStudio.getState().commitTransform(id, transform);
  engine.onRest = (id, position) => {
    const object = useStudio.getState().objects.find((item) => item.id === id);
    if (!object) return;
    const same =
      Math.abs(object.position[0] - position[0]) < 1e-4 &&
      Math.abs(object.position[1] - position[1]) < 1e-4 &&
      Math.abs(object.position[2] - position[2]) < 1e-4;
    if (same) return;
    useStudio.getState().commitTransform(id, { position, rotation: object.rotation, scale: object.scale });
  };

  const resize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    engine.resize(parent.clientWidth, parent.clientHeight);
  };
  resize();
  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);

  const onKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === "1" || event.key.toLowerCase() === "g") useStudio.getState().setTransformMode("translate");
    if (event.key === "2" || event.key.toLowerCase() === "r") useStudio.getState().setTransformMode("rotate");
    if (event.key === "3" || event.key.toLowerCase() === "s") useStudio.getState().setTransformMode("scale");
    if (event.key === "Escape") useStudio.getState().select(null);
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      useStudio.getState().removeSelected();
    }
  };
  window.addEventListener("keydown", onKey);

  async function enableCamera(facing: FacingMode): Promise<void> {
    const token = ++cameraToken;
    useLive.getState().setCamera("starting");
    try {
      await mediapipe.start(facing);
      if (token !== cameraToken) {
        mediapipe.stop();
        return;
      }
      useLive.getState().setFacing(facing);
      useLive.getState().setCamera("live");
      mode = "camera";
    } catch (error) {
      if (token !== cameraToken) return;
      mediapipe.stop();
      mode = "demo";
      useLive.getState().setCamera("error", cameraErrorMessage(error));
    }
  }

  function disableCamera(): void {
    cameraToken += 1;
    mediapipe.stop();
    mode = "demo";
    useLive.getState().setCamera("demo");
  }

  async function handle(command: StudioCommand): Promise<void> {
    if (command.type === "camera-toggle") {
      if (mode === "camera" || useLive.getState().camera === "starting") disableCamera();
      else await enableCamera(useLive.getState().facing);
      return;
    }
    if (command.type === "flip-camera") {
      const next = useLive.getState().facing === "user" ? "environment" : "user";
      if (mode === "camera") await enableCamera(next);
      else useLive.getState().setFacing(next);
      return;
    }
    if (command.type === "record-toggle") {
      if (recorder.active) {
        const result = await recorder.stop();
        useLive.getState().setRecording(false);
        const stamp = stampName();
        downloadBlob(result.video, `manos-${stamp}.${result.extension}`);
        downloadBlob(
          new Blob([JSON.stringify({ version: 1, samples: result.samples }, null, 2)], { type: "application/json" }),
          `manos-${stamp}.json`,
        );
        useLive.getState().setNotice("Grabación lista: video del visor y datos de landmarks.");
        return;
      }
      recorder.start(canvas);
      useLive.getState().setRecording(true);
      useLive.getState().setNotice("Grabando el visor 3D.");
      return;
    }
    if (command.type === "snapshot") {
      snapshotNext = true;
      return;
    }
    if (command.type === "panorama-clear") {
      engine.clearPanorama();
      useStudio.getState().setPanorama(null);
      useLive.getState().setNotice("Entorno GLB quitado.");
      return;
    }
    if (command.type === "panorama") {
      await engine.loadPanorama(command.file);
      const space = useStudio.getState().space;
      useStudio.getState().setPanorama({
        name: command.file.name,
        position: [0, STUDIO_EYE, space.offsetZ],
        scale: 1,
        rotation: 0,
      });
      useStudio.getState().patch({ stayHere: true });
      useLive.getState().setNotice("Entorno GLB listo. Estás en el centro.");
      return;
    }
    const object = await engine.importModel(command.file);
    useStudio.getState().addObject(object);
    useLive.getState().setNotice(`Modelo cargado: ${object.name}`);
  }

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!draining) {
      const command = drainCommand();
      if (command) {
        draining = true;
        void handle(command)
          .catch((error: unknown) => {
            useLive.getState().setNotice(error instanceof Error ? error.message : "La acción no se pudo completar.");
            if (command.type === "record-toggle") useLive.getState().setRecording(false);
          })
          .finally(() => {
            draining = false;
          });
      }
    }

    const studio = useStudio.getState();
    mediapipe.invertHands = studio.invertHands;
    const cycle = Math.floor(now / 1000 / 14);
    if (mode === "demo" && studio.demoDrive && cycle !== lastCycle) {
      lastCycle = cycle;
      if (studio.selectedId !== "cube-demo" && !held.left && !held.right) studio.parkDemoCube();
    }

    const frame = mode === "camera" ? mediapipe.sample(now) : sampleDemo(now, studio.space, DEMO_CUBE);
    if (!frame) {
      engine.frame(viewFrom(useStudio.getState()));
      return;
    }

    const tracked = advanceTracking(frame, memory, {
      space: studio.space,
      handScale: studio.handScale,
      pinchThreshold: studio.pinchThreshold,
      smoothing: studio.smoothing,
      invertHands: studio.invertHands,
    });
    const previous = { left: held.left, right: held.right };
    const liveObjects = studio.objects.map((object) => {
      const pose = engine.readTransform(object.id);
      return pose ? { ...object, position: pose.position } : object;
    });
    const result = stepInteraction(
      interaction,
      tracked.hands,
      liveObjects,
      (origin, direction) => engine.raycast(origin, direction),
      (point) => engine.pickThrough(point),
      studio.space,
      mode === "camera" || studio.demoDrive,
    );

    for (const side of ["left", "right"] as const) {
      const before = previous[side];
      const after = result.holds[side]?.id;
      if (before && before !== after) {
        const transform = engine.readTransform(before);
        if (transform) useStudio.getState().commitTransform(before, transform);
      }
      if (after) held[side] = after;
      else delete held[side];
    }

    const fresh = useStudio.getState();
    engine.frame(
      viewFrom(fresh, {
        showVideo: false,
        videoCanvas: null,
        videoRevision: mode === "camera" ? mediapipe.revision : 0,
        hands: {
          left: tracked.hands.left
            ? { points: tracked.hands.left.points, rotation: palmRotation(tracked.hands.left.points) }
            : undefined,
          right: tracked.hands.right
            ? { points: tracked.hands.right.points, rotation: palmRotation(tracked.hands.right.points) }
            : undefined,
        },
        rays: result.rays,
        moves: result.moves,
        hoveredId: result.hoveredId,
      }),
    );

    if (fresh.showOverlay && (mode !== "camera" || mediapipe.revision !== overlayRevision)) {
      overlayRevision = mediapipe.revision;
      const context = overlay.getContext("2d");
      if (context) {
        drawOverlay(context, mode === "camera" ? mediapipe.display : null, tracked.hands, mode === "camera" && fresh.showVideo, fresh.debug);
      }
    }

    const grabbedId = result.holds.left?.id ?? result.holds.right?.id ?? null;
    const grabbingHand: Side | null = result.holds.left ? "left" : result.holds.right ? "right" : null;
    if (recorder.active) {
      recorder.push(makeSample(now, frame.source, tracked.hands, grabbingHand, fresh.selectedId, grabbedId));
      if (recorder.capped && !stopQueued) {
        stopQueued = true;
        pushCommand({ type: "record-toggle" });
      }
    } else {
      stopQueued = false;
    }
    if (snapshotNext) {
      snapshotNext = false;
      const sample = makeSample(now, frame.source, tracked.hands, grabbingHand, fresh.selectedId, grabbedId);
      downloadBlob(new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" }), `manos-frame-${stampName()}.json`);
      useLive.getState().setNotice("Frame de tracking exportado.");
    }

    frames += 1;
    if (now - fpsStamp > 500) {
      fps = (frames * 1000) / (now - fpsStamp);
      frames = 0;
      fpsStamp = now;
    }
    if (now - lastHud > 140) {
      lastHud = now;
      const probe = window as Window & {
        __manosReady?: boolean;
        __manos?: { grabbedId: string | null; pinch: boolean; cube: number[] | undefined };
      };
      probe.__manosReady = true;
      probe.__manos = {
        grabbedId,
        pinch: Boolean(tracked.hands.left?.pinch),
        cube: useStudio.getState().objects.find((object) => object.id === "cube-demo")?.position,
      };
      useLive.getState().setReport({
        fps,
        latencyMs: frame.latencyMs,
        source: frame.source,
        handCount: Number(Boolean(tracked.hands.left)) + Number(Boolean(tracked.hands.right)),
        left: hud(tracked.hands.left),
        right: hud(tracked.hands.right),
        hoveredId: result.hoveredId,
        grabbedId,
        grabbingHand,
        anchors: KEY_ANCHOR_IDS.map((id) => {
          const anchor = tracked.anchors.find((item) => item.id === id);
          return {
            id,
            label: anchor?.label ?? id,
            active: Boolean(anchor?.position),
            source: anchor?.source ?? "missing",
            position: anchor?.position ?? null,
          };
        }),
      });
    }
  };

  let raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    cameraToken += 1;
    window.removeEventListener("keydown", onKey);
    observer.disconnect();
    mediapipe.dispose();
    engine.dispose();
    if (recorder.active) void recorder.stop().catch(() => undefined);
  };
}
