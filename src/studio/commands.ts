export type StudioCommand =
  | { type: "camera-toggle" }
  | { type: "flip-camera" }
  | { type: "record-toggle" }
  | { type: "snapshot" }
  | { type: "import"; file: File }
  | { type: "panorama"; file: File }
  | { type: "panorama-clear" }
  | { type: "sky"; file: File }
  | { type: "sky-clear" };

const queue: StudioCommand[] = [];

export function pushCommand(command: StudioCommand): void {
  queue.push(command);
}

export function drainCommand(): StudioCommand | undefined {
  return queue.shift();
}
