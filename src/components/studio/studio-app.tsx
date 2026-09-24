import { useEffect, useRef, useState } from "react";
import { DebugHud, LeftPanel, NoticeToast, RightPanel } from "@/components/studio/controls";
import { pushCommand } from "@/studio/commands";
import { useLive, useStudio } from "@/studio/store";

export function StudioApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [fill, setFill] = useState(false);
  const [sheet, setSheet] = useState<"controls" | "inspector" | null>(null);
  const showOverlay = useStudio((state) => state.showOverlay);
  const camera = useLive((state) => state.camera);
  const recording = useLive((state) => state.recording);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFill(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  async function toggleStage() {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement === stage || fill) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFill(false);
      return;
    }
    const webkit = stage as HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
    const request = stage.requestFullscreen?.bind(stage) ?? webkit.webkitRequestFullscreen?.bind(stage);
    if (request) {
      try {
        const result = request();
        if (result && typeof result.then === "function") await result;
        if (document.fullscreenElement === stage) {
          setFill(true);
          return;
        }
      } catch {
        // iPhone Safari no permite la pantalla completa nativa.
      }
    }
    setFill(true);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !video || !overlay) return;
    let stop: (() => void) | undefined;
    let cancel = false;
    void import("@/studio/runtime").then((module) => {
      if (cancel || !canvas || !video || !overlay) return;
      stop = module.startRuntime(canvas, video, overlay);
    });
    return () => {
      cancel = true;
      stop?.();
    };
  }, []);

  const cameraLabel =
    camera === "live" ? "Cámara" : camera === "starting" ? "Conectando" : camera === "error" ? "Sin cámara" : "Demo";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight sm:text-lg">cositadelocos</span>
          <span className="hidden text-sm text-muted lg:inline">Hands studio</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 font-mono text-xs text-muted sm:flex">
            <span className={`h-2 w-2 rounded-full ${recording ? "bg-hand-r" : camera === "live" ? "bg-hand-l" : "bg-accent"}`} />
            {recording ? "Grabando" : cameraLabel}
          </span>
          <button
            type="button"
            onClick={() => pushCommand({ type: "camera-toggle" })}
            className="min-h-11 rounded-md bg-accent px-2 text-sm font-medium text-accent-fg sm:px-3"
          >
            {camera === "live" ? "Detener" : "Cámara"}
          </button>
          <button
            type="button"
            onClick={() => setSheet("controls")}
            className="min-h-11 rounded-md border border-border px-2 text-sm lg:hidden"
          >
            Ajustes
          </button>
          <button
            type="button"
            onClick={() => setSheet("inspector")}
            className="min-h-11 rounded-md border border-border px-2 text-sm lg:hidden"
          >
            Inspector
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-border bg-surface lg:block">
          <LeftPanel />
        </aside>
        <main
          ref={stageRef}
          className={`relative min-w-0 flex-1 bg-bg [&:fullscreen]:h-screen [&:fullscreen]:w-screen ${fill ? "fixed inset-0 z-40 h-dvh w-screen" : ""}`}
        >
          <canvas ref={canvasRef} className="h-full w-full touch-none" />
          <video ref={videoRef} playsInline muted autoPlay className="pointer-events-none absolute h-px w-px opacity-0" />
          <div className="pointer-events-none absolute inset-0">
            <button
              type="button"
              onClick={toggleStage}
              className="pointer-events-auto absolute right-3 top-16 min-h-11 rounded-md border border-border bg-surface/90 px-3 text-sm text-fg sm:top-3"
            >
              {fill ? "Salir" : "Pantalla completa"}
            </button>
            <div className="absolute left-3 top-16 flex flex-col gap-1 text-xs sm:top-3">
              <span className="text-sm font-semibold tracking-tight text-fg sm:hidden">cositadelocos</span>
              <span className="hidden text-hand-l sm:block">Izquierda</span>
              <span className="hidden text-hand-r sm:block">Derecha</span>
            </div>
            <canvas
              ref={overlayRef}
              width={480}
              height={270}
              className={`absolute bottom-3 left-3 w-28 rounded-md border border-border sm:w-44 ${showOverlay ? "" : "hidden"}`}
            />
            <DebugHud />
            <NoticeToast />
          </div>
        </main>
        <aside className="hidden w-80 shrink-0 border-l border-border bg-surface lg:block">
          <RightPanel />
        </aside>
      </div>

      {sheet ? (
        <div className="fixed inset-0 z-30 flex flex-col bg-bg lg:hidden">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-sm font-medium">{sheet === "controls" ? "Controles" : "Inspector"}</span>
            <button type="button" onClick={() => setSheet(null)} className="min-h-11 px-3 text-sm text-accent">
              Cerrar
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {sheet === "controls" ? <LeftPanel /> : <RightPanel />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
