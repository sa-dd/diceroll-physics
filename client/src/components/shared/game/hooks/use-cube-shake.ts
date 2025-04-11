"use client";

import { useEffect } from "react";
import * as CANNON from "cannon-es";
import { Cube } from "../game-board";

export const useCubeShake = (
  cubesRef: React.MutableRefObject<Cube[]>,
  isThrowingRef: React.MutableRefObject<boolean>,
  handleRollDice: () => void,
  isDisabled: boolean,
  setShowShake: (show: boolean) => void
) => {
  useEffect(() => {
    const shakeThreshold = 15;
    const impulseFactor = 1; // не меняем скорость
    const impulseInterval = 50;

    // Для сглаживания рывков вводим low-pass фильтр с коэффициентом,
    // близким к 1, чтобы почти не снижать скорость, но все же убирать резкие скачки.
    const smoothingFactor = 0.8;

    let smoothedAcc = { x: 0, y: 0, z: 0 };

    let shakeStart: number | null = null;
    let lastShake: number | null = null;
    let lastImpulseTime = 0;
    let hasRolled = false;
    const rollResetDelay = 1000;

    const handleMotion = (event: DeviceMotionEvent) => {
      if (isThrowingRef.current) return;
      const a = event.accelerationIncludingGravity;
      if (!a) return;
      const now = Date.now();

      // Обновляем сглаженные значения, почти сохраняя оригинал (smoothingFactor близок к 1)
      smoothedAcc.x =
        smoothingFactor * (a.x || 0) + (1 - smoothingFactor) * smoothedAcc.x;
      smoothedAcc.y =
        smoothingFactor * (a.y || 0) + (1 - smoothingFactor) * smoothedAcc.y;
      smoothedAcc.z =
        smoothingFactor * (a.z || 0) + (1 - smoothingFactor) * smoothedAcc.z;

      const mag = Math.sqrt(
        smoothedAcc.x ** 2 + smoothedAcc.y ** 2 + smoothedAcc.z ** 2
      );

      if (mag > shakeThreshold) {
        setShowShake(false);
        if (shakeStart === null) {
          shakeStart = now;
          hasRolled = false;
        }
        lastShake = now;

        if (now - lastImpulseTime > impulseInterval) {
          cubesRef.current.forEach(({ body }) => {
            // Используем сглаженные значения для вычисления импульса
            const impulse = new CANNON.Vec3(
              smoothedAcc.x * impulseFactor,
              smoothedAcc.y * impulseFactor,
              smoothedAcc.z * impulseFactor
            );
            body.applyImpulse(impulse, body.position);
            // Если не хочется, чтобы куб терял вращение, можно убрать следующую строку,
            // но сейчас она сбрасывает угловую скорость для контроля динамики.
            body.angularVelocity.set(0, 0, 0);
          });
          lastImpulseTime = now;
        }
      } else {
        if (
          shakeStart !== null &&
          lastShake !== null &&
          now - lastShake > 100 &&
          !hasRolled
        ) {
          handleRollDice();
          hasRolled = true;
          shakeStart = null;
          lastShake = null;
          lastImpulseTime = 0;
          setTimeout(() => {
            hasRolled = false;
          }, rollResetDelay);
        }
      }
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [cubesRef, isThrowingRef, handleRollDice, isDisabled, setShowShake]);
};
