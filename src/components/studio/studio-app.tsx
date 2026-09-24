import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DebugHud, LeftPanel, NoticeToast, RightPanel } from "@/components/studio/controls";
import { pushCommand } from "@/studio/commands";
import { useLive, useStudio } from "@/studio/store";

function LookPads() {
  const lookYaw = useStudio((state) => state.lookYaw);
  const lookPitch = useStudio((state) => state.lookPitch);
  const patch = useStudio((state) => state.patch);
  const setFromPointer = (axis: "yaw" | "pitch", event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (axis === "yaw") {
      const t = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)));
      patch({ lookYaw: -36 + t * 72 });
      return;
    }
    const t = Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1)));
    patch({ lookPitch: 20 - t * 44 });
  };
  return (
    <>
      <div
        data-look="yaw"
        className="pointer-events-auto absolute bottom-4 left-1/2 flex h-12 w-72 -translate-x-1/2 touch-none items-center rounded-full border border-border bg-surface/80 px-3 sm:w-96"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setFromPointer("yaw", event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer("yaw", event);
        }}
      >
        <span className="pointer-events-none absolute left-3 font-mono text-[10px] text-muted">izq</span>
        <span
          className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `calc(${((lookYaw + 36) / 72) * 100}% - 12px)` }}
        />
        <span className="pointer-events-none absolute right-3 font-mono text-[10px] text-muted">der</span>
      </div>
      <div
        data-look="pitch"
        className="pointer-events-auto absolute right-3 top-1/2 flex h-64 w-12 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-border bg-surface/80"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setFromPointer("pitch", event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer("pitch", event);
        }}
      >
        <span className="pointer-events-none absolute top-2 font-mono text-[10px] text-muted">arriba</span>
        <span
          className="pointer-events-none absolute left-1/2 h-6 w-6 -translate-x-1/2 rounded-full bg-accent"
          style={{ top: `calc(${((20 - lookPitch) / 44) * 100}% - 12px)` }}
        />
        <span className="pointer-events-none absolute bottom-2 font-mono text-[10px] text-muted">abajo</span>
      </div>
    </>
  );
}

async function openFullscreen(element: HTMLElement): Promise<boolean> {
  const webkit = element as HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen({ navigationUI: "hide" });
      return document.fullscreenElement === element;
    }
    if (webkit.webkitRequestFullscreen) {
      const result = webkit.webkitRequestFullscreen();
      if (result && typeof result.then === "function") await result;
      return document.fullscreenElement === element;
    }
  } catch {
    return false;
  }
  return false;
}

export function StudioApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [fill, setFill] = useState(false);
  const [fillHeight, setFillHeight] = useState(0);
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

  useEffect(() => {
    if (!fill) return;
    const fit = () => setFillHeight(Math.round(window.visualViewport?.height ?? window.innerHeight));
    fit();
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    return () => {
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, [fill]);

  async function toggleStage() {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement || fill) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFill(false);
      return;
    }
    if (await openFullscreen(stage) || (await openFullscreen(document.documentElement))) {
      setFill(true);
      return;
    }
    window.scrollTo(0, 1);
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
    <div
      className={
        fill
          ? "fixed inset-x-0 top-0 z-[70] flex w-screen touch-manipulation flex-col overflow-hidden bg-bg text-fg"
          : "flex h-dvh flex-col overflow-hidden bg-bg text-fg"
      }
      style={fill ? { height: `${fillHeight || Math.round(window.visualViewport?.height ?? window.innerHeight)}px` } : undefined}
    >
      <header className={`flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 sm:px-4 ${fill ? "hidden" : ""}`}>
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight sm:text-lg">
          <img src="/logo-chair.png" alt="" className="h-[1.15em] w-auto" />
          <span>cositadelocos</span>
          <span className="hidden text-sm font-normal text-muted lg:inline">Hands studio</span>
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
          className="relative min-h-0 min-w-0 flex-1 bg-black"
        >
          <canvas ref={canvasRef} className="h-full w-full touch-none" />
          <video ref={videoRef} playsInline muted autoPlay className="pointer-events-none absolute h-px w-px opacity-0" />
          <div className="pointer-events-none absolute inset-0">
            <button
              type="button"
              onClick={toggleStage}
              className="pointer-events-auto absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] min-h-11 rounded-md border border-border bg-surface/90 px-3 text-sm text-fg"
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
            <LookPads />
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
