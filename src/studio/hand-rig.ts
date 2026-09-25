import { Bone, DoubleSide, Group, Matrix4, MeshBasicMaterial, Quaternion, SkinnedMesh, Vector3 } from "three";
import type { Vec3 } from "@/studio/math";

/** Mixamo right-hand bone → MediaPipe landmark pair it should point along. */
const LINKS: { name: string; from: number; to: number }[] = [
  { name: "mixamorigRightHandThumb1", from: 1, to: 2 },
  { name: "mixamorigRightHandThumb2", from: 2, to: 3 },
  { name: "mixamorigRightHandThumb3", from: 3, to: 4 },
  { name: "mixamorigRightHandIndex1", from: 5, to: 6 },
  { name: "mixamorigRightHandIndex2", from: 6, to: 7 },
  { name: "mixamorigRightHandIndex3", from: 7, to: 8 },
  { name: "mixamorigRightHandMiddle1", from: 9, to: 10 },
  { name: "mixamorigRightHandMiddle2", from: 10, to: 11 },
  { name: "mixamorigRightHandMiddle3", from: 11, to: 12 },
  { name: "mixamorigRightHandRing1", from: 13, to: 14 },
  { name: "mixamorigRightHandRing2", from: 14, to: 15 },
  { name: "mixamorigRightHandRing3", from: 15, to: 16 },
  { name: "mixamorigRightHandPinky1", from: 17, to: 18 },
  { name: "mixamorigRightHandPinky2", from: 18, to: 19 },
  { name: "mixamorigRightHandPinky3", from: 19, to: 20 },
];

const PALM = "mixamorigRightHand";

interface RestBone {
  quat: Quaternion;
  localDir: Vector3;
}

/**
 * Skinned Mixamo right hand. The whole model is placed on the wrist,
 * then each finger bone points at the next MediaPipe landmark.
 */
export class RightHandRig {
  readonly root = new Group();
  ready = false;
  private readonly bones = new Map<string, Bone>();
  private readonly rest = new Map<string, RestBone>();
  private readonly restWrist = new Vector3();
  private readonly restBasis = new Quaternion();
  private restLength = 0.2;
  private shownScale = 1;
  private sized = false;
  private readonly x = new Vector3();
  private readonly y = new Vector3();
  private readonly z = new Vector3();
  private readonly dir = new Vector3();
  private readonly restDir = new Vector3();
  private readonly parentQuat = new Quaternion();
  private readonly worldQuat = new Quaternion();
  private readonly delta = new Quaternion();
  private readonly basis = new Matrix4();

