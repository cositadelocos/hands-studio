import {
  ACESFilmicToneMapping,
  AxesHelper,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Vec3 } from "@/studio/math";
import { HAND_BONES, type InteractionSpace, type SceneObject, type Side, type TransformMode } from "@/studio/types";
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
  private readonly plinth: Mesh;
  private readonly wall: Mesh;
  private readonly grid: GridHelper;
  private readonly ring: Mesh;
  private readonly root: Group;
  private videoTexture: CanvasTexture | null = null;
  private videoRevision = -1;
  private objectRef: SceneObject[] | null = null;
  private spaceKey = "";
  private hoverId: string | null = null;
  private selectedId: string | null = null;
  private gizmoDragging = false;
  private pointerDown: { x: number; y: number; gizmo: boolean } | null = null;
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
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x0c0f12, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;

    this.camera = new PerspectiveCamera(38, 1, 0.05, 30);
    this.camera.position.set(0.22, 0.58, 1.38);

    const hemi = new HemisphereLight(0xd5e4ee, 0x1a140f, 0.85);
    const key = new DirectionalLight(0xfff3e4, 2.5);
    key.position.set(0.9, 2.4, 1.5);
    key.castShadow = false;
    const fill = new DirectionalLight(0x9fd8d4, 0.55);
    fill.position.set(-1.4, 1.1, 0.6);
    const rim = new DirectionalLight(0xe59a4a, 0.35);
    rim.position.set(0.2, 1.2, -1.6);

    this.floor = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshStandardMaterial({ color: 0x1a222a, roughness: 0.92, metalness: 0 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;

    this.plinth = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0x10161b, roughness: 0.96, metalness: 0 }),
    );
    this.plinth.receiveShadow = true;

    this.wall = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshStandardMaterial({ color: 0x141b21, roughness: 0.88, metalness: 0 }),
    );

    this.grid = new GridHelper(1.2, 12, 0x3c4a55, 0x243038);
    this.grid.position.y = 0.003;

    this.volume = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1, 1, 1)),
      new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 }),
    );

    this.landmarks = new InstancedMesh(
      new SphereGeometry(0.008, 12, 10),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
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
    const hitMaterial = new MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.4 });
    this.leftHit = new Mesh(new SphereGeometry(0.012, 12, 10), hitMaterial);
    this.rightHit = new Mesh(new SphereGeometry(0.012, 12, 10), hitMaterial.clone());
    this.leftHit.visible = false;
    this.rightHit.visible = false;
    this.leftAxes = new AxesHelper(0.07);
    this.rightAxes = new AxesHelper(0.07);
    this.leftAxes.visible = false;
    this.rightAxes.visible = false;

    this.ring = new Mesh(
      new TorusGeometry(0.12, 0.004, 8, 40),
      new MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.35 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;

    this.world.add(
      hemi,
      key,
      fill,
      rim,
      this.plinth,
      this.floor,
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
    this.orbit.target.set(0, 0.2, 0);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 0.4;
    this.orbit.maxDistance = 3.4;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.update();

    this.controls = new TransformControls(this.camera, canvas);
    this.controls.size = 0.75;
    this.scene.add(this.controls.getHelper());
    this.controls.addEventListener("dragging-changed", (event) => {
      this.gizmoDragging = Boolean(event.value);
      this.orbit.enabled = !this.gizmoDragging;
      if (!this.gizmoDragging) this.emitTransform();
    });

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY, gizmo: this.controls.axis !== null };
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
    this.camera.aspect = width / height;
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
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.controls.disconnect();
    this.controls.dispose();
    this.orbit.dispose();
    this.videoTexture?.dispose();
    for (const node of this.nodes.values()) this.disposeNode(node);
    this.renderer.dispose();
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
      if (this.boxA.min.y <= 0.02) this.sleeping.add(id);
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

    const resting = new Set<string>();
    for (let pass = 0; pass < 3; pass += 1) {
      for (const id of ids) {
        const node = this.nodes.get(id);
        if (!node?.visible || held.has(id) || this.sleeping.has(id)) continue;
        this.boxA.setFromObject(node);
        if (this.boxA.min.y < 0) {
          node.position.y -= this.boxA.min.y;
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
      const supported = this.boxA.min.y <= 0.012 || resting.has(id);
      if (supported && velocity.length() < 0.06) {
        velocity.set(0, 0, 0);
        this.sleeping.add(id);
        this.onRest?.(id, [node.position.x, node.position.y, node.position.z]);
      }
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
      this.plinth.scale.set(space.width + 0.14, 0.08, space.depth + 0.14);
      this.plinth.position.set(0, -0.04, space.offsetZ);
      this.wall.scale.set(space.width, space.height, 1);
      this.wall.position.set(0, space.height / 2, space.offsetZ - space.depth / 2 - 0.012);
      this.grid.scale.set(space.width / 1.2, 1, space.depth / 1.2);
      this.grid.position.set(0, 0.003, space.offsetZ);
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
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial && object.kind !== "model") {
          child.material.color.set(object.color);
        }
      });
    }
  }

  private createPrimitive(object: SceneObject): Mesh {
    const geometry =
      object.kind === "sphere"
        ? new SphereGeometry(0.5, 16, 12)
        : object.kind === "torus"
          ? new TorusGeometry(0.36, 0.13, 10, 20)
          : object.kind === "cylinder"
            ? new CylinderGeometry(0.42, 0.42, 1, 16)
            : new BoxGeometry(1, 1, 1);
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: object.color, roughness: 0.4, metalness: 0.08 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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
      if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
        child.material.emissive.setHex(hex);
      }
    });
  }

  private mountVideo(canvas: HTMLCanvasElement | null, show: boolean, revision: number): void {
    const material = this.wall.material as MeshStandardMaterial;
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
