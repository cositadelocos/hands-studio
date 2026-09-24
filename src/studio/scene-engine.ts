import {
  AxesHelper,
  BackSide,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Vec3 } from "@/studio/math";
import { HAND_BONES, STUDIO_EYE, TABLE_DEPTH, TABLE_TOP, TABLE_WIDTH, TABLE_Z, type InteractionSpace, type PanoramaSettings, type SceneObject, type Side, type SkyImage, type TransformMode } from "@/studio/types";
import type { RayHit } from "@/studio/interaction";

export interface HandView {
  points: Vec3[];
  rotation: [number, number, number, number] | null;
}

export interface RayView {
  origin: Vec3;
  direction: Vec3;
  hit: RayHit | null;
}

export interface TransformSnapshot {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface FrameView {
  objects: SceneObject[];
  selectedId: string | null;
  mode: TransformMode;
  space: InteractionSpace;
  showSpace: boolean;
  showLandmarks: boolean;
  showSkeleton: boolean;
  showVideo: boolean;
  debug: boolean;
  videoCanvas: HTMLCanvasElement | null;
  videoRevision: number;
  hands: Partial<Record<Side, HandView>>;
  rays: Partial<Record<Side, RayView>>;
  moves: { id: string; position: Vec3 }[];
  hoveredId: string | null;
  stayHere: boolean;
  eyeHeight: number;
  lookYaw: number;
  lookPitch: number;
  panorama: PanoramaSettings | null;
  sky: SkyImage | null;
}

const LEFT = 0x3dbeb6;
const RIGHT = 0xe07a5f;
const ACCENT = 0xe59a4a;

function boneLine(color: number): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(HAND_BONES.length * 6), 3));
  const line = new LineSegments(geometry, new LineBasicMaterial({ color }));
  line.frustumCulled = false;
  return line;
}

function rayLine(): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
  const line = new LineSegments(geometry, new LineBasicMaterial({ color: ACCENT }));
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

function writeSegment(line: LineSegments, a: Vec3, b: Vec3): void {
  const attribute = line.geometry.getAttribute("position") as BufferAttribute;
  const array = attribute.array as Float32Array;
  array[0] = a[0];
  array[1] = a[1];
  array[2] = a[2];
  array[3] = b[0];
  array[4] = b[1];
  array[5] = b[2];
  attribute.needsUpdate = true;
}

async function skyTexture(file: File): Promise<Texture> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const maxEdge = 2048;
  const source =
    longest <= maxEdge
      ? bitmap
      : await createImageBitmap(bitmap, {
          resizeWidth: bitmap.width >= bitmap.height ? maxEdge : Math.round((bitmap.width / bitmap.height) * maxEdge),
          resizeHeight: bitmap.height > bitmap.width ? maxEdge : Math.round((bitmap.height / bitmap.width) * maxEdge),
          resizeQuality: "high",
        });
  if (source !== bitmap) bitmap.close();
  const texture = new Texture(source);
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function uprightSphere(): SphereGeometry {
  const geometry = new SphereGeometry(16, 64, 32);
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) uv.setY(index, 1 - uv.getY(index));
  return geometry;
}

export class SceneEngine {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly world = new Group();
  private readonly camera: PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly controls: TransformControls;
  private readonly raycaster = new Raycaster();
  private readonly rayOrigin = new Vector3();
  private readonly rayDir = new Vector3();
  private readonly projected = new Vector3();
  private readonly pointer = new Vector2();
  private readonly nodes = new Map<string, Object3D>();
  private readonly landmarks: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly leftBones: LineSegments;
  private readonly rightBones: LineSegments;
  private readonly leftRay: LineSegments;
  private readonly rightRay: LineSegments;
  private readonly leftHit: Mesh;
  private readonly rightHit: Mesh;
  private readonly leftAxes: AxesHelper;
  private readonly rightAxes: AxesHelper;
  private readonly volume: LineSegments;
  private readonly floor: Mesh;
  private readonly table: Mesh;
  private readonly wall: Mesh;
  private readonly grid: GridHelper;
  private readonly ring: Mesh;
  private readonly room = new Group();
  private roomModel: Group | null = null;
  private roomFit = 1;
  private readonly photo: Mesh;
  private photoTexture: Texture | null = null;
  private stayHere = true;
  private viewAspect = 0;
  private yaw = 0;
  private pitch = -0.42;
  private lookX = 0;
  private lookY = 0;
  private readonly viewInverse = new Quaternion();
  private readonly scratch = new Vector3();
  private readonly root: Group;
  private videoTexture: CanvasTexture | null = null;
  private videoRevision = -1;
  private objectRef: SceneObject[] | null = null;
  private spaceKey = "";
  private hoverId: string | null = null;
  private selectedId: string | null = null;
  private gizmoDragging = false;
  private pointerDown: { x: number; y: number; gizmo: boolean } | null = null;
  onLook: ((yaw: number, pitch: number) => void) | null = null;
  onSelect: ((id: string | null) => void) | null = null;
  onTransform: ((id: string, transform: TransformSnapshot) => void) | null = null;
  onRest: ((id: string, position: Vec3) => void) | null = null;
  private readonly velocities = new Map<string, Vector3>();
  private readonly previous = new Map<string, Vector3>();
  private readonly sleeping = new Set<string>();
  private physicsStamp = 0;
  private readonly boxA = new Box3();
  private readonly boxB = new Box3();
  private readonly sizeA = new Vector3();
  private readonly sizeB = new Vector3();
  private readonly centerA = new Vector3();
  private readonly centerB = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.root = new Group();
    this.scene.background = new Color(0x0c0f12);
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x0c0f12, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;

