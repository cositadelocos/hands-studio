import { Bone, Group, Matrix4, Quaternion, SkinnedMesh, Vector3 } from "three";
import type { Vec3 } from "@/studio/math";

/** Mixamo right-hand bone → MediaPipe landmark pair it should point along. */
const LINKS: { name: string; from: number; to: number }[] = [
  { name: "mixamorig:RightHandThumb1", from: 1, to: 2 },
  { name: "mixamorig:RightHandThumb2", from: 2, to: 3 },
  { name: "mixamorig:RightHandThumb3", from: 3, to: 4 },
  { name: "mixamorig:RightHandIndex1", from: 5, to: 6 },
  { name: "mixamorig:RightHandIndex2", from: 6, to: 7 },
  { name: "mixamorig:RightHandIndex3", from: 7, to: 8 },
  { name: "mixamorig:RightHandMiddle1", from: 9, to: 10 },
  { name: "mixamorig:RightHandMiddle2", from: 10, to: 11 },
  { name: "mixamorig:RightHandMiddle3", from: 11, to: 12 },
  { name: "mixamorig:RightHandRing1", from: 13, to: 14 },
  { name: "mixamorig:RightHandRing2", from: 14, to: 15 },
  { name: "mixamorig:RightHandRing3", from: 15, to: 16 },
  { name: "mixamorig:RightHandPinky1", from: 17, to: 18 },
  { name: "mixamorig:RightHandPinky2", from: 18, to: 19 },
  { name: "mixamorig:RightHandPinky3", from: 19, to: 20 },
];

const PALM = "mixamorig:RightHand";

interface RestBone {
  quat: Quaternion;
  localDir: Vector3;
}

/**
 * Skinned Mixamo right hand. The palm follows the wrist basis and each
 * finger bone points at the next MediaPipe landmark.
 */
export class RightHandRig {
  readonly root = new Group();
  ready = false;
  private readonly bones = new Map<string, Bone>();
  private readonly rest = new Map<string, RestBone>();
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
      if ((obj as Bone).isBone) this.bones.set(obj.name, obj as Bone);
      if ((obj as SkinnedMesh).isSkinnedMesh) {
        const mesh = obj as SkinnedMesh;
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
    const tip = this.bones.get("mixamorig:RightHandMiddle4");
    if (wrist && tip) {
      wrist.getWorldPosition(this.x);
      tip.getWorldPosition(this.y);
      this.restLength = Math.max(0.05, this.x.distanceTo(this.y));
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
    const desired = Math.min(2.2, Math.max(0.25, length / this.restLength));
    if (!this.sized) {
      this.shownScale = desired;
      this.sized = true;
    } else {
      this.shownScale += (desired - this.shownScale) * 0.4;
    }
    this.root.scale.setScalar(this.shownScale);
    this.aimPalm(points);
    for (const link of LINKS) this.aimLink(link.name, points[link.from], points[link.to]);
    this.root.updateMatrixWorld(true);
    this.pin(points[0]);
  }

  /** Local +Y toward the middle knuckle, local +X toward the thumb side. */
  private aimPalm(points: Vec3[]): void {
    const bone = this.bones.get(PALM);
    if (!bone?.parent) return;
    this.y.set(points[9][0] - points[0][0], points[9][1] - points[0][1], points[9][2] - points[0][2]);
    this.x.set(points[5][0] - points[17][0], points[5][1] - points[17][1], points[5][2] - points[17][2]);
    if (this.y.lengthSq() < 1e-8 || this.x.lengthSq() < 1e-8) return;
    this.y.normalize();
    this.x.normalize();
    this.z.crossVectors(this.x, this.y);
    if (this.z.lengthSq() < 1e-8) return;
    this.z.normalize();
    this.x.crossVectors(this.y, this.z).normalize();
    this.basis.makeBasis(this.x, this.y, this.z);
    this.worldQuat.setFromRotationMatrix(this.basis);
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(this.parentQuat);
    bone.quaternion.copy(this.parentQuat.invert()).multiply(this.worldQuat);
    bone.updateMatrixWorld(true);
  }

  private aimLink(name: string, from: Vec3 | undefined, to: Vec3 | undefined): void {
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!bone?.parent || !rest || !from || !to) return;
    this.dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    if (this.dir.lengthSq() < 1e-8) return;
    this.dir.normalize();
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(this.parentQuat);
    this.dir.applyQuaternion(this.parentQuat.invert());
    this.restDir.copy(rest.localDir).applyQuaternion(rest.quat);
    if (this.restDir.lengthSq() < 1e-8 || this.dir.lengthSq() < 1e-8) return;
    this.delta.setFromUnitVectors(this.restDir.normalize(), this.dir.normalize());
    bone.quaternion.copy(this.delta).multiply(rest.quat);
    bone.updateMatrixWorld(true);
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
