import type { Vec3 } from "@/studio/math";
import type { NormPoint, RawHand, Side, TrackingFrame } from "@/studio/types";

const WASM_BASE = "/vendor/mediapipe/wasm";
const MODEL_PATH = "/models/hand_landmarker.task";

interface Landmarker {
  detectForVideo: (
    image: HTMLCanvasElement,
    timestamp: number,
  ) => {
    landmarks: { x: number; y: number; z: number; visibility?: number }[][];
    worldLandmarks: { x: number; y: number; z: number }[][];
    handedness: { categoryName?: string; score: number }[][];
  };
  close: () => void;
}

export type FacingMode = "user" | "environment";

/**
 * Camera → Hand Landmarker. Emits RawHand only.
 * The front camera is flipped once so the picture is not a mirror.
 */
export class MediaPipeSource {
  readonly display: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private landmarker: Landmarker | null = null;
  private stream: MediaStream | null = null;
  private lastTs = -1;
  private last: TrackingFrame | null = null;
  private running = false;
  facing: FacingMode = "user";
  invertHands = false;
  revision = 0;
  private lastDetectAt = -1;
  private lastHandsAt = 0;
  private detectGap = 90;

  constructor(private readonly video: HTMLVideoElement) {
    this.display = document.createElement("canvas");
    const ctx = this.display.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("No se pudo preparar el lienzo de la cámara.");
    this.ctx = ctx;
  }

  async start(facing: FacingMode): Promise<void> {
    this.stopStream();
    this.facing = facing;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador no permite usar la cámara.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 192 }, height: { ideal: 144 }, frameRate: { ideal: 24, max: 30 } },
    });
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    await this.video.play();
    if (!this.landmarker) await this.createLandmarker();
    this.running = true;
    this.lastTs = -1;
  }

  private async createLandmarker(): Promise<void> {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
    const shared = {
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        ...shared,
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      });
    } catch {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        ...shared,
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      });
    }
  }

  sample(now: number): TrackingFrame | null {
    if (!this.running || !this.landmarker || this.video.readyState < 2) return this.last;
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) return this.last;
    if (this.last && now - this.lastDetectAt < this.detectGap) return this.last;
    const maxWidth = 160;
    const scale = width > maxWidth ? maxWidth / width : 1;
    const drawWidth = Math.max(2, Math.round(width * scale));
    const drawHeight = Math.max(2, Math.round(height * scale));
    if (this.display.width !== drawWidth || this.display.height !== drawHeight) {
      this.display.width = drawWidth;
      this.display.height = drawHeight;
    }
    this.ctx.imageSmoothingEnabled = false;
    const mirror = this.facing === "user";
    this.ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? drawWidth : 0, 0);
    this.ctx.drawImage(this.video, 0, 0, drawWidth, drawHeight);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    const timestamp = Math.max(now, this.lastTs + 1);
    this.lastTs = timestamp;
    this.lastDetectAt = now;
    const started = performance.now();
    let result: ReturnType<Landmarker["detectForVideo"]>;
    try {
      result = this.landmarker.detectForVideo(this.display, timestamp);
    } catch {
      return this.last;
    }
    const swap = !mirror !== this.invertHands;
    const hands: RawHand[] = [];
    result.landmarks.forEach((landmarks, index) => {
      const category = result.handedness[index]?.[0];
      let side: Side = category?.categoryName?.toLowerCase() === "left" ? "left" : "right";
      if (swap) side = side === "left" ? "right" : "left";
      const image: NormPoint[] = landmarks.map((landmark) => ({
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
        visibility: landmark.visibility,
      }));
      const world: Vec3[] = (result.worldLandmarks[index] ?? []).map((landmark) => [
        landmark.x,
        -landmark.y,
        -landmark.z,
      ]);
      if (image.length >= 21 && world.length >= 21) {
        hands.push({ handedness: side, score: category?.score ?? 0, image, world });
      }
    });
    const elapsed = performance.now() - started;
    this.detectGap = elapsed > 42 ? 110 : elapsed > 22 ? 60 : 40;
    if (hands.length === 0 && this.last && this.last.hands.length > 0 && now - this.lastHandsAt < 350) {
      this.last = { ...this.last, timestamp, latencyMs: elapsed };
      return this.last;
    }
    if (hands.length > 0) this.lastHandsAt = now;
    this.revision += 1;
    this.last = { timestamp, latencyMs: elapsed, source: "mediapipe", hands };
    return this.last;
  }

  stop(): void {
    this.running = false;
    this.stopStream();
    this.last = null;
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video.srcObject) this.video.srcObject = null;
  }

  dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
  }
}

export function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Permiso de cámara denegado.";
    if (error.name === "NotFoundError") return "No se encontró una cámara.";
    if (error.name === "NotReadableError") return "La cámara está en uso por otra aplicación.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "No se pudo iniciar el seguimiento.";
}