  async load(url: string): Promise<void> {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(url);
    this.root.add(gltf.scene);
    gltf.scene.traverse((obj) => {
      obj.frustumCulled = false;
      if ((obj as Bone).isBone) {
        this.bones.set(obj.name, obj as Bone);
        this.bones.set(obj.name.replace(/[^A-Za-z0-9_]/g, ""), obj as Bone);
      }
      if ((obj as SkinnedMesh).isSkinnedMesh) {
        const mesh = obj as SkinnedMesh;
        const previous = mesh.material as MeshBasicMaterial;
        mesh.material = new MeshBasicMaterial({
          map: previous?.map ?? null,
          color: previous?.map ? 0xffffff : 0xffc9b0,
          side: DoubleSide,
        });
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    this.root.updateMatrixWorld(true);
    for (const [name, bone] of this.bones) {
      const child = bone.children.find((item) => (item as Bone).isBone) as Bone | undefined;
      const localDir = child ? child.position.clone() : new Vector3(0, 1, 0);
      if (localDir.lengthSq() < 1e-8) localDir.set(0, 1, 0);
      localDir.normalize();
      this.rest.set(name, { quat: bone.quaternion.clone(), localDir });
    }
    const wrist = this.bones.get(PALM);
    const mid = this.bones.get("mixamorigRightHandMiddle1");
    const index = this.bones.get("mixamorigRightHandIndex1");
    const pinky = this.bones.get("mixamorigRightHandPinky1");
    const tip = this.bones.get("mixamorigRightHandMiddle4");
    if (wrist && mid && index && pinky && tip) {
      wrist.getWorldPosition(this.restWrist);
      mid.getWorldPosition(this.y);
      index.getWorldPosition(this.x);
      pinky.getWorldPosition(this.z);
      tip.getWorldPosition(this.dir);
      this.restLength = Math.max(0.02, this.restWrist.distanceTo(this.dir));
      this.y.sub(this.restWrist);
      this.x.sub(this.z);
      this.compose(this.x, this.y, this.restBasis);
    }
    this.ready = this.bones.has(PALM);
    this.root.visible = false;
  }

  pose(points: Vec3[] | undefined): void {
    if (!this.ready) return;
    if (!points || points.length < 21) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const length = Math.hypot(
      points[12][0] - points[0][0],
      points[12][1] - points[0][1],
      points[12][2] - points[0][2],
    );
    const desired = Math.min(4, Math.max(0.05, (length / this.restLength) * 1.08));
    if (!this.sized) {
      this.shownScale = desired;
      this.sized = true;
    } else {
      this.shownScale += (desired - this.shownScale) * 0.45;
    }
    this.placeRoot(points);
    for (let step = 0; step < 3; step += 1) {
      for (let index = step; index < LINKS.length; index += 3) {
        const link = LINKS[index];
        this.aimLink(link.name, points[link.from], points[link.to]);
      }
      this.root.updateMatrixWorld(true);
    }
    this.pin(points[0]);
    this.root.updateMatrixWorld(true);
  }

  /** Move the whole bind-pose hand onto the wrist before the fingers curl. */
  private placeRoot(points: Vec3[]): void {
    this.y.set(points[9][0] - points[0][0], points[9][1] - points[0][1], points[9][2] - points[0][2]);
    this.x.set(points[17][0] - points[5][0], points[17][1] - points[5][1], points[17][2] - points[5][2]);
    if (this.y.lengthSq() < 1e-8 || this.x.lengthSq() < 1e-8) return;
    this.compose(this.x, this.y, this.worldQuat);
    this.delta.copy(this.restBasis).invert();
    this.root.quaternion.copy(this.worldQuat).multiply(this.delta);
    this.root.scale.setScalar(this.shownScale);
    this.z.copy(this.restWrist).multiplyScalar(this.shownScale).applyQuaternion(this.root.quaternion);
    this.root.position.set(points[0][0] - this.z.x, points[0][1] - this.z.y, points[0][2] - this.z.z);
    this.root.updateMatrixWorld(true);
  }

  private compose(across: Vector3, finger: Vector3, out: Quaternion): void {
    this.dir.copy(finger).normalize();
    this.restDir.copy(across).normalize();
    this.parentQuat.set(0, 0, 0, 1);
    const z = this.z;
    z.crossVectors(this.restDir, this.dir);
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
    else z.normalize();
    this.restDir.crossVectors(this.dir, z).normalize();
    this.basis.makeBasis(this.restDir, this.dir, z);
    out.setFromRotationMatrix(this.basis);
  }

  private aimLink(name: string, from: Vec3 | undefined, to: Vec3 | undefined): void {
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!bone?.parent || !rest || !from || !to) return;
    this.dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    if (this.dir.lengthSq() < 1e-8) return;
    this.dir.normalize();
    bone.parent.getWorldQuaternion(this.parentQuat);
    this.dir.applyQuaternion(this.parentQuat.invert());
    this.restDir.copy(rest.localDir).applyQuaternion(rest.quat);
    if (this.restDir.lengthSq() < 1e-8 || this.dir.lengthSq() < 1e-8) return;
    this.delta.setFromUnitVectors(this.restDir.normalize(), this.dir.normalize());
    bone.quaternion.copy(this.delta).multiply(rest.quat);
  }

  private pin(wrist: Vec3): void {
    const bone = this.bones.get(PALM);
    if (!bone) return;
    bone.getWorldPosition(this.x);
    this.root.position.x += wrist[0] - this.x.x;
    this.root.position.y += wrist[1] - this.x.y;
    this.root.position.z += wrist[2] - this.x.z;
  }
}