    this.camera = new PerspectiveCamera(50, 1, 0.02, 80);
    this.camera.rotation.order = "YXZ";
    this.camera.position.set(0, STUDIO_EYE, 0);

    const hemi = new HemisphereLight(0xffffff, 0x8d8278, 1.4);
    const key = new DirectionalLight(0xfff6ea, 1.2);
    key.position.set(0.9, 2.4, 1.5);

    this.floor = new Mesh(new PlaneGeometry(1, 1, 1, 1), new MeshLambertMaterial({ color: 0x1a222a }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.visible = false;

    this.table = new Mesh(
      new BoxGeometry(TABLE_WIDTH, 0.08, TABLE_DEPTH),
      new MeshLambertMaterial({ color: 0xc4a574, emissive: 0x4a3724, emissiveIntensity: 0.35 }),
    );
    this.table.position.set(0, TABLE_TOP - 0.04, TABLE_Z);

    this.wall = new Mesh(new PlaneGeometry(1, 1, 1, 1), new MeshLambertMaterial({ color: 0x141b21 }));
    this.wall.visible = false;

    this.grid = new GridHelper(1.2, 6, 0x6b5844, 0x3d342c);
    this.grid.position.set(0, TABLE_TOP + 0.002, TABLE_Z);

    this.volume = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1, 1, 1)),
      new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 }),
    );

    this.landmarks = new InstancedMesh(
      new SphereGeometry(0.008, 4, 3),
      new MeshLambertMaterial({ color: 0xffffff }),
      42,
    );
    this.landmarks.frustumCulled = false;
    this.landmarks.castShadow = false;
    const tint = new Color();
    for (let index = 0; index < 42; index += 1) {
      this.landmarks.setColorAt(index, tint.setHex(index < 21 ? LEFT : RIGHT));
    }
    if (this.landmarks.instanceColor) this.landmarks.instanceColor.needsUpdate = true;

    this.leftBones = boneLine(LEFT);
    this.rightBones = boneLine(RIGHT);
    this.leftRay = rayLine();
    this.rightRay = rayLine();
    const hitMaterial = new MeshLambertMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.4 });
    this.leftHit = new Mesh(new SphereGeometry(0.012, 6, 4), hitMaterial);
    this.rightHit = new Mesh(new SphereGeometry(0.012, 6, 4), hitMaterial.clone());
    this.leftHit.visible = false;
    this.rightHit.visible = false;
    this.leftAxes = new AxesHelper(0.07);
    this.rightAxes = new AxesHelper(0.07);
    this.leftAxes.visible = false;
    this.rightAxes.visible = false;

    this.ring = new Mesh(
      new TorusGeometry(0.12, 0.004, 4, 12),
      new MeshLambertMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.35 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.room);
    this.photo = new Mesh(uprightSphere(), new MeshBasicMaterial({ color: 0xffffff, side: BackSide }));
    this.photo.frustumCulled = false;
    this.photo.visible = false;
    this.scene.add(this.photo);

    this.world.add(
      hemi,
      key,
      this.floor,
      this.table,
      this.wall,
      this.grid,
      this.volume,
      this.landmarks,
      this.leftBones,
      this.rightBones,
      this.leftRay,
      this.rightRay,
      this.leftHit,
      this.rightHit,
      this.leftAxes,
      this.rightAxes,
      this.ring,
    );
    this.root.add(this.world);
    this.scene.add(this.root);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, STUDIO_EYE, -0.8);
    this.orbit.enabled = false;
    this.orbit.enableDamping = false;
    this.orbit.minDistance = 0.2;
    this.orbit.maxDistance = 14;
    this.orbit.maxPolarAngle = Math.PI * 0.92;
    this.applyLook(STUDIO_EYE);

    this.controls = new TransformControls(this.camera, canvas);
    this.controls.size = 0.75;
    this.scene.add(this.controls.getHelper());
    this.controls.addEventListener("dragging-changed", (event) => {
      this.gizmoDragging = Boolean(event.value);
      this.orbit.enabled = !this.gizmoDragging && !this.stayHere;
      if (!this.gizmoDragging) this.emitTransform();
    });

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY, gizmo: this.controls.axis !== null };
    this.lookX = event.clientX;
    this.lookY = event.clientY;
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.stayHere || !this.pointerDown || this.pointerDown.gizmo || this.gizmoDragging) return;
    if ((event.buttons & 1) === 0) return;
    const dx = event.clientX - this.lookX;
    const dy = event.clientY - this.lookY;
    this.lookX = event.clientX;
    this.lookY = event.clientY;
    const yaw = Math.min(36, Math.max(-36, (this.yaw * 180) / Math.PI - dx * 0.2));
    const pitch = Math.min(20, Math.max(-24, ((this.pitch + 0.32) * 180) / Math.PI - dy * 0.16));
    this.onLook?.(yaw, pitch);
  };

  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.gizmo || this.gizmoDragging) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    this.onSelect?.(this.pick(event.clientX, event.clientY));
  };

  resize(width: number, height: number): void {
    if (width < 2 || height < 2) return;
    const aspect = width / height;
    if (width > 240 && !this.viewAspect) this.viewAspect = aspect;
    const base = this.viewAspect || aspect;
    const horizontal = 2 * Math.atan(Math.tan((74 * Math.PI) / 360) * base);
    this.camera.fov = (2 * Math.atan(Math.tan(horizontal / 2) / aspect) * 180) / Math.PI;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
    this.renderer.setSize(width, height, false);
  }

  pickThrough(point: Vec3): RayHit | null {
    this.projected.set(point[0], point[1], point[2]).project(this.camera);
    if (this.projected.x < -1.15 || this.projected.x > 1.15 || this.projected.y < -1.15 || this.projected.y > 1.15) {
      return null;
    }
    this.pointer.set(this.projected.x, this.projected.y);
    this.raycaster.far = 40;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.firstHit(this.raycaster.intersectObjects([...this.nodes.values()], true));
  }

  raycast(origin: Vec3, direction: Vec3): RayHit | null {
    this.raycaster.far = 1.5;
    this.rayOrigin.set(origin[0], origin[1], origin[2]);
    this.rayDir.set(direction[0], direction[1], direction[2]).normalize();
    this.raycaster.set(this.rayOrigin, this.rayDir);
    return this.firstHit(this.raycaster.intersectObjects([...this.nodes.values()], true));
  }

  readTransform(id: string): TransformSnapshot | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    return {
      position: [node.position.x, node.position.y, node.position.z],
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
      scale: [node.scale.x, node.scale.y, node.scale.z],
    };
  }

  async importModel(file: File): Promise<SceneObject> {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const url = URL.createObjectURL(file);
    try {
      const gltf = await loader.loadAsync(url);
      const group = new Group();
      group.add(gltf.scene);
      group.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(group);
      const size = bounds.getSize(new Vector3());
      const factor = 0.24 / Math.max(size.x, size.y, size.z, 1e-4);
      group.scale.setScalar(factor);
      group.updateMatrixWorld(true);
      const fitted = new Box3().setFromObject(group);
      group.position.set(0.04, -fitted.min.y, 0.05);
      const id = `model-${crypto.randomUUID().slice(0, 8)}`;
      this.tag(group, id);
      group.traverse((child) => {
        if (child instanceof Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.world.add(group);
      this.nodes.set(id, group);
      return {
        id,
        name: file.name.replace(/\.(glb|gltf)$/i, "") || "Modelo",
        kind: "model",
        position: [group.position.x, group.position.y, group.position.z],
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
        scale: [group.scale.x, group.scale.y, group.scale.z],
        visible: true,
        color: "#e59a4a",
        grabbable: true,
        selectable: true,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadPanorama(file: File): Promise<void> {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const url = URL.createObjectURL(file);
    try {
      const gltf = await loader.loadAsync(url);
      this.clearRoomModel();
      const model = gltf.scene;
      model.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.castShadow = false;
        child.receiveShadow = false;
        const source = Array.isArray(child.material) ? child.material : [child.material];
        const unlit = source.map((material) => {
          const painted = material as Material & { map?: MeshBasicMaterial["map"]; emissiveMap?: MeshBasicMaterial["map"]; color?: Color };
          const map = painted.map ?? painted.emissiveMap ?? null;
          const basic = new MeshBasicMaterial({
            map,
            color: map ? 0xffffff : (painted.color ?? 0xffffff),
            side: DoubleSide,
          });
          basic.toneMapped = false;
          material.dispose();
          return basic;
        });
        child.material = unlit.length === 1 ? unlit[0]! : unlit;
      });
      model.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      model.position.sub(center);
      const longest = Math.max(size.x, size.y, size.z, 1e-4);
      this.roomFit = 9 / longest;
      this.room.add(model);
      this.roomModel = model;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadSky(file: File): Promise<void> {
    const texture = await skyTexture(file);
    const previous = this.photoTexture;
    this.photoTexture = texture;
    const material = this.photo.material as MeshBasicMaterial;
    material.map = texture;
    material.needsUpdate = true;
    previous?.dispose();
    const image = previous?.image as { close?: () => void } | undefined;
    image?.close?.();
  }

  clearSky(): void {
    const image = this.photoTexture?.image as { close?: () => void } | undefined;
    this.photoTexture?.dispose();
    image?.close?.();
    this.photoTexture = null;
    const material = this.photo.material as MeshBasicMaterial;
    material.map = null;
    material.needsUpdate = true;
    this.photo.visible = false;
  }

  clearPanorama(): void {
    this.clearRoomModel();
    this.room.visible = false;
    this.wall.visible = false;
  }

  prepareView(eye: number, stay: boolean, lookYaw = 0, lookPitch = 0): void {
    if (stay) {
      this.yaw = (lookYaw * Math.PI) / 180;
      this.pitch = -0.32 + (lookPitch * Math.PI) / 180;
      this.applyLook(eye);
    }
    this.camera.updateMatrixWorld(true);
    this.viewInverse.copy(this.camera.quaternion).invert();
  }

  /** Camera-local point (x right, y up, -z forward) → world. */
  toWorld(local: Vec3): Vec3 {
    this.scratch.set(local[0], local[1], local[2]);
    this.scratch.applyQuaternion(this.camera.quaternion).add(this.camera.position);
    return [this.scratch.x, this.scratch.y, this.scratch.z];
  }

  toLocal(world: Vec3): Vec3 {
    this.scratch.set(world[0], world[1], world[2]).sub(this.camera.position).applyQuaternion(this.viewInverse);
    return [this.scratch.x, this.scratch.y, this.scratch.z];
  }

  aim(direction: Vec3): Vec3 {
    this.scratch.set(direction[0], direction[1], direction[2]).applyQuaternion(this.camera.quaternion);
    return [this.scratch.x, this.scratch.y, this.scratch.z];
  }

  projectToClient(point: Vec3): { x: number; y: number } | null {
    this.scratch.set(point[0], point[1], point[2]).project(this.camera);
    if (this.scratch.z < -1 || this.scratch.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (this.scratch.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-this.scratch.y * 0.5 + 0.5) * rect.height,
    };
  }

  frame(view: FrameView): void {
    this.layout(view.space, view.showSpace);
    if (view.objects !== this.objectRef) {
      this.syncObjects(view.objects);
      this.objectRef = view.objects;
    }
    this.controls.setMode(view.mode);
    this.drawHands(view);
    this.drawRay(this.leftRay, this.leftHit, view.rays.left);
    this.drawRay(this.rightRay, this.rightHit, view.rays.right);
    for (const move of view.moves) {
      const node = this.nodes.get(move.id);
      if (!node || (this.gizmoDragging && this.selectedId === move.id)) continue;
      node.position.set(move.position[0], move.position[1], move.position[2]);
    }
    this.simulate(view.moves.map((move) => move.id));
    this.applySelection(view.selectedId);
    this.paintHover(view.hoveredId);
    this.mountVideo(view.videoCanvas, view.showVideo, view.videoRevision);
    this.placeSky(view.panorama);
    if (view.stayHere) {
      this.stayHere = true;
      this.orbit.enabled = false;
      this.applyLook(view.eyeHeight);
    } else {
      if (this.stayHere) this.releaseLook();
      this.stayHere = false;
      if (!this.gizmoDragging) this.orbit.enabled = true;
      this.orbit.update();
    }
    this.placePhoto(view.sky);
    if (this.photo.visible) this.room.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.controls.disconnect();
    this.controls.dispose();
    this.orbit.dispose();
    this.videoTexture?.dispose();
    this.photoTexture?.dispose();
    this.clearRoomModel();
    for (const node of this.nodes.values()) this.disposeNode(node);
    this.renderer.dispose();
  }

  private applyLook(eye: number): void {
    this.camera.position.set(0, eye, this.floor.position.z);
    this.camera.rotation.set(this.pitch, -this.yaw, 0);
  }

  private releaseLook(): void {
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.orbit.target.copy(this.camera.position).addScaledVector(forward, 0.8);
  }

  private placeSky(panorama: PanoramaSettings | null): void {
    const photoOn = this.photo.visible;
    const show = Boolean(panorama && this.roomModel && !photoOn);
    this.room.visible = show;
    this.wall.visible = false;
    this.floor.visible = false;
    if (!panorama || !show) return;
    this.room.position.set(panorama.position[0], panorama.position[1], panorama.position[2]);
    this.room.scale.setScalar(Math.max(0.01, panorama.scale) * this.roomFit);
    this.room.rotation.y = (panorama.rotation * Math.PI) / 180;
  }

  private placePhoto(sky: SkyImage | null): void {
    const show = Boolean(sky && this.photoTexture);
    this.photo.visible = show;
    if (!sky || !show) return;
    this.photo.position.copy(this.camera.position);
    this.photo.rotation.y = (sky.rotation * Math.PI) / 180;
    this.room.visible = false;
  }

  private clearRoomModel(): void {
    if (!this.roomModel) return;
    this.room.remove(this.roomModel);
    this.roomModel.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const map = (material as { map?: { dispose: () => void } }).map;
        map?.dispose();
        material.dispose();
      }
    });
    this.roomModel = null;
    this.roomFit = 1;
  }

  private velocityOf(id: string): Vector3 {
    let velocity = this.velocities.get(id);
    if (!velocity) {
      velocity = new Vector3();
      this.velocities.set(id, velocity);
    }
    return velocity;
  }

  private remember(id: string, node: Object3D): Vector3 {
    let previous = this.previous.get(id);
    if (!previous) {
      previous = node.position.clone();
      this.previous.set(id, previous);
      this.boxA.setFromObject(node);
      if (this.boxA.min.y <= TABLE_TOP + 0.02) this.sleeping.add(id);
    }
    return previous;
  }

  /** Gravity, floor, and solid-vs-solid collisions. Held pieces are kinematic. */
  private simulate(heldIds: string[]): void {
    const now = performance.now();
    const dt = Math.min(0.033, this.physicsStamp ? (now - this.physicsStamp) / 1000 : 0.016);
    this.physicsStamp = now;
    const held = new Set(heldIds);
    if (this.gizmoDragging && this.selectedId) held.add(this.selectedId);
    const ids = [...this.nodes.keys()];

    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node?.visible) continue;
      const velocity = this.velocityOf(id);
      const previous = this.remember(id, node);
      if (held.has(id)) {
        velocity.set(node.position.x - previous.x, node.position.y - previous.y, node.position.z - previous.z);
        velocity.multiplyScalar(1 / Math.max(dt, 1 / 120));
        if (velocity.length() > 3.2) velocity.setLength(3.2);
        this.sleeping.delete(id);
      } else if (!this.sleeping.has(id)) {
        velocity.y -= 12 * dt;
        node.position.addScaledVector(velocity, dt);
      }
      previous.copy(node.position);
    }
    const moving = ids.some((id) => !held.has(id) && !this.sleeping.has(id) && this.nodes.get(id)?.visible);
    if (!moving && held.size === 0) return;
    this.keepOnTable(held);

    const resting = new Set<string>();
    for (let pass = 0; pass < 3; pass += 1) {
      for (const id of ids) {
        const node = this.nodes.get(id);
        if (!node?.visible || held.has(id) || this.sleeping.has(id)) continue;
        this.boxA.setFromObject(node);
        if (this.boxA.min.y < TABLE_TOP) {
          node.position.y += TABLE_TOP - this.boxA.min.y;
          const velocity = this.velocityOf(id);
          velocity.y = velocity.y < -0.45 ? -velocity.y * 0.12 : 0;
          velocity.x *= 0.86;
          velocity.z *= 0.86;
          resting.add(id);
        }
      }
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          this.collide(ids[i]!, ids[j]!, held, resting);
        }
      }
    }

    for (const id of ids) {
      if (held.has(id) || this.sleeping.has(id)) continue;
      const node = this.nodes.get(id);
      if (!node?.visible) continue;
      const velocity = this.velocityOf(id);
      this.boxA.setFromObject(node);
      const supported = this.boxA.min.y <= TABLE_TOP + 0.02 || resting.has(id);
      if (supported && velocity.length() < 0.06) {
        velocity.set(0, 0, 0);
        this.sleeping.add(id);
        this.onRest?.(id, [node.position.x, node.position.y, node.position.z]);
      }
    }
  }

  private keepOnTable(held: Set<string>): void {
    const maxX = TABLE_WIDTH * 0.5;
    const maxZ = TABLE_DEPTH * 0.5;
    const z0 = this.table.position.z;
    for (const [id, node] of this.nodes) {
      if (!node.visible || held.has(id)) continue;
      this.boxA.setFromObject(node);
      let dx = 0;
      let dy = 0;
      let dz = 0;
      if (this.boxA.max.x > maxX) dx = maxX - this.boxA.max.x;
      else if (this.boxA.min.x < -maxX) dx = -maxX - this.boxA.min.x;
      if (this.boxA.max.z > z0 + maxZ) dz = z0 + maxZ - this.boxA.max.z;
      else if (this.boxA.min.z < z0 - maxZ) dz = z0 - maxZ - this.boxA.min.z;
      if (this.boxA.min.y < TABLE_TOP) dy = TABLE_TOP - this.boxA.min.y;
      if (!dx && !dy && !dz) continue;
      node.position.x += dx;
      node.position.y += dy;
      node.position.z += dz;
      const velocity = this.velocityOf(id);
      if (dx) velocity.x = 0;
      if (dy) velocity.y = 0;
      if (dz) velocity.z = 0;
    }
  }

  private collide(aId: string, bId: string, held: Set<string>, resting: Set<string>): void {
    const a = this.nodes.get(aId);
    const b = this.nodes.get(bId);
    if (!a?.visible || !b?.visible) return;
    if ((held.has(aId) || this.sleeping.has(aId)) && (held.has(bId) || this.sleeping.has(bId))) return;
    this.boxA.setFromObject(a);
    this.boxB.setFromObject(b);
    if (!this.boxA.intersectsBox(this.boxB)) return;
    this.boxA.getSize(this.sizeA);
    this.boxB.getSize(this.sizeB);
    this.boxA.getCenter(this.centerA);
    this.boxB.getCenter(this.centerB);
    const dx = this.centerB.x - this.centerA.x;
    const dy = this.centerB.y - this.centerA.y;
    const dz = this.centerB.z - this.centerA.z;
    const px = (this.sizeA.x + this.sizeB.x) * 0.5 - Math.abs(dx);
    const py = (this.sizeA.y + this.sizeB.y) * 0.5 - Math.abs(dy);
    const pz = (this.sizeA.z + this.sizeB.z) * 0.5 - Math.abs(dz);
    if (px <= 0 || py <= 0 || pz <= 0) return;
    const axis = px < py && px < pz ? 0 : py < pz ? 1 : 2;
    const delta = axis === 0 ? dx : axis === 1 ? dy : dz;
    const sign = delta < 0 ? -1 : 1;
    const pen = axis === 0 ? px : axis === 1 ? py : pz;
    const aHeld = held.has(aId);
    const bHeld = held.has(bId);
    const shift = (node: Object3D, amount: number) => {
      if (axis === 0) node.position.x += amount;
      else if (axis === 1) node.position.y += amount;
      else node.position.z += amount;
    };
    if (!aHeld && !bHeld) {
      shift(a, -sign * pen * 0.5);
      shift(b, sign * pen * 0.5);
      this.sleeping.delete(aId);
      this.sleeping.delete(bId);
    } else if (!aHeld) {
      shift(a, -sign * pen);
      this.sleeping.delete(aId);
      this.shove(aId, bId, axis);
    } else if (!bHeld) {
      shift(b, sign * pen);
      this.sleeping.delete(bId);
      this.shove(bId, aId, axis);
    }
    if (axis === 1) {
      const upperId = dy >= 0 ? bId : aId;
      const upperVel = this.velocityOf(upperId);
      if (!held.has(upperId) && upperVel.y < 0) upperVel.y = upperVel.y < -0.4 ? -upperVel.y * 0.1 : 0;
      resting.add(upperId);
      return;
    }
    const aVel = this.velocityOf(aId);
    const bVel = this.velocityOf(bId);
    if (!aHeld) {
      if (axis === 0) aVel.x *= -0.2;
      else aVel.z *= -0.2;
    }
    if (!bHeld) {
      if (axis === 0) bVel.x *= -0.2;
      else bVel.z *= -0.2;
    }
  }

  private shove(targetId: string, sourceId: string, axis: number): void {
    const source = this.velocityOf(sourceId);
    const target = this.velocityOf(targetId);
    if (axis === 0) target.x = source.x;
    else if (axis === 2) target.z = source.z;
  }

  private emitTransform(): void {
    if (!this.selectedId) return;
    const transform = this.readTransform(this.selectedId);
    if (transform) this.onTransform?.(this.selectedId, transform);
  }

  private tag(node: Object3D, id: string): void {
    node.userData.sceneId = id;
    node.traverse((child) => {
      child.userData.sceneId = id;
    });
  }

  private layout(space: InteractionSpace, showSpace: boolean): void {
    const key = `${space.width.toFixed(3)}|${space.height.toFixed(3)}|${space.depth.toFixed(3)}|${space.offsetZ.toFixed(3)}`;
    if (key !== this.spaceKey) {
      this.spaceKey = key;
      this.floor.scale.set(space.width, space.depth, 1);
      this.floor.position.set(0, 0, space.offsetZ);
      this.table.position.set(0, TABLE_TOP - 0.04, space.offsetZ + TABLE_Z);
      this.wall.scale.set(space.width, space.height, 1);
      this.wall.position.set(0, space.height / 2, space.offsetZ - space.depth / 2 - 0.012);
      this.grid.scale.set(TABLE_WIDTH / 1.2, 1, TABLE_DEPTH / 1.2);
      this.grid.position.set(0, TABLE_TOP + 0.002, space.offsetZ + TABLE_Z);
      this.volume.geometry.dispose();
      this.volume.geometry = new EdgesGeometry(new BoxGeometry(space.width, space.height, space.depth));
      this.volume.position.set(0, space.height / 2, space.offsetZ);
    }
    this.volume.visible = showSpace;
  }

  private syncObjects(objects: SceneObject[]): void {
    const ids = new Set(objects.map((object) => object.id));
    for (const [id, node] of this.nodes) {
      if (ids.has(id)) continue;
      this.world.remove(node);
      this.disposeNode(node);
      this.nodes.delete(id);
      this.velocities.delete(id);
      this.previous.delete(id);
      this.sleeping.delete(id);
      if (this.selectedId === id) this.controls.detach();
    }
    for (const object of objects) {
      let node = this.nodes.get(object.id);
      if (!node) {
        if (object.kind === "model") continue;
        node = this.createPrimitive(object);
        this.world.add(node);
        this.nodes.set(object.id, node);
      }
      const skip = this.gizmoDragging && this.selectedId === object.id;
      if (!skip) {
        const jumped =
          (node.position.x - object.position[0]) ** 2 +
          (node.position.y - object.position[1]) ** 2 +
          (node.position.z - object.position[2]) ** 2;
        if (jumped > 1e-6) {
          node.position.set(object.position[0], object.position[1], object.position[2]);
          this.velocityOf(object.id).set(0, 0, 0);
          this.previous.get(object.id)?.copy(node.position);
          this.sleeping.add(object.id);
        }
        node.rotation.set(object.rotation[0], object.rotation[1], object.rotation[2]);
        node.scale.set(object.scale[0], object.scale[1], object.scale[2]);
      }
      node.visible = object.visible;
      node.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshLambertMaterial && object.kind !== "model") {
          child.material.color.set(object.color);
        }
      });
    }
  }

  private createPrimitive(object: SceneObject): Mesh {
    const geometry =
      object.kind === "sphere"
        ? new SphereGeometry(0.5, 8, 6)
        : object.kind === "torus"
          ? new TorusGeometry(0.36, 0.13, 6, 10)
          : object.kind === "cylinder"
            ? new CylinderGeometry(0.42, 0.42, 1, 8)
            : new BoxGeometry(1, 1, 1);
    const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: object.color }));
    this.tag(mesh, object.id);
    return mesh;
  }

  private drawHands(view: FrameView): void {
    this.landmarks.visible = view.showLandmarks;
    this.placeHand(view.hands.left, 0, this.leftBones, this.leftAxes, view);
    this.placeHand(view.hands.right, 21, this.rightBones, this.rightAxes, view);
    this.landmarks.instanceMatrix.needsUpdate = true;
  }

  private placeHand(
    hand: HandView | undefined,
    offset: number,
    bones: LineSegments,
    axes: AxesHelper,
    view: FrameView,
  ): void {
    const positions = (bones.geometry.getAttribute("position") as BufferAttribute).array as Float32Array;
    if (!hand) {
      bones.visible = false;
      axes.visible = false;
      for (let index = 0; index < 21; index += 1) {
        this.dummy.position.set(0, -4, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.landmarks.setMatrixAt(offset + index, this.dummy.matrix);
      }
      return;
    }
    hand.points.forEach((point, index) => {
      const wrist = index % 21 === 0;
      this.dummy.position.set(point[0], point[1], point[2]);
      this.dummy.scale.setScalar(wrist ? 1.55 : 1);
      this.dummy.updateMatrix();
      this.landmarks.setMatrixAt(offset + index, this.dummy.matrix);
    });
    let cursor = 0;
    for (const [a, b] of HAND_BONES) {
      const pa = hand.points[a];
      const pb = hand.points[b];
      if (!pa || !pb) continue;
      positions[cursor++] = pa[0];
      positions[cursor++] = pa[1];
      positions[cursor++] = pa[2];
      positions[cursor++] = pb[0];
      positions[cursor++] = pb[1];
      positions[cursor++] = pb[2];
    }
    (bones.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    bones.visible = view.showSkeleton;
    const wrist = hand.points[0];
    axes.visible = view.debug && Boolean(wrist);
    if (wrist && hand.rotation) {
      axes.position.set(wrist[0], wrist[1], wrist[2]);
      axes.quaternion.set(hand.rotation[0], hand.rotation[1], hand.rotation[2], hand.rotation[3]);
    }
  }

  private drawRay(line: LineSegments, marker: Mesh, ray: RayView | undefined): void {
    if (!ray) {
      line.visible = false;
      marker.visible = false;
      return;
    }
    const end: Vec3 = ray.hit
      ? ray.hit.point
      : [
          ray.origin[0] + ray.direction[0] * 0.9,
          ray.origin[1] + ray.direction[1] * 0.9,
          ray.origin[2] + ray.direction[2] * 0.9,
        ];
    writeSegment(line, ray.origin, end);
    line.visible = true;
    (line.material as LineBasicMaterial).color.setHex(ray.hit ? ACCENT : 0x8d9aa3);
    marker.visible = Boolean(ray.hit);
    if (ray.hit) marker.position.set(ray.hit.point[0], ray.hit.point[1], ray.hit.point[2]);
  }

  private applySelection(id: string | null): void {
    this.selectedId = id;
    const node = id ? this.nodes.get(id) : undefined;
    if (!node?.visible) {
      this.controls.detach();
      this.ring.visible = false;
      return;
    }
    if (this.controls.object !== node) this.controls.attach(node);
    this.ring.visible = true;
    this.ring.position.set(node.position.x, 0.006, node.position.z);
    const span = Math.max(node.scale.x, node.scale.z, 0.15);
    this.ring.scale.setScalar(Math.max(0.7, span / 0.16));
  }

  private paintHover(id: string | null): void {
    if (this.hoverId === id) return;
    this.setEmissive(this.hoverId, 0x000000);
    this.hoverId = id;
    if (id && id !== this.selectedId) this.setEmissive(id, 0x5c3d16);
  }

  private setEmissive(id: string | null, hex: number): void {
    const node = id ? this.nodes.get(id) : undefined;
    node?.traverse((child) => {
      if (child instanceof Mesh && child.material instanceof MeshLambertMaterial) {
        child.material.emissive.setHex(hex);
      }
    });
  }

  private mountVideo(canvas: HTMLCanvasElement | null, show: boolean, revision: number): void {
    const material = this.wall.material as MeshLambertMaterial;
    if (!show || !canvas) {
      if (material.map) {
        material.map = null;
        material.color.setHex(0x141b21);
        material.needsUpdate = true;
      }
      return;
    }
    if (!this.videoTexture) {
      this.videoTexture = new CanvasTexture(canvas);
      this.videoTexture.colorSpace = SRGBColorSpace;
    } else if (this.videoTexture.image !== canvas) {
      this.videoTexture.image = canvas;
    }
    const changed = revision !== this.videoRevision;
    this.videoRevision = revision;
    if (changed) this.videoTexture.needsUpdate = true;
    if (material.map !== this.videoTexture) {
      material.map = this.videoTexture;
      material.color.setHex(0xffffff);
      material.needsUpdate = true;
    }
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.far = 20;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.firstHit(this.raycaster.intersectObjects([...this.nodes.values()], true))?.id ?? null;
  }

  private firstHit(hits: { object: Object3D; point: Vector3; distance: number }[]): RayHit | null {
    for (const hit of hits) {
      let node: Object3D | null = hit.object;
      while (node) {
        const id = node.userData.sceneId as string | undefined;
        if (id && this.nodes.get(id)?.visible) {
          return { id, point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance };
        }
        node = node.parent;
      }
    }
    return null;
  }

  private disposeNode(node: Object3D): void {
    node.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
