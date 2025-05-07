// hooks/useSceneSetup.ts
import { useEffect, useRef } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import CannonDebugger from "cannon-es-debugger"
import { spawnWalls } from "../game-walls";

export type Cube = {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  targetQuaternion?: THREE.Quaternion;
};

export const useSceneSetup = (
  mountRef: React.RefObject<HTMLDivElement>,
  materials: THREE.Material[]
) => {
  const sceneRef = useRef<THREE.Scene>(new THREE.Scene());
  const cameraRef = useRef<THREE.PerspectiveCamera>(
    new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
  );
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const worldRef = useRef<CANNON.World>(new CANNON.World());
  const cubesRef = useRef<Cube[]>([]);

  useEffect(() => {
    if (!mountRef.current) return;

    // Инициализация камеры
    const camera = cameraRef.current;
    camera.position.set(0, 5, 12);
    camera.lookAt(new THREE.Vector3(0, 1, 0));

    // Инициализация рендера
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Инициализация физического мира
    const world = worldRef.current;
    world.gravity.set(0, -9.82, 0);
    world.allowSleep = true;

    // Создание материалов для кубов и стен (передаются из компонента)
    // Стены создаются через spawnWalls
    // Создаем стены
    spawnWalls(world, sceneRef.current, new CANNON.Material("wallMaterial"));

    // (Здесь можно также создать кубы – либо внутри этого хука, либо извне)

    // Добавляем свет
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 10, 5);
    sceneRef.current.add(light);

    // Запуск анимации
    const animate = () => {
      requestAnimationFrame(animate);
      world.step(1 / 60);
      // Обновляем позиции объектов: предположим, кубы обновляются извне
      renderer.render(sceneRef.current, camera);
    };
    animate();

    return () => {
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, [mountRef]);

  return { sceneRef, cameraRef, rendererRef, worldRef, cubesRef };
};
