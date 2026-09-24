import { HAND_BONES, type Side, type StudioHand } from "@/studio/types";

const COLORS: Record<Side, string> = { left: "#3dbeb6", right: "#e07a5f" };

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource | null,
  hands: Partial<Record<Side, StudioHand>>,
  showVideo: boolean,
  showIndex: boolean,
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10161b";
  ctx.fillRect(0, 0, width, height);
  if (showVideo && source) {
    ctx.drawImage(source, 0, 0, width, height);
  }
  for (const side of ["left", "right"] as const) {
    const hand = hands[side];
    if (!hand) continue;
    const color = COLORS[side];
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [a, b] of HAND_BONES) {
      const pa = hand.image[a];
      const pb = hand.image[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * width, pa.y * height);
      ctx.lineTo(pb.x * width, pb.y * height);
    }
    ctx.stroke();
    hand.image.forEach((point, index) => {
      ctx.beginPath();
      ctx.fillStyle = index === 4 || index === 8 ? "#e59a4a" : color;
      ctx.arc(point.x * width, point.y * height, index === 0 ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (showIndex) {
        ctx.fillStyle = "#e7edf1";
        ctx.font = "10px IBM Plex Mono, monospace";
        ctx.fillText(String(index), point.x * width + 4, point.y * height - 4);
      }
    });
  }
}
