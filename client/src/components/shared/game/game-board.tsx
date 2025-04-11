"use client";

import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { useWindowResize, useDiceRoll, useDeviceOrientation } from "./hooks";
import { useCubeShake } from "./hooks/use-cube-shake";
import { spawnWalls } from "./game-walls";
import toast from "react-hot-toast";
import { dailyRoll } from "@/shared/services/roll";
import { RollScreen } from "./roll-screen";
import { useGetUser } from "@/shared";

export type Cube = {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  targetQuaternion?: THREE.Quaternion;
};

interface Props {
  className?: string;
}

export const GameBoard: React.FC<Props> = ({ className }) => {
  const rollsNumber = 100;

  const mountRef = useRef<HTMLDivElement>(null);
  const cubesRef = useRef<Cube[]>([]);

  const [rollResults, setRollResults] = useState<number[]>([]);
  const [isThrowing, setIsThrowing] = useState<boolean>(false);
  const isThrowingRef = useRef<boolean>(false);

  const [isVisible, setVisible] = useState(false);
  const [showShake, setShowShake] = useState(true);

  const onSettled = () => {
    setVisible(true);
    // После завершения броска можно снова показывать надпись
    setShowShake(true);
    setTimeout(() => setVisible(false), 1500);
  };

  const { rollDice } = useDiceRoll(
    cubesRef,
    isThrowingRef,
    setRollResults,
    setIsThrowing,
    onSettled
  );

  const handleDailyRoll = async () => {
    try {
      rollDice([1, 2, 3]);
    } catch {
      toast.error("Oopss... Failed to roll the dice.");
    }
  };

  useCubeShake(
    cubesRef,
    isThrowingRef,
    handleDailyRoll,
    rollsNumber < 1,
    setShowShake
  );

  useEffect(() => {
    isThrowingRef.current = isThrowing;
  }, [isThrowing]);

  const { requestAccess, revokeAccess } = useDeviceOrientation();

  const materials = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return [
      new THREE.MeshStandardMaterial({ map: loader.load("/dice/1.png") }),
      new THREE.MeshStandardMaterial({ map: loader.load("/dice/2.png") }),
      new THREE.MeshStandardMaterial({ map: loader.load("/dice/3.png") }),
      new THREE.MeshStandardMaterial({ map: loader.load("/dice/4.png") }),
      new THREE.MeshStandardMaterial({ map: loader.load("/dice/5.png") }),
      new THREE.MeshStandardMaterial({ map: loader.load("/dice/6.png") }),
    ];
  }, []);

  const spawnCubes = useCallback(
    (
      scene: THREE.Scene,
      world: CANNON.World,
      cubeMaterial: CANNON.Material
    ): Cube[] => {
      const cubes: Cube[] = [];
      const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);

      for (let i = 0; i < 3; i++) {
        const startX = (Math.random() - 0.5) * 2;
        const startY = 2 + Math.random() * 2;
        const startZ = (Math.random() - 0.5) * 2;

        const cubeMesh = new THREE.Mesh(geometry, materials);
        cubeMesh.position.set(startX, startY, startZ);
        scene.add(cubeMesh);

        const cubeShape = new CANNON.Box(new CANNON.Vec3(0.8, 0.8, 0.8));
        // Увеличиваем массу кубиков для добавления веса и делаем демпфирование более выраженным
        const cubeBody = new CANNON.Body({
          mass: 0.8, // увеличенная масса для более устойчивого поведения
          shape: cubeShape,
          position: new CANNON.Vec3(startX, startY, startZ),
          material: cubeMaterial,
        });
        cubeBody.angularDamping = 0.3;
        cubeBody.linearDamping = 0.2; // повышенное линейное демпфирование для предотвращения резких движений
        world.addBody(cubeBody);

        cubes.push({ mesh: cubeMesh, body: cubeBody });
      }
      return cubes;
    },
    [materials]
  );

  useWindowResize(() => {
    if (cameraRef.current && rendererRef.current) {
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    }
  });

  // Инициализация сцены
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 5, 12);
    camera.lookAt(new THREE.Vector3(0, 1, 0));
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Создаём физический мир
    const world = new CANNON.World();
    world.gravity.set(0, -19.64, 0);
    world.allowSleep = true;

    const cubeMaterial = new CANNON.Material("cubeMaterial");
    const wallMaterial = new CANNON.Material("wallMaterial");

    // Настраиваем материалы контакта
    const cubeWallContact = new CANNON.ContactMaterial(
      cubeMaterial,
      wallMaterial,
      { friction: 0.3, restitution: 0.6 }
    );
    const cubeCubeContact = new CANNON.ContactMaterial(
      cubeMaterial,
      cubeMaterial,
      { friction: 0.3, restitution: 0.6 }
    );
    world.addContactMaterial(cubeWallContact);
    world.addContactMaterial(cubeCubeContact);

    // Спавним стены и кубы
    spawnWalls(world, scene, wallMaterial);
    cubesRef.current = spawnCubes(scene, world, cubeMaterial);

    // Свет
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 10, 5);
    scene.add(light);

    // Анимация
    const animate = () => {
      requestAnimationFrame(animate);
      world.step(1 / 60);

      // Обновляем позиции и ориентации кубов
      cubesRef.current.forEach((cube) => {
        // Если в кубе задана targetQuaternion, постепенно интерполируем ориентацию
        if (cube.targetQuaternion) {
          const current = new THREE.Quaternion(
            cube.body.quaternion.x,
            cube.body.quaternion.y,
            cube.body.quaternion.z,
            cube.body.quaternion.w
          );
          current.slerp(cube.targetQuaternion, 0.027);
          cube.body.quaternion.set(current.x, current.y, current.z, current.w);
        }

        cube.mesh.position.set(
          cube.body.position.x,
          cube.body.position.y,
          cube.body.position.z
        );
        cube.mesh.quaternion.set(
          cube.body.quaternion.x,
          cube.body.quaternion.y,
          cube.body.quaternion.z,
          cube.body.quaternion.w
        );
      });

      renderer.render(scene, camera);
    };
    animate();

    // Ресайз
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [spawnCubes]);

  return (
    <>
      <button
        className="fixed top-[100px] left-1/2 -translate-x-1/2 w-[200px] h-10 z-[99]"
        onClick={() => {
          requestAccess();
        }}
      >
        Request Orientation
      </button>

      {showShake && (
        <div className="fixed top-1/3 -translate-y-1/2 left-1/2 -translate-x-1/2 text-[32px] text-white">
          Shake!!!
        </div>
      )}

      <RollScreen isVisible={isVisible} result={rollResults} />
      <div
        ref={mountRef}
        className={`fixed top-0 left-0 w-screen h-screen overflow-hidden ${
          className || ""
        }`}
      />
    </>
  );
};
