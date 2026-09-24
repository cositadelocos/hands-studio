import { useEffect, useRef, type ReactNode } from "react";
import { pushCommand } from "@/studio/commands";
import { formatMeters, useLive, useStudio } from "@/studio/store";
import type { AnchorHud, HandHud } from "@/studio/store";
import type { SceneObject } from "@/studio/types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border py-2 text-left text-sm text-fg"
    >
      <span>{label}</span>
      <span className={`flex h-5 w-9 shrink-0 rounded-full p-0.5 ${on ? "bg-accent" : "bg-border"}`}>
        <span className={`h-4 w-4 rounded-full bg-bg transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-3 flex flex-col gap-1 text-sm text-fg">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted">{display}</span>
      </span>
      <input
        className="manos-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function LeftPanel() {
  const studio = useStudio();
  const camera = useLive((state) => state.camera);
  const cameraError = useLive((state) => state.cameraError);
  const facing = useLive((state) => state.facing);
  const recording = useLive((state) => state.recording);
  const fileRef = useRef<HTMLInputElement>(null);
  const panoramaRef = useRef<HTMLInputElement>(null);
  const skyRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Section title="SEÑAL">
          <button
            type="button"
            onClick={() => pushCommand({ type: "camera-toggle" })}
            className="min-h-11 w-full rounded-md bg-accent px-3 text-sm font-medium text-accent-fg"
          >
            {camera === "starting" ? "Conectando cámara…" : camera === "live" ? "Detener cámara" : "Activar cámara"}
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => pushCommand({ type: "flip-camera" })}
              className="min-h-11 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg"
            >
              {facing === "user" ? "Frontal" : "Trasera"}
            </button>
            <button
              type="button"
              onClick={() => pushCommand({ type: "record-toggle" })}
              className={`min-h-11 rounded-md px-2 text-sm font-medium ${recording ? "bg-hand-r text-bg" : "border border-border bg-surface-2 text-fg"}`}
            >
              {recording ? "Detener" : "Grabar"}
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            {camera === "live"
              ? "Pellizca el objeto que ves, esté al fondo o adelante. Sin soltar, acércate a la cámara para traerlo y aléjate para llevarlo al fondo."
              : camera === "error"
                ? cameraError
                : "Demostración. La mano izquierda pellizca el cubo en bucle."}
          </p>
          <Toggle label="La demo mueve objetos" on={studio.demoDrive} onClick={() => studio.patch({ demoDrive: !studio.demoDrive })} />
          <Toggle label="Invertir izquierda / derecha" on={studio.invertHands} onClick={() => studio.patch({ invertHands: !studio.invertHands })} />
          <Toggle label="Quedarme aquí" on={studio.stayHere} onClick={() => studio.patch({ stayHere: !studio.stayHere })} />
          <p className="mt-2 text-sm text-muted">
            La cámara se queda en el centro. Arrastra el visor para girar sin salir del lugar.
          </p>
          <Slider
            label="Altura de la vista"
            min={0.5}
            max={2.6}
            step={0.01}
            value={studio.eyeHeight}
            display={formatMeters(studio.eyeHeight)}
            onChange={(eyeHeight) => studio.patch({ eyeHeight })}
          />
        </Section>

        <Section title="VISUAL">
          <Toggle label="Landmarks" on={studio.showLandmarks} onClick={() => studio.patch({ showLandmarks: !studio.showLandmarks })} />
          <Toggle label="Esqueleto" on={studio.showSkeleton} onClick={() => studio.patch({ showSkeleton: !studio.showSkeleton })} />
          <Toggle label="Espacio de interacción" on={studio.showSpace} onClick={() => studio.patch({ showSpace: !studio.showSpace })} />
          <Toggle label="Video pequeño" on={studio.showVideo} onClick={() => studio.patch({ showVideo: !studio.showVideo })} />
          <Toggle label="Mapa 2D" on={studio.showOverlay} onClick={() => studio.patch({ showOverlay: !studio.showOverlay })} />
          <Toggle label="Depuración" on={studio.debug} onClick={() => studio.patch({ debug: !studio.debug })} />
        </Section>

        <Section title="ESPACIO">
          <Slider
            label="Ancho"
            min={1.2}
            max={8}
            step={0.01}
            value={studio.space.width}
            display={formatMeters(studio.space.width)}
            onChange={(width) => studio.setSpace({ width })}
          />
          <Slider
            label="Alto"
            min={1}
            max={5}
            step={0.01}
            value={studio.space.height}
            display={formatMeters(studio.space.height)}
            onChange={(height) => studio.setSpace({ height })}
          />
          <Slider
            label="Profundidad"
            min={1}
            max={8}
            step={0.01}
            value={studio.space.depth}
            display={formatMeters(studio.space.depth)}
            onChange={(depth) => studio.setSpace({ depth })}
          />
          <Slider
            label="Distancia"
            min={-0.35}
            max={0.35}
            step={0.01}
            value={studio.space.offsetZ}
            display={formatMeters(studio.space.offsetZ)}
            onChange={(offsetZ) => studio.setSpace({ offsetZ })}
          />
          <Slider
            label="Escala de la mano"
            min={0.6}
            max={1.8}
            step={0.01}
            value={studio.handScale}
            display={studio.handScale.toFixed(2)}
            onChange={(handScale) => studio.patch({ handScale })}
          />
          <Slider
            label="Umbral de pellizco"
            min={0.015}
            max={0.08}
            step={0.001}
            value={studio.pinchThreshold}
            display={formatMeters(studio.pinchThreshold)}
            onChange={(pinchThreshold) => studio.patch({ pinchThreshold })}
          />
          <Slider
            label="Respuesta"
            min={0.2}
            max={1}
            step={0.01}
            value={studio.smoothing}
            display={studio.smoothing.toFixed(2)}
            onChange={(smoothing) => studio.patch({ smoothing })}
          />
        </Section>

        <Section title="ESCENA">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="min-h-11 rounded-md border border-border bg-surface-2 text-sm text-fg" onClick={() => studio.addPrimitive("box")}>
              Cubo
            </button>
            <button type="button" className="min-h-11 rounded-md border border-border bg-surface-2 text-sm text-fg" onClick={() => studio.addPrimitive("sphere")}>
              Esfera
            </button>
            <button type="button" className="min-h-11 rounded-md border border-border bg-surface-2 text-sm text-fg" onClick={() => studio.addPrimitive("torus")}>
              Toro
            </button>
            <button type="button" className="min-h-11 rounded-md border border-border bg-surface-2 text-sm text-fg" onClick={() => studio.addPrimitive("cylinder")}>
              Cilindro
            </button>
          </div>
          <button
            type="button"
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-surface-2 text-sm text-fg"
            onClick={() => fileRef.current?.click()}
          >
            Cargar GLB / glTF
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) pushCommand({ type: "import", file });
            }}
          />
          <button type="button" className="mt-2 min-h-11 w-full rounded-md border border-border text-sm text-muted" onClick={() => studio.resetObjects()}>
            Restablecer objetos
          </button>
          <button type="button" className="mt-2 min-h-11 w-full rounded-md border border-border text-sm text-muted" onClick={() => pushCommand({ type: "snapshot" })}>
            Exportar frame de tracking
          </button>
        </Section>

        <Section title="ENTORNO 360">
          <button
            type="button"
            className="min-h-11 w-full rounded-md border border-border bg-surface-2 text-sm text-fg"
            onClick={() => panoramaRef.current?.click()}
          >
            Cargar GLB 360
          </button>
          <input
            ref={panoramaRef}
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) pushCommand({ type: "panorama", file });
            }}
          />
          {studio.panorama ? (
            <>
              <p className="mt-2 truncate text-sm text-muted">{studio.panorama.name}</p>
              <Slider
                label="Posición X"
                min={-3}
                max={3}
                step={0.01}
                value={studio.panorama.position[0]}
                display={studio.panorama.position[0].toFixed(3)}
                onChange={(x) => studio.patchPanorama({ position: [x, studio.panorama!.position[1], studio.panorama!.position[2]] })}
              />
              <Slider
                label="Posición Y"
                min={-2}
                max={3}
                step={0.01}
                value={studio.panorama.position[1]}
                display={studio.panorama.position[1].toFixed(3)}
                onChange={(y) => studio.patchPanorama({ position: [studio.panorama!.position[0], y, studio.panorama!.position[2]] })}
              />
              <Slider
                label="Posición Z"
                min={-3}
                max={3}
                step={0.01}
                value={studio.panorama.position[2]}
                display={studio.panorama.position[2].toFixed(3)}
                onChange={(z) => studio.patchPanorama({ position: [studio.panorama!.position[0], studio.panorama!.position[1], z] })}
              />
              <Slider
                label="Escala"
                min={0.05}
                max={4}
                step={0.01}
                value={studio.panorama.scale}
                display={studio.panorama.scale.toFixed(2)}
                onChange={(scale) => studio.patchPanorama({ scale })}
              />
              <Slider
                label="Rotación"
                min={-180}
                max={180}
                step={1}
                value={studio.panorama.rotation}
                display={`${Math.round(studio.panorama.rotation)} °`}
                onChange={(rotation) => studio.patchPanorama({ rotation })}
              />
              <button
                type="button"
                className="mt-3 min-h-11 w-full rounded-md border border-border text-sm text-muted"
                onClick={() => pushCommand({ type: "panorama-clear" })}
              >
                Quitar entorno
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">Sube el GLB y quedas dentro, en el centro del modelo.</p>
          )}
        </Section>

        <Section title="IMAGEN 360">
          <button
            type="button"
            className="min-h-11 w-full rounded-md border border-border bg-surface-2 text-sm text-fg"
            onClick={() => skyRef.current?.click()}
          >
            Cargar imagen 360
          </button>
          <input
            ref={skyRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) pushCommand({ type: "sky", file });
            }}
          />
          {studio.sky ? (
            <>
              <p className="mt-2 truncate text-sm text-muted">{studio.sky.name}</p>
              <Slider
                label="Rotación"
                min={-180}
                max={180}
                step={1}
                value={studio.sky.rotation}
                display={`${Math.round(studio.sky.rotation)} °`}
                onChange={(rotation) => studio.patchSky({ rotation })}
              />
              <button
                type="button"
                className="mt-3 min-h-11 w-full rounded-md border border-border text-sm text-muted"
                onClick={() => pushCommand({ type: "sky-clear" })}
              >
                Quitar imagen
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Quedas dentro de la foto, como en Maps. Arrastra para mirar alrededor. Mientras está puesta, el GLB se oculta para que vaya más fluido.
            </p>
          )}
        </Section>

        <p className="font-mono text-xs leading-relaxed text-muted">
          cámara → mediapipe → manos → visor
        </p>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-xs text-muted">{label}</span>
      <input
        type="number"
        step={0.01}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-11 rounded-md border border-border bg-bg px-2 font-mono text-sm text-fg"
      />
    </label>
  );
}

function InspectorObject({ object }: { object: SceneObject }) {
  const updateObject = useStudio((state) => state.updateObject);
  const removeSelected = useStudio((state) => state.removeSelected);
  const setVector = (key: "position" | "rotation" | "scale", index: number, value: number) => {
    const next = [...object[key]] as [number, number, number];
    next[index] = value;
    updateObject(object.id, { [key]: next });
  };
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-mono text-xs text-muted">Nombre</span>
        <input
          value={object.name}
          onChange={(event) => updateObject(object.id, { name: event.target.value })}
          className="min-h-11 rounded-md border border-border bg-bg px-2 text-sm text-fg"
        />
      </label>
      <p className="font-mono text-xs text-muted">
        {object.kind} · {object.id}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <NumberField key={axis} label={`Pos ${axis}`} value={object.position[index] ?? 0} onChange={(value) => setVector("position", index, value)} />
        ))}
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <NumberField
            key={`r${axis}`}
            label={`Rot ${axis}`}
            value={((object.rotation[index] ?? 0) * 180) / Math.PI}
            onChange={(degrees) => setVector("rotation", index, (degrees * Math.PI) / 180)}
          />
        ))}
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <NumberField key={`s${axis}`} label={`Esc ${axis}`} value={object.scale[index] ?? 1} onChange={(value) => setVector("scale", index, value)} />
        ))}
      </div>
      <Toggle label="Visible" on={object.visible} onClick={() => updateObject(object.id, { visible: !object.visible })} />
      <Toggle label="Se puede agarrar" on={object.grabbable} onClick={() => updateObject(object.id, { grabbable: !object.grabbable })} />
      <button type="button" onClick={removeSelected} className="min-h-11 rounded-md border border-border text-sm text-hand-r">
        Eliminar
      </button>
    </div>
  );
}

function AnchorRow({ anchor }: { anchor: AnchorHud }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2">
      <div>
        <p className="text-sm text-fg">{anchor.label}</p>
        <p className="font-mono text-xs text-muted">{anchor.active ? anchor.source : "sin fuente"}</p>
      </div>
      <p className="text-right font-mono text-xs text-muted">
        {anchor.position
          ? `${anchor.position[0].toFixed(2)} ${anchor.position[1].toFixed(2)} ${anchor.position[2].toFixed(2)}`
          : "—"}
      </p>
    </div>
  );
}

function HandLine({ title, hand, tone }: { title: string; hand: HandHud | null; tone: string }) {
  return (
    <div className="border-b border-border py-2">
      <p className={`text-sm ${tone}`}>{title}</p>
      {hand ? (
        <p className="font-mono text-xs text-muted">
          {hand.pinch ? "PINCH" : "—"} · {hand.pointing ? "POINT" : "—"} · {(hand.confidence * 100).toFixed(0)}% ·{" "}
          {formatMeters(hand.pinchDistance)}
        </p>
      ) : (
        <p className="font-mono text-xs text-muted">no detectada</p>
      )}
    </div>
  );
}

export function RightPanel() {
  const selectedId = useStudio((state) => state.selectedId);
  const object = useStudio((state) => state.objects.find((item) => item.id === selectedId) ?? null);
  const report = useLive((state) => state.report);

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <Section title="INSPECTOR">
        {object ? <InspectorObject object={object} /> : <p className="text-sm text-muted">Nada seleccionado. Toca un objeto o pellizca cerca de él.</p>}
      </Section>
      <Section title="SEGUIMIENTO">
        <HandLine title="Izquierda" hand={report.left} tone="text-hand-l" />
        <HandLine title="Derecha" hand={report.right} tone="text-hand-r" />
      </Section>
      <Section title="PUNTOS">
        <p className="mb-2 text-sm text-muted">Puntos de la mano: muñeca, pulgar e índice.</p>
        {report.anchors.map((anchor) => (
          <AnchorRow key={anchor.id} anchor={anchor} />
        ))}
      </Section>
    </div>
  );
}

export function DebugHud() {
  const debug = useStudio((state) => state.debug);
  const report = useLive((state) => state.report);
  const recording = useLive((state) => state.recording);
  if (!debug) return null;
  const hovered = report.hoveredId ?? "—";
  const grabbed = report.grabbedId ? `${report.grabbedId} (${report.grabbingHand ?? "?"})` : "—";
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 max-w-40 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-fg sm:max-w-56">
      <p>FPS {report.fps.toFixed(0)}</p>
      <p>Latencia {report.latencyMs.toFixed(1)} ms</p>
      <p>Fuente {report.source}</p>
      <p>Detectadas {report.handCount}</p>
      <p className="text-hand-l">L {report.left ? `${report.left.pinch ? "PINCH" : "··"} ${report.left.pointing ? "POINT" : "··"}` : "—"}</p>
      <p className="text-hand-r">R {report.right ? `${report.right.pinch ? "PINCH" : "··"} ${report.right.pointing ? "POINT" : "··"}` : "—"}</p>
      <p>Hover {hovered}</p>
      <p>Agarre {grabbed}</p>
      <p>{recording ? "REC" : "en espera"}</p>
    </div>
  );
}

export function NoticeToast() {
  const notice = useLive((state) => state.notice);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => useLive.getState().setNotice(null), 4600);
    return () => window.clearTimeout(id);
  }, [notice]);
  if (!notice) return null;
  return (
    <p className="pointer-events-none absolute left-1/2 top-16 z-20 w-max max-w-[90%] -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg">
      {notice}
    </p>
  );
}
