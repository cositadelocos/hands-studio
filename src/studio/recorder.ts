import type { Side, StudioHand, TrackingSourceKind } from "@/studio/types";

export interface HandSample {
  confidence: number;
  landmarks: { x: number; y: number; z: number }[];
  image: { x: number; y: number; z: number; visibility?: number }[];
  pinch: boolean;
  pointing: boolean;
}

export interface TrackingSample {
  timestamp: number;
  source: TrackingSourceKind;
  left: HandSample | null;
  right: HandSample | null;
  interactingHand: Side | null;
  selectedId: string | null;
  grabbedId: string | null;
}

function handSample(hand: StudioHand | undefined): HandSample | null {
  if (!hand) return null;
  return {
    confidence: hand.confidence,
    landmarks: hand.points.map(([x, y, z]) => ({ x, y, z })),
    image: hand.image.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility,
    })),
    pinch: hand.pinch,
    pointing: hand.pointing,
  };
}

export function makeSample(
  timestamp: number,
  source: TrackingSourceKind,
  hands: Partial<Record<Side, StudioHand>>,
  interactingHand: Side | null,
  selectedId: string | null,
  grabbedId: string | null,
): TrackingSample {
  return {
    timestamp,
    source,
    left: handSample(hands.left),
    right: handSample(hands.right),
    interactingHand,
    selectedId,
    grabbedId,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export class SessionRecorder {
  active = false;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private samples: TrackingSample[] = [];
  private lastSampleAt = 0;

  start(canvas: HTMLCanvasElement): void {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Este navegador no puede grabar video.");
    }
    const stream = canvas.captureStream(30);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.samples = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(250);
    this.active = true;
    this.lastSampleAt = 0;
  }

  push(sample: TrackingSample): void {
    if (!this.active) return;
    if (sample.timestamp - this.lastSampleAt < 50 && this.samples.length > 0) return;
    this.lastSampleAt = sample.timestamp;
    this.samples.push(sample);
  }

  get capped(): boolean {
    return this.samples.length >= 12000;
  }

  async stop(): Promise<{ video: Blob; samples: TrackingSample[]; extension: string }> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("No hay una grabación activa.");
    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.active = false;
    const type = recorder.mimeType || "video/webm";
    const extension = type.includes("mp4") ? "mp4" : "webm";
    const video = new Blob(this.chunks, { type });
    const samples = this.samples;
    this.recorder = null;
    this.chunks = [];
    this.samples = [];
    return { video, samples, extension };
  }
}
