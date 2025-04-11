"use client";

import { useCallback } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Cube } from "../game-board";

const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2);

const quaternionAngleDiff = (
  q1: CANNON.Quaternion,
  q2: CANNON.Quaternion
): number => {
  const dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
  const clampedDot = Math.min(Math.abs(dot), 1);
  return 2 * Math.acos(clampedDot);
};

// Собственная реализация slerp для CANNON.Quaternion, так как встроенная функция отсутствует
const slerpQuaternion = (
  q1: CANNON.Quaternion,
  q2: CANNON.Quaternion,
  t: number,
  target: CANNON.Quaternion
): CANNON.Quaternion => {
  let dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
  // Если скалярное произведение отрицательно, инвертируем q2 для кратчайшего пути
  if (dot < 0) {
    q2 = new CANNON.Quaternion(-q2.x, -q2.y, -q2.z, -q2.w);
    dot = -dot;
  }
  // Если кватернионы очень близки, используем линейную интерполяцию
  if (dot > 0.9995) {
    target.x = q1.x + t * (q2.x - q1.x);
    target.y = q1.y + t * (q2.y - q1.y);
    target.z = q1.z + t * (q2.z - q1.z);
    target.w = q1.w + t * (q2.w - q1.w);
    const invMag =
      1 /
      Math.sqrt(
        target.x * target.x +
          target.y * target.y +
          target.z * target.z +
          target.w * target.w
      );
    target.x *= invMag;
    target.y *= invMag;
    target.z *= invMag;
    target.w *= invMag;
    return target;
  }
  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);

  const s0 = Math.cos(theta) - dot * (sinTheta / sinTheta0);
  const s1 = sinTheta / sinTheta0;

  target.x = s0 * q1.x + s1 * q2.x;
  target.y = s0 * q1.y + s1 * q2.y;
  target.z = s0 * q1.z + s1 * q2.z;
  target.w = s0 * q1.w + s1 * q2.w;
  return target;
};

/**
 * Хук, возвращающий функцию rollDice, которая бросает кубы с заданным набором результатов.
 * Дополнительно вызывается callback onSettled после завершения анимации.
 */
export const useDiceRoll = (
  cubesRef: React.MutableRefObject<Cube[]>,
  isThrowingRef: React.MutableRefObject<boolean>,
  setRollResults: React.Dispatch<React.SetStateAction<number[]>>,
  setIsThrowing: React.Dispatch<React.SetStateAction<boolean>>,
  onSettled?: () => void
) => {
  const rollDice = useCallback(
    (desiredResults: number[]) => {
      // Имитируем тактильную отдачу
      setRollResults([]);

      // Определяем нужную ориентацию кубика через THREE.Quaternion
      const resultToQuaternion: { [key: number]: THREE.Quaternion } = {
        1: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, 0, Math.PI / 2)
        ),
        2: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, 0, -Math.PI / 2)
        ),
        3: new THREE.Quaternion(),
        4: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)),
        5: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-Math.PI / 2, 0, 0)
        ),
        6: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.PI / 2, 0, 0)
        ),
      };

      const targetPositions = [
        new CANNON.Vec3(-3, 1, 4),
        new CANNON.Vec3(0, 1, 4),
        new CANNON.Vec3(3, 1, 4),
      ];

      const flightTime = 0.4; // время полёта после старта
      const gravity = 9.82;
      const tweenDuration = 200; // длительность перемещения кубов к стартовой позиции

      setIsThrowing(true);
      isThrowingRef.current = true;

      const tweenPromises = cubesRef.current.map((cube, index) => {
        return new Promise<void>((resolve) => {
          const startX = -3 + index * 3;
          const startY = 4;
          const startZ = 12;
          const targetPos = new CANNON.Vec3(startX, startY, startZ);
          const initialPos = cube.body.position.clone();
          const startTime = performance.now();

          const animatePosition = (time: number) => {
            const elapsed = time - startTime;
            const t = Math.min(elapsed / tweenDuration, 1);
            const newX = initialPos.x + (targetPos.x - initialPos.x) * t;
            const newY = initialPos.y + (targetPos.y - initialPos.y) * t;
            const newZ = initialPos.z + (targetPos.z - initialPos.z) * t;
            cube.body.position.set(newX, newY, newZ);
            cube.mesh.position.copy(cube.body.position);
            if (t < 1) {
              requestAnimationFrame(animatePosition);
            } else {
              resolve();
            }
          };
          requestAnimationFrame(animatePosition);
        });
      });

      Promise.all(tweenPromises).then(() => {
        // Фаза полёта кубов
        cubesRef.current.forEach((cube, index) => {
          cube.body.velocity.set(0, 0, 0);
          cube.body.angularVelocity.set(0, 0, 0);
          // Сбрасываем ориентацию для корректной анимации переворота
          cube.body.quaternion.set(0, 0, 0, 1);
          cube.targetQuaternion = undefined;
          cube.body.type = CANNON.Body.DYNAMIC;

          const startX = -3 + index * 3;
          const startY = 4;
          const startZ = 12;
          const target = targetPositions[index % targetPositions.length];

          const velocityX = (target.x - startX) / flightTime;
          const velocityZ = (target.z - startZ) / flightTime;
          const velocityY =
            (target.y - startY + 0.5 * gravity * flightTime * flightTime) /
            flightTime;

          const impulse = new CANNON.Vec3(
            cube.body.mass * velocityX,
            cube.body.mass * velocityY,
            cube.body.mass * velocityZ
          );
          cube.body.applyImpulse(impulse, cube.body.position);

          // Добавляем случайную начальную вращательную скорость
          cube.body.angularVelocity.set(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20
          );
        });

        const bounceDelay = flightTime * 1000 + 500;
        setTimeout(() => {
          cubesRef.current.forEach((cube, index) => {
            cube.body.velocity.set(0, 0, 0);
            cube.body.angularVelocity.set(0, 0, 0);
            const result = desiredResults[index % desiredResults.length];

            const targetQuatTHREE = resultToQuaternion[result];
            const targetQuat = new CANNON.Quaternion(
              targetQuatTHREE.x,
              targetQuatTHREE.y,
              targetQuatTHREE.z,
              targetQuatTHREE.w
            );
            const startQuat = cube.body.quaternion.clone();

            const angleDiff = quaternionAngleDiff(startQuat, targetQuat);
            const duration = angleDiff > 0.5 ? 500 : 500;

            let animStartTime: number | null = null;

            const animateRotation = (timestamp: number) => {
              if (!animStartTime) animStartTime = timestamp;
              const elapsed = timestamp - animStartTime;
              const t = Math.min(elapsed / duration, 1);
              const tEased = easeOutSine(t);
              const newQuat = new CANNON.Quaternion();
              // Используем самописную функцию slerpQuaternion для интерполяции
              slerpQuaternion(startQuat, targetQuat, tEased, newQuat);
              cube.body.quaternion.copy(newQuat);
              if (t < 1) {
                requestAnimationFrame(animateRotation);
              } else {
                cube.body.quaternion.copy(targetQuat);
              }
            };
            requestAnimationFrame(animateRotation);
          });

          setRollResults([...desiredResults]);
          setTimeout(() => {
            if (onSettled) onSettled();
            setTimeout(() => {
              setIsThrowing(false);
              isThrowingRef.current = false;
            }, 1000);
          }, 1500);
        }, bounceDelay);
      });
    },
    [cubesRef, isThrowingRef, setRollResults, setIsThrowing, onSettled]
  );

  return { rollDice };
};
