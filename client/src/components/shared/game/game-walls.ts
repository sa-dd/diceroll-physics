// utils/walls.ts
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { PLAY_AREA, WALL_THICKNESS } from "./game-config"; // Assuming this path is correct

export type EulerRotation = { x: number; y: number; z: number };

// This constant now primarily controls if visual walls are desired for the *main* scene.
// For the shadow world, we'll explicitly set addToScene to false.
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
    mass: 0, // Static body
    shape: wallShape,
    position,
    material: wallMaterial,
  });
  if (rotation) {
    wallBody.quaternion.setFromEuler(rotation.x, rotation.y, rotation.z);
  }
  world.addBody(wallBody);
  return wallBody; // Return the body, might be useful
};

export const createVisualWall = (
  scene: THREE.Scene, // Scene is necessary to add visual elements
  position: CANNON.Vec3,
  halfExtents: CANNON.Vec3,
  rotation?: EulerRotation
) => {
  const width = halfExtents.x * 2;
  const height = halfExtents.y * 2;
  const depth = halfExtents.z * 2;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: 0xff0000 }); // Red outlines
  const line = new THREE.LineSegments(edges, material);

  line.position.set(position.x, position.y, position.z);
  if (rotation) {
    line.rotation.set(rotation.x, rotation.y, rotation.z);
  }
  scene.add(line);
  return line; // Return the mesh, might be useful
};

interface SpawnWallsOptions {
  /**
   * The Three.js scene to potentially add visual walls to.
   * Only used if addToScene is true.
   */
  scene?: THREE.Scene;
  /**
   * Whether to add visual walls to the Three.js scene.
   * Physics bodies are always created.
   * Defaults to true.
   */
  addToScene?: boolean;
}

export const spawnWalls = (
  world: CANNON.World,
  wallMaterial: CANNON.Material,
  options?: SpawnWallsOptions
) => {
  // Destructure options with defaults
  const { scene, addToScene = true } = options || {};

  let pos: CANNON.Vec3;
  let halfExtents: CANNON.Vec3;

  // Define configurations for each wall
  const wallConfigurations = [
    { // Left wall
      id: "left",
      position: new CANNON.Vec3(
        PLAY_AREA.minX - WALL_THICKNESS / 2,
        (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
        (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
      ),
      halfExtents: new CANNON.Vec3(
        WALL_THICKNESS / 2,
        (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
        (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2 + WALL_THICKNESS // Extend to cover corners
      ),
    },
    { // Right wall
      id: "right",
      position: new CANNON.Vec3(
        PLAY_AREA.maxX + WALL_THICKNESS / 2,
        (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
        (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
      ),
      halfExtents: new CANNON.Vec3(
        WALL_THICKNESS / 2,
        (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
        (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2 + WALL_THICKNESS // Extend to cover corners
      ),
    },
    { // Bottom wall (Ground)
      id: "bottom",
      position: new CANNON.Vec3(
        (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
        PLAY_AREA.minY - WALL_THICKNESS / 2,
        (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
      ),
      halfExtents: new CANNON.Vec3(
        (PLAY_AREA.maxX - PLAY_AREA.minX) / 2 + WALL_THICKNESS, // Extend to cover corners
        WALL_THICKNESS / 2,
        (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2 + WALL_THICKNESS  // Extend to cover corners
      ),
    },
    { // Top wall (Ceiling)
      id: "top",
      position: new CANNON.Vec3(
        (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
        PLAY_AREA.maxY + WALL_THICKNESS / 2,
        (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2
      ),
      halfExtents: new CANNON.Vec3(
        (PLAY_AREA.maxX - PLAY_AREA.minX) / 2 + WALL_THICKNESS, // Extend to cover corners
        WALL_THICKNESS / 2,
        (PLAY_AREA.maxZ - PLAY_AREA.minZ) / 2 + WALL_THICKNESS  // Extend to cover corners
      ),
    },
    { // Back wall
      id: "back",
      position: new CANNON.Vec3(
        (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
        (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
        PLAY_AREA.minZ - WALL_THICKNESS / 2
      ),
      halfExtents: new CANNON.Vec3(
        (PLAY_AREA.maxX - PLAY_AREA.minX) / 2, // No need to extend X here if sides cover
        (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
        WALL_THICKNESS / 2
      ),
    },
    { // Front wall (often invisible or further away for camera)
      id: "front",
      position: new CANNON.Vec3(
        (PLAY_AREA.minX + PLAY_AREA.maxX) / 2,
        (PLAY_AREA.minY + PLAY_AREA.maxY) / 2,
        PLAY_AREA.maxZ + WALL_THICKNESS / 2 + 5 // Positioned further out
      ),
      halfExtents: new CANNON.Vec3(
        (PLAY_AREA.maxX - PLAY_AREA.minX) / 2,
        (PLAY_AREA.maxY - PLAY_AREA.minY) / 2,
        WALL_THICKNESS / 2
      ),
    },
  ];

  wallConfigurations.forEach(config => {
    pos = config.position;
    halfExtents = config.halfExtents;

    // Always create the physics body
    createPhysicsWall(world, pos, halfExtents, undefined, wallMaterial);

    // Conditionally create visual wall outline
    if (addToScene && SHOW_WALL_OUTLINES && scene) {
      // Only add to scene if addToScene is true, SHOW_WALL_OUTLINES is true, AND a scene is provided
      createVisualWall(scene, pos, halfExtents);
    }
  });
};;