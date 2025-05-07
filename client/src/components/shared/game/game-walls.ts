// utils/walls.ts
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { PLAY_AREA, WALL_THICKNESS } from "./game-config";

export type EulerRotation = { x: number; y: number; z: number };

// Changed to true to make walls visible for debugging
const SHOW_WALL_OUTLINES = true;

export const createPhysicsWall = (
  world: CANNON.World,
  position: CANNON.Vec3,
  halfExtents: CANNON.Vec3,
  rotation?: EulerRotation,
  wallMaterial?: CANNON.Material
) => {
  const wallShape = new CANNON.Box(halfExtents);
  const wallBody = new CANNON.Body({
    mass: 0,
    shape: wallShape,
    position,
    material: wallMaterial,
  });
  if (rotation) {
    wallBody.quaternion.setFromEuler(rotation.x, rotation.y, rotation.z);
  }
  world.addBody(wallBody);
};

export const createVisualWall = (
  scene: THREE.Scene,
  position: CANNON.Vec3,
  halfExtents: CANNON.Vec3,
  rotation?: EulerRotation
) => {
  // Создаем только контур стен – красные линии, без заполненной поверхности
  const width = halfExtents.x * 2;
  const height = halfExtents.y * 2;
  const depth = halfExtents.z * 2;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
  const line = new THREE.LineSegments(edges, material);

  line.position.set(position.x, position.y, position.z);
  if (rotation) {
    line.rotation.set(rotation.x, rotation.y, rotation.z);
  }
  scene.add(line);
};

export const spawnWalls = (
  world: CANNON.World,
  scene: THREE.Scene,
  wallMaterial: CANNON.Material
) => {
  let pos: CANNON.Vec3;
  let halfExtents: CANNON.Vec3;

  // Левая стена
  pos = new CANNON.Vec3(
    PLAY_AREA.minX - WALL_THICKNESS / 2,
    (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
    (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
  );
  halfExtents = new CANNON.Vec3(
    WALL_THICKNESS / 2,
    (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
    (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2
  );
  createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);
  if (SHOW_WALL_OUTLINES) {
    createVisualWall(scene, pos, halfExtents);
  }

  // Правая стена
  pos = new CANNON.Vec3(
    PLAY_AREA.maxX + WALL_THICKNESS / 2,
    (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
    (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
  );
  halfExtents = new CANNON.Vec3(
    WALL_THICKNESS / 2,
    (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
    (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2
  );
  createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);
  if (SHOW_WALL_OUTLINES) {
    createVisualWall(scene, pos, halfExtents);
  }

  // Нижняя стена
  pos = new CANNON.Vec3(
    (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
    PLAY_AREA.minY - WALL_THICKNESS / 2,
    (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
  );
  halfExtents = new CANNON.Vec3(
    (PLAY_AREA.maxX - PLAY_AREA.minX) / 2,
    WALL_THICKNESS / 2,
    (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2
  );
  createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);
  if (SHOW_WALL_OUTLINES) {
    createVisualWall(scene, pos, halfExtents);
  }

  // Верхняя стена
  pos = new CANNON.Vec3(
    (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
    PLAY_AREA.maxY + WALL_THICKNESS / 2,
    (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
  );
  halfExtents = new CANNON.Vec3(
    (PLAY_AREA.maxX - PLAY_AREA.minX) / 2,
    WALL_THICKNESS / 2,
    (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2
  );
  createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);
  if (SHOW_WALL_OUTLINES) {
    createVisualWall(scene, pos, halfExtents);
  }

  // Задняя стена
  pos = new CANNON.Vec3(
    (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
    (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
    PLAY_AREA.minZ - WALL_THICKNESS / 2
  );
  halfExtents = new CANNON.Vec3(
    (PLAY_AREA.maxX - PLAY_AREA.minX) / 2,
    (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
    WALL_THICKNESS / 2
  );
  createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);
  if (SHOW_WALL_OUTLINES) {
    createVisualWall(scene, pos, halfExtents);
  }

  // Передняя стена
  pos = new CANNON.Vec3(
    (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
    (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
    PLAY_AREA.maxZ + WALL_THICKNESS / 2
  );
  halfExtents = new CANNON.Vec3(
    (PLAY_AREA.maxX - PLAY_AREA.minX) / 2,
    (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
    WALL_THICKNESS / 2
  );
  createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);
  if (SHOW_WALL_OUTLINES) {
    createVisualWall(scene, pos, halfExtents);
  }
};;