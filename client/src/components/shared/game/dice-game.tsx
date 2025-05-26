"use client"

import type React from "react"
import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import * as THREE from "three"
import * as CANNON from "cannon-es"
import CannonDebugger from 'cannon-es-debugger'
import { useWindowResize } from "./hooks"
import { useDeviceMotion } from "./hooks/use-device-motion"
import { useAccelerometerDice } from "./hooks/use-accelerometer-dice"
import { spawnWalls } from "./game-walls"
import { RollScreen } from "./roll-screen"
import type { Cube } from "./game-board"

interface Props {
  className?: string
}

// Define constraint interfaces
interface ConstraintData {
  constraint: CANNON.DistanceConstraint;
  bodyA: CANNON.Body;
  bodyB: CANNON.Body;
}

// Define type for accelerometer debug info
interface AccelerometerDebugInfo {
  rawAcceleration: {
    x: string;
    y: string;
    z: string;
  } | null;
  filteredAcceleration: {
    x: string;
    y: string;
    z: string;
  };
  acceleration: number;
  tiltX: number;
  tiltY: number;
}

// Define type for deadzone status
interface DeadzoneStatus {
  inDeadzone: boolean;
  progress: number;
  timeMs: number;
  hasMoved: boolean;
  debug: {
    startTime: number | null;
    currentTime: number;
    remaining: number;
  };
}

// Shadow recording interfaces
interface PhysicsFrame {
  timestamp: number
  diceStates: {
    position: { x: number, y: number, z: number }
    quaternion: { x: number, y: number, z: number, w: number }
    velocity: { x: number, y: number, z: number }
    angularVelocity: { x: number, y: number, z: number }
  }[]
}

interface ShadowRecording {
  frames: PhysicsFrame[]
  finalResults: number[]
  isComplete: boolean
  isRigged?: boolean
  desiredResults?: number[]
}

// Rigging constants
const TRANSITION_FRAMES = 15
const VELOCITY_SETTLE_THRESHOLD = 2.0
const MIDAIR_HEIGHT_THRESHOLD = 5.0
const PHYSICS_INFLUENCE_FRAMES = 40

// Face orientation mapping
const FACE_VALUE_TO_NORMAL = new Map<number, THREE.Vector3>([
  [1, new THREE.Vector3(1, 0, 0)],    // 1 is on right face (+X)
  [6, new THREE.Vector3(-1, 0, 0)],   // 6 is on left face (-X)
  [2, new THREE.Vector3(0, 1, 0)],    // 2 is on top face (+Y)
  [5, new THREE.Vector3(0, -1, 0)],   // 5 is on bottom face (-Y)
  [3, new THREE.Vector3(0, 0, 1)],    // 3 is on front face (+Z)
  [4, new THREE.Vector3(0, 0, -1)]    // 4 is on back face (-Z)
])

// Rigging presets
type RiggingPreset = 'off' | 'lucky' | 'unlucky' | 'balanced' | 'snake-eyes' | 'jackpot' | 'custom';

interface RiggingPresetConfig {
  name: string;
  description: string;
  generateResults: () => number[];
  color: string;
}

const RIGGING_PRESETS: Record<RiggingPreset, RiggingPresetConfig> = {
  'off': {
    name: 'Off',
    description: 'Natural dice rolls',
    generateResults: () => [],
    color: 'bg-gray-500'
  },
  'lucky': {
    name: 'Lucky',
    description: 'High rolls (15-18)',
    generateResults: () => {
      const targetSums = [15, 16, 17, 18];
      const targetSum = targetSums[Math.floor(Math.random() * targetSums.length)];
      const results = [1, 1, 1];
      let currentSum = 3;
      while (currentSum < targetSum) {
        const diceIndex = Math.floor(Math.random() * 3);
        if (results[diceIndex] < 6) {
          results[diceIndex]++;
          currentSum++;
        }
      }
      return results;
    },
    color: 'bg-green-500'
  },
  'unlucky': {
    name: 'Unlucky',
    description: 'Low rolls (3-6)',
    generateResults: () => {
      const targetSums = [3, 4, 5, 6];
      const targetSum = targetSums[Math.floor(Math.random() * targetSums.length)];
      const results = [1, 1, 1];
      let currentSum = 3;
      while (currentSum < targetSum) {
        const diceIndex = Math.floor(Math.random() * 3);
        if (results[diceIndex] < 6) {
          results[diceIndex]++;
          currentSum++;
        }
      }
      return results;
    },
    color: 'bg-red-500'
  },
  'balanced': {
    name: 'Balanced',
    description: 'Normal distribution (9-12)',
    generateResults: () => {
      const targetSums = [9, 10, 11, 12];
      const targetSum = targetSums[Math.floor(Math.random() * targetSums.length)];
      const results = [1, 1, 1];
      let currentSum = 3;
      while (currentSum < targetSum) {
        const diceIndex = Math.floor(Math.random() * 3);
        if (results[diceIndex] < 6) {
          results[diceIndex]++;
          currentSum++;
        }
      }
      return results;
    },
    color: 'bg-blue-500'
  },
  'snake-eyes': {
    name: 'Snake Eyes',
    description: 'All ones (3)',
    generateResults: () => [1, 1, 1],
    color: 'bg-yellow-500'
  },
  'jackpot': {
    name: 'Jackpot',
    description: 'All sixes (18)',
    generateResults: () => [6, 6, 6],
    color: 'bg-purple-500'
  },
  'custom': {
    name: 'Custom',
    description: 'User defined',
    generateResults: () => [4, 4, 4],
    color: 'bg-orange-500'
  }
};

interface DiceState {
  position: { x: number, y: number, z: number }
  quaternion: { x: number, y: number, z: number, w: number }
  velocity: { x: number, y: number, z: number }
  angularVelocity: { x: number, y: number, z: number }
}

// Shadow constants
const DEFAULT_THROW_FORCE_Y = 2.0
const DEFAULT_THROW_FORCE_Z = -32.0
const DEFAULT_THROW_STRENGTH = 1.5
const SHADOW_FLOAT_BASE_Y_OFFSET = 2

// Debug mode toggle - set to true to show accelerometer values
const DEBUG_MODE = true;
const DEADZONE_THROW_DELAY = 5;

export const DiceGame: React.FC<Props> = ({ className }) => {
  const mountRef = useRef<HTMLDivElement>(null)
  
  // Main world refs
  const cubesRef = useRef<Cube[]>([])
  const initialPositionsRef = useRef<CANNON.Vec3[]>([])
  const constraintsRef = useRef<ConstraintData[]>([])
  const worldRef = useRef<CANNON.World | null>(null)
  
  // Shadow world refs
  const shadowWorldRef = useRef<CANNON.World | null>(null)
  const shadowCubesRef = useRef<Cube[]>([])
  const shadowInitialPositionsRef = useRef<CANNON.Vec3[]>([])
  const shadowConstraintsRef = useRef<ConstraintData[]>([])
  const [isShadowDiceThrown, setIsShadowDiceThrown] = useState(false)
  const shadowRollInProgressRef = useRef(false)
  
  // Cannon debugger refs
  const cannonDebuggerRef = useRef<any>(null)
  const shadowDebuggerRef = useRef<any>(null)
  const [showShadowDebug, setShowShadowDebug] = useState(false)

  // Shadow recording state
  const shadowRecordingRef = useRef<{
    isRecording: boolean
    frames: PhysicsFrame[]
    startTime: number
    resolvePromise: ((recording: ShadowRecording) => void) | null
    streamingCallback: ((frame: PhysicsFrame) => void) | null
  }>({
    isRecording: false,
    frames: [],
    startTime: 0,
    resolvePromise: null,
    streamingCallback: null
  });

  const [rollResults, setRollResults] = useState<number[]>([])
  const [isThrowing, setIsThrowing] = useState<boolean>(false)
  const isThrowingRef = useRef<boolean>(false)
  const [isVisible, setVisible] = useState(false)
  // State for motion readiness
  const [motionReady, setMotionReady] = useState(false);
    // Get device motion data using our new hook
  const { 
    motion, 
    isShaking, 
    accessGranted: motionAccessGranted, 
    requestAccess: requestMotionAccess, 
    revokeAccess: revokeMotionAccess 
  } = useDeviceMotion({
    shakeThreshold: 2.5
  });

  // Track when motion data is actually flowing
  useEffect(() => {
    if (motionAccessGranted && motion && 
        motion.accelerationIncludingGravity.x !== null && 
        motion.accelerationIncludingGravity.y !== null && 
        motion.accelerationIncludingGravity.z !== null) {
      setMotionReady(true);
    } else {
      setMotionReady(false);
    }
  }, [motionAccessGranted, motion]);
  const rollScreenAnimationTimeRef = useRef<number>(400)
  const neutralPositionSetRef = useRef<boolean>(false)
  const floatingInitializedRef = useRef<boolean>(false)
  
  // State for tracking if movement is unlocked by shake
  const [movementUnlocked, setMovementUnlocked] = useState(false)
  
  // State for floating mode tracking
  const [isFloating, setIsFloating] = useState(true)
  
  // Debug mode state
  const [debugMode, setDebugMode] = useState<boolean>(false)
  
  // State for accelerometer values - only care about X for movement
  const [accelerometerValues, setAccelerometerValues] = useState<{
    x: number | null;
    y: number | null;
    z: number | null;
    tiltX: number;
    tiltY: number;
  }>({
    x: null,
    y: null,
    z: null,
    tiltX: 0,
    tiltY: 0
  });
  
  // State for accelerometer debug info
  const [accelDebugInfo, setAccelDebugInfo] = useState<AccelerometerDebugInfo | null>(null);
  
  // Properly typed deadzone state
  const [deadzoneState, setDeadzoneState] = useState<DeadzoneStatus>({
    inDeadzone: false,
    progress: 0,
    timeMs: 0,
    hasMoved: false,
    debug: {
      startTime: null,
      currentTime: Date.now(),
      remaining: 0
    }
  });

  // Rigging preset state
  const [selectedPreset, setSelectedPreset] = useState<RiggingPreset>('lucky');
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [customResults, setCustomResults] = useState<number[]>([4, 4, 4]);
  
  // Use ref to always have current rigging settings
  const currentRiggingRef = useRef({
    preset: selectedPreset,
    customResults: customResults
  });
  
  // Update ref whenever preset changes
  useEffect(() => {
    currentRiggingRef.current = {
      preset: selectedPreset,
      customResults: customResults
    };
    console.log("Updated rigging ref to:", currentRiggingRef.current);
  }, [selectedPreset, customResults]);

  // Shadow dice synchronization function
  const syncShadowDiceWithMain = useCallback(() => {
    // Only sync when not recording a shadow throw
    if (shadowRecordingRef.current.isRecording) return;
    
    // Ensure both dice arrays have the same length
    if (cubesRef.current.length !== shadowCubesRef.current.length) return;
    
    cubesRef.current.forEach((mainCube, index) => {
      const shadowCube = shadowCubesRef.current[index];
      if (!mainCube?.body || !shadowCube?.body) return;
      
      // Copy position
      shadowCube.body.position.copy(mainCube.body.position);
      
      // Copy rotation/quaternion
      shadowCube.body.quaternion.copy(mainCube.body.quaternion);
      
      // Copy velocity
      shadowCube.body.velocity.copy(mainCube.body.velocity);
      
      // Copy angular velocity
      shadowCube.body.angularVelocity.copy(mainCube.body.angularVelocity);
      
      // Copy physics properties
      shadowCube.body.linearDamping = mainCube.body.linearDamping;
      shadowCube.body.angularDamping = mainCube.body.angularDamping;
      shadowCube.body.type = mainCube.body.type;
      
      // Wake up the shadow cube to ensure physics updates
      if (mainCube.body.sleepState !== CANNON.Body.SLEEPING) {
        shadowCube.body.wakeUp();
      } else {
        shadowCube.body.sleep();
      }
    });
    
    // Sync world gravity
    if (worldRef.current && shadowWorldRef.current) {
      shadowWorldRef.current.gravity.copy(worldRef.current.gravity);
    }
  }, []);

  // Working rigging functions
  const calculateOrientationForFaceValue = useCallback((faceValue: number): CANNON.Quaternion => {
    const upVector = FACE_VALUE_TO_NORMAL.get(faceValue);
    if (!upVector) {
      console.error(`Unknown face value: ${faceValue}`);
      return new CANNON.Quaternion();
    }

    const worldUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    
    const angle = Math.acos(upVector.dot(worldUp) / (upVector.length() * worldUp.length()));
    
    if (Math.abs(angle) < 0.001 || Math.abs(angle - Math.PI) < 0.001) {
      if (Math.abs(angle) < 0.001) {
        quaternion.set(0, 0, 0, 1);
      } else {
        quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      }
    } else {
      const axis = new THREE.Vector3().crossVectors(upVector, worldUp).normalize();
      quaternion.setFromAxisAngle(axis, angle);
    }
    
    return new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }, []);

  const findMidairPoint = useCallback((frames: PhysicsFrame[]): number => {
    let peakIndex = 0;
    let peakHeight = 0;
    
    for (let i = 0; i < frames.length; i++) {
      const avgHeight = frames[i].diceStates.reduce((sum, state) => sum + state.position.y, 0) / frames[i].diceStates.length;
      
      if (avgHeight > peakHeight) {
        peakHeight = avgHeight;
        peakIndex = i;
      }
    }
    
    for (let i = 0; i < peakIndex; i++) {
      const avgHeight = frames[i].diceStates.reduce((sum, state) => sum + state.position.y, 0) / frames[i].diceStates.length;
      const allAboveGround = frames[i].diceStates.every(state => state.position.y > 3.0);
      
      if (allAboveGround && avgHeight > (peakHeight * 0.75)) {
        console.log(`Found early mid-air point at frame ${i} (height: ${avgHeight.toFixed(2)})`);
        return i;
      }
    }
    
    const fallbackIndex = Math.floor(frames.length / 4);
    console.log(`Falling back to earlier mid-air point at frame ${fallbackIndex}`);
    return fallbackIndex;
  }, []);

  const findSettleIndex = useCallback((frames: PhysicsFrame[]): number => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i];
      
      const allSlowingDown = frame.diceStates.every(state => {
        const speed = Math.sqrt(state.velocity.x ** 2 + state.velocity.y ** 2 + state.velocity.z ** 2);
        return speed < VELOCITY_SETTLE_THRESHOLD;
      });
      
      if (allSlowingDown) {
        return Math.max(0, i - 5);
      }
    }
    
    return Math.floor(frames.length * 2 / 3);
  }, []);

  const calculateOrientingTorque = useCallback((
    currentRotation: CANNON.Quaternion,
    targetRotation: CANNON.Quaternion,
    strength: number = 1.0
  ): CANNON.Vec3 => {
    const currentQuat = new THREE.Quaternion(
      currentRotation.x, currentRotation.y, currentRotation.z, currentRotation.w
    );
    const targetQuat = new THREE.Quaternion(
      targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w
    );
    
    const diffQuat = new THREE.Quaternion();
    const invertedCurrent = currentQuat.clone().invert();
    diffQuat.multiplyQuaternions(targetQuat, invertedCurrent);
    
    const axisAngle = new THREE.Vector3();
    let angle = 0;
    
    if (Math.abs(diffQuat.w) < 0.9999) {
      angle = 2 * Math.acos(diffQuat.w);
      const s = Math.sqrt(1 - diffQuat.w * diffQuat.w);
      if (s > 0.0001) {
        axisAngle.x = diffQuat.x / s;
        axisAngle.y = diffQuat.y / s;
        axisAngle.z = diffQuat.z / s;
        axisAngle.normalize();
      }
    }
    
    axisAngle.multiplyScalar(angle * strength * 1.5);
    
    return new CANNON.Vec3(axisAngle.x, axisAngle.y, axisAngle.z);
  }, []);

  const slerpQuaternions = useCallback((qa: CANNON.Quaternion, qb: CANNON.Quaternion, t: number): CANNON.Quaternion => {
    if (t === 0) return new CANNON.Quaternion(qa.x, qa.y, qa.z, qa.w);
    if (t === 1) return new CANNON.Quaternion(qb.x, qb.y, qb.z, qb.w);

    const x = qa.x, y = qa.y, z = qa.z, w = qa.w;
    let qax = x, qay = y, qaz = z, qaw = w;
    let qbx = qb.x, qby = qb.y, qbz = qb.z, qbw = qb.w;

    let cosHalfTheta = qax * qbx + qay * qby + qaz * qbz + qaw * qbw;

    if (Math.abs(cosHalfTheta) >= 1.0) {
      return new CANNON.Quaternion(qax, qay, qaz, qaw);
    }

    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

    if (Math.abs(sinHalfTheta) < 0.001) {
      return new CANNON.Quaternion(
        qax * 0.5 + qbx * 0.5,
        qay * 0.5 + qby * 0.5,
        qaz * 0.5 + qbz * 0.5,
        qaw * 0.5 + qbw * 0.5
      );
    }

    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return new CANNON.Quaternion(
      qax * ratioA + qbx * ratioB,
      qay * ratioA + qby * ratioB,
      qaz * ratioA + qbz * ratioB,
      qaw * ratioA + qbw * ratioB
    );
  }, []);

  const calculateLandingOrientation = useCallback((faceValue: number): CANNON.Quaternion => {
    const targetNormal = FACE_VALUE_TO_NORMAL.get(faceValue);
    if (!targetNormal) {
      console.error(`Unknown face value: ${faceValue}`);
      return new CANNON.Quaternion();
    }
    
    const oppositeVector = targetNormal.clone().multiplyScalar(-1);
    const worldDown = new THREE.Vector3(0, -1, 0);
    
    const quaternion = new THREE.Quaternion();
    
    const angle = Math.acos(oppositeVector.dot(worldDown) / (oppositeVector.length() * worldDown.length()));
    
    if (Math.abs(angle) < 0.001 || Math.abs(angle - Math.PI) < 0.001) {
      if (Math.abs(angle) < 0.001) {
        quaternion.set(0, 0, 0, 1);
      } else {
        quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      }
    } else {
      const axis = new THREE.Vector3().crossVectors(oppositeVector, worldDown).normalize();
      quaternion.setFromAxisAngle(axis, angle);
    }
    
    const randomYRotation = new THREE.Quaternion();
    randomYRotation.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), 
      (Math.random() - 0.5) * Math.PI * 0.25
    );
    
    quaternion.premultiply(randomYRotation);
    
    return new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }, []);

  const createNaturalTransitionFrames = useCallback((
    startFrame: PhysicsFrame,
    originalFrames: PhysicsFrame[],
    targetValues: number[],
    strengthFactor: number = 0.9
  ): PhysicsFrame[] => {
    const transitionFrames: PhysicsFrame[] = [];
    
    const targetLandingOrientations = targetValues.map(value => calculateLandingOrientation(value));
    
    const totalFrames = originalFrames.length > 0 ? originalFrames.length : PHYSICS_INFLUENCE_FRAMES;
    
    for (let i = 0; i < totalFrames; i++) {
      const useOriginalFrame = i < originalFrames.length;
      const frameToModify = useOriginalFrame ? originalFrames[i] : 
                          (i > 0 ? transitionFrames[i-1] : startFrame);
      
      const progress = i / totalFrames;
      const sigmoidProgress = 1 / (1 + Math.exp(-15 * (progress - 0.35)));
      const appliedStrength = sigmoidProgress * strengthFactor * 1.2;
      
      const newFrame: PhysicsFrame = {
        diceStates: frameToModify.diceStates.map((diceState, idx) => {
          const targetRot = targetLandingOrientations[idx];
          const currentQuat = new CANNON.Quaternion(diceState.quaternion.x, diceState.quaternion.y, diceState.quaternion.z, diceState.quaternion.w);
          const slerpedQuat = slerpQuaternions(currentQuat, targetRot, appliedStrength);
          
          let newVel = { ...diceState.velocity };
          if (diceState.position.y > MIDAIR_HEIGHT_THRESHOLD && progress > 0.3) {
            newVel.y = Math.min(newVel.y, -2.5 * (1.0 - progress));
          }
          if (progress > 0.2) {
            newVel.x += (Math.random() - 0.5) * 0.15 * appliedStrength;
            newVel.z += (Math.random() - 0.5) * 0.15 * appliedStrength;
          }
          
          const torque = calculateOrientingTorque(currentQuat, targetRot, appliedStrength * 0.3);
          const adjustedAngVel = {
            x: diceState.angularVelocity.x + torque.x,
            y: diceState.angularVelocity.y + torque.y,
            z: diceState.angularVelocity.z + torque.z
          };
          
          const maxAngVel = 10.0;
          const angSpeed = Math.sqrt(adjustedAngVel.x**2 + adjustedAngVel.y**2 + adjustedAngVel.z**2);
          if (angSpeed > maxAngVel) {
            const scale = maxAngVel / angSpeed;
            adjustedAngVel.x *= scale;
            adjustedAngVel.y *= scale;
            adjustedAngVel.z *= scale;
          }
          
          return {
            position: { ...diceState.position },
            quaternion: { x: slerpedQuat.x, y: slerpedQuat.y, z: slerpedQuat.z, w: slerpedQuat.w },
            velocity: newVel,
            angularVelocity: adjustedAngVel
          };
        }),
        timestamp: useOriginalFrame ? originalFrames[i].timestamp : (startFrame.timestamp + i * 16)
      };
      
      transitionFrames.push(newFrame);
    }
    
    if (transitionFrames.length > 0) {
      const lastFrame = transitionFrames[transitionFrames.length - 1];
      const finalFrame: PhysicsFrame = {
        diceStates: lastFrame.diceStates.map((diceState, idx) => {
          const targetRot = targetLandingOrientations[idx];
          const currentQuat = new CANNON.Quaternion(diceState.quaternion.x, diceState.quaternion.y, diceState.quaternion.z, diceState.quaternion.w);
          const finalQuat = slerpQuaternions(currentQuat, targetRot, 0.3);
          
          return {
            position: { ...diceState.position },
            quaternion: { x: finalQuat.x, y: finalQuat.y, z: finalQuat.z, w: finalQuat.w },
            velocity: {
              x: diceState.velocity.x * 0.4,
              y: diceState.velocity.y * 0.4,
              z: diceState.velocity.z * 0.4
            },
            angularVelocity: {
              x: diceState.angularVelocity.x * 0.2,
              y: diceState.angularVelocity.y * 0.2,
              z: diceState.angularVelocity.z * 0.2
            }
          };
        }),
        timestamp: lastFrame.timestamp + 16
      };
      
      transitionFrames.push(finalFrame);
    }
    
    return transitionFrames;
  }, [calculateLandingOrientation, calculateOrientingTorque, slerpQuaternions]);

  const createTransitionFrames = useCallback((
    startFrame: PhysicsFrame,
    targetValues: number[],
    numFrames: number
  ): PhysicsFrame[] => {
    const transitionFrames: PhysicsFrame[] = [];
    const startTime = startFrame.timestamp;
    const frameInterval = 16;
    
    const targetRotations = targetValues.map(value => calculateOrientationForFaceValue(value));
    
    for (let i = 0; i < numFrames; i++) {
      const progress = i / (numFrames - 1);
      
      const newFrame: PhysicsFrame = {
        diceStates: startFrame.diceStates.map((diceState, index) => {
          const target = targetRotations[index];
          const currentQuat = new CANNON.Quaternion(diceState.quaternion.x, diceState.quaternion.y, diceState.quaternion.z, diceState.quaternion.w);
          const slerpedQuat = slerpQuaternions(currentQuat, target, progress);
          
          const velocityFactor = 1 - progress;
          
          return {
            position: { ...diceState.position },
            quaternion: { x: slerpedQuat.x, y: slerpedQuat.y, z: slerpedQuat.z, w: slerpedQuat.w },
            velocity: {
              x: diceState.velocity.x * (velocityFactor * velocityFactor),
              y: diceState.velocity.y * (velocityFactor * velocityFactor),
              z: diceState.velocity.z * (velocityFactor * velocityFactor)
            },
            angularVelocity: {
              x: diceState.angularVelocity.x * (velocityFactor * velocityFactor),
              y: diceState.angularVelocity.y * (velocityFactor * velocityFactor),
              z: diceState.angularVelocity.z * (velocityFactor * velocityFactor)
            }
          };
        }),
        timestamp: startTime + i * frameInterval
      };
      
      transitionFrames.push(newFrame);
    }
    
    const finalFrame = transitionFrames[transitionFrames.length - 1];
    const zeroVelFrame: PhysicsFrame = {
      diceStates: finalFrame.diceStates.map(diceState => ({
        position: { ...diceState.position },
        quaternion: { ...diceState.quaternion },
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 }
      })),
      timestamp: finalFrame.timestamp + frameInterval
    };
    
    transitionFrames.push(zeroVelFrame);
    
    return transitionFrames;
  }, [calculateOrientationForFaceValue, slerpQuaternions]);

  // Get fresh desired results each time
  const generateDesiredResults = useCallback((): number[] => {
    const currentPreset = currentRiggingRef.current.preset;
    const currentCustom = currentRiggingRef.current.customResults;
    
    console.log("generateDesiredResults called with:", currentPreset, currentCustom);
    
    if (currentPreset === 'off') {
      return [];
    }
    
    if (currentPreset === 'custom') {
      return [...currentCustom];
    }
    
    const preset = RIGGING_PRESETS[currentPreset];
    const results = preset.generateResults();
    
    console.log(`Rigging with preset "${preset.name}": [${results.join(', ')}] = ${results.reduce((a, b) => a + b, 0)}`);
    return results;
  }, []);

  // Rig recording to get desired results
  const rigRecording = useCallback((recording: ShadowRecording): ShadowRecording => {
    const currentPreset = currentRiggingRef.current.preset;
    const currentCustomResults = currentRiggingRef.current.customResults;
    
    console.log("RIGGING: Current preset is:", currentPreset);
    
    const isRiggingEnabled = currentPreset !== 'off';
    
    if (!isRiggingEnabled) {
      console.log("Rigging disabled");
      return recording;
    }
    
    // Get fresh desired results based on current preset state
    let desiredResults: number[] = [];
    
    if (currentPreset === 'custom') {
      desiredResults = [...currentCustomResults];
    } else {
      const preset = RIGGING_PRESETS[currentPreset];
      desiredResults = preset.generateResults();
    }
    
    if (desiredResults.length === 0) {
      console.log("No desired results for rigging");
      return recording;
    }
    
    console.log("RIGGING RECORDING with preset:", currentPreset, "desired results:", desiredResults);
    
    if (recording.frames.length < 10) {
      console.log("Recording too short for rigging");
      return recording;
    }
    
    const midAirIndex = findMidairPoint(recording.frames);
    console.log(`Found mid-air point at index ${midAirIndex} out of ${recording.frames.length} frames`);
    
    const settleIndex = findSettleIndex(recording.frames);
    console.log(`Found settle index at ${settleIndex} out of ${recording.frames.length} frames`);
    
    const naturalFrames = recording.frames.slice(0, midAirIndex);
    
    const framesToInfluence = recording.frames.slice(
      midAirIndex, 
      Math.min(settleIndex, recording.frames.length)
    );
    
    const physicsInfluencedFrames = createNaturalTransitionFrames(
      recording.frames[midAirIndex],
      framesToInfluence,
      desiredResults,
      0.9
    );
    
    let remainingFrames: PhysicsFrame[] = [];
    if (settleIndex < recording.frames.length) {
      remainingFrames = createTransitionFrames(
        physicsInfluencedFrames[physicsInfluencedFrames.length - 1],
        desiredResults,
        TRANSITION_FRAMES
      );
    }
    
    const riggedRecording: ShadowRecording = {
      frames: [
        ...naturalFrames,
        ...physicsInfluencedFrames,
        ...remainingFrames
      ],
      finalResults: desiredResults,
      isComplete: true,
      isRigged: true,
      desiredResults: desiredResults
    };
    
    console.log(`Rigging complete. New recording has ${riggedRecording.frames.length} frames`);
    console.log("Recording rigged successfully. Original results vs Rigged results:", 
                recording.finalResults, "->", riggedRecording.finalResults);
    
    return riggedRecording;
  }, [findMidairPoint, findSettleIndex, createNaturalTransitionFrames, createTransitionFrames]);

  // Generic constraint functions
  const createGenericDiceConstraints = useCallback((
    targetWorld: CANNON.World | null,
    targetCubes: Cube[],
    targetConstraints: React.MutableRefObject<ConstraintData[]>
  ) => {
    if (!targetWorld || targetCubes.length < 2) return;
    targetConstraints.current.forEach(data => targetWorld.removeConstraint(data.constraint));
    targetConstraints.current = [];
    for (let i = 0; i < targetCubes.length; i++) {
      for (let j = i + 1; j < targetCubes.length; j++) {
        const bodyA = targetCubes[i].body;
        const bodyB = targetCubes[j].body;
        const initialDistance = bodyA.position.distanceTo(bodyB.position); 
        const constraint = new CANNON.DistanceConstraint(bodyA, bodyB, initialDistance, 10.0); 
        targetConstraints.current.push({ constraint, bodyA, bodyB });
        targetWorld.addConstraint(constraint);
      }
    }
  }, []);

  const removeAllGenericConstraints = useCallback((
    targetWorld: CANNON.World | null,
    targetConstraints: React.MutableRefObject<ConstraintData[]>
  ) => {
    if (!targetWorld) return;
    targetConstraints.current.forEach(data => targetWorld.removeConstraint(data.constraint));
    targetConstraints.current = [];
  }, []);

  // Function to reset dice to their starting positions
  const resetDicePositions = useCallback(() => {
    if (cubesRef.current.length === 0 || initialPositionsRef.current.length === 0) return;

    // First remove all constraints
    if (worldRef.current && constraintsRef.current.length > 0) {
      constraintsRef.current.forEach(data => {
        worldRef.current?.removeConstraint(data.constraint);
      });
    }

    cubesRef.current.forEach((cube, index) => {
      if (index < initialPositionsRef.current.length) {
        const initialPos = initialPositionsRef.current[index];
        
        // Position dice higher to allow for floating
        cube.body.position.copy(initialPos);
        cube.body.position.y += 2; // Position higher for floating effect
        
        // Reset velocity and rotation
        cube.body.velocity.set(0, 0, 0);
        cube.body.angularVelocity.set(0, 0, 0);
        
        // Set to awake state
        cube.body.wakeUp();
      }
    });

    // Recreate constraints after resetting positions
    createDiceConstraints();
    
    // Set low gravity if movement is enabled
    if (isMovementEnabled() && worldRef.current) {
      worldRef.current.gravity.set(0, -1, 0);
    }
  }, []);

  // Function to create constraints between dice
  const createDiceConstraints = useCallback(() => {
    createGenericDiceConstraints(worldRef.current, cubesRef.current, constraintsRef);
  }, [createGenericDiceConstraints]);

  const createShadowDiceConstraints = useCallback(() => {
    createGenericDiceConstraints(shadowWorldRef.current, shadowCubesRef.current, shadowConstraintsRef);
  }, [createGenericDiceConstraints]);

  // Function to remove all constraints between dice
  const removeAllConstraints = useCallback(() => {
    removeAllGenericConstraints(worldRef.current, constraintsRef);
  }, [removeAllGenericConstraints]);

  const removeAllShadowConstraints = useCallback(() => {
    removeAllGenericConstraints(shadowWorldRef.current, shadowConstraintsRef);
  }, [removeAllGenericConstraints]);

  const getShadowDiceValue = useCallback((cube: Cube): number => {
    const worldUp = new THREE.Vector3(0, 1, 0)
    const faceNormals = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ]
    const faceValues = [1, 6, 2, 5, 3, 4]
    const rotation = new THREE.Quaternion().copy(cube.body.quaternion as unknown as THREE.Quaternion)
    let maxAlignment = -Infinity, topFaceIndex = 0
    faceNormals.forEach((normal, index) => {
      const alignment = normal.clone().applyQuaternion(rotation).dot(worldUp)
      if (alignment > maxAlignment) {
        maxAlignment = alignment
        topFaceIndex = index
      }
    })
    return faceValues[topFaceIndex]
  }, [])

  const recordShadowFrame = useCallback(() => {
    if (!shadowRecordingRef.current.isRecording) return;
    
    const SHADOW_SPEED_MULTIPLIER = 6;
    const frameTime = shadowRecordingRef.current.frames.length * (1000 / 60) * SHADOW_SPEED_MULTIPLIER;
    
    const diceStates = shadowCubesRef.current.map(cube => ({
      position: {
        x: cube.body.position.x,
        y: cube.body.position.y,
        z: cube.body.position.z
      },
      quaternion: {
        x: cube.body.quaternion.x,
        y: cube.body.quaternion.y,
        z: cube.body.quaternion.z,
        w: cube.body.quaternion.w
      },
      velocity: {
        x: cube.body.velocity.x,
        y: cube.body.velocity.y,
        z: cube.body.velocity.z
      },
      angularVelocity: {
        x: cube.body.angularVelocity.x,
        y: cube.body.angularVelocity.y,
        z: cube.body.angularVelocity.z
      }
    }));
    
    const frame: PhysicsFrame = {
      timestamp: frameTime,
      diceStates
    };
    
    shadowRecordingRef.current.frames.push(frame);
    
    // STREAMING: Send frame to main dice immediately if streaming callback is set
    if (shadowRecordingRef.current.streamingCallback) {
      shadowRecordingRef.current.streamingCallback(frame);
    }
  }, []);

  const resetShadowDiceToFloatingState = useCallback(() => {
    if (!shadowWorldRef.current || shadowCubesRef.current.length === 0 || shadowInitialPositionsRef.current.length === 0) return;
    removeAllShadowConstraints();
    setIsShadowDiceThrown(false); 

    shadowCubesRef.current.forEach((cube, index) => {
      if (index < shadowInitialPositionsRef.current.length) {
        const basePos = shadowInitialPositionsRef.current[index];
        cube.body.type = CANNON.Body.DYNAMIC;
        cube.body.position.set(basePos.x, basePos.y + SHADOW_FLOAT_BASE_Y_OFFSET, basePos.z);
        cube.body.velocity.set(0, 0, 0);
        cube.body.angularVelocity.set(0, 0, 0);
        cube.body.linearDamping = 0.1; 
        cube.body.angularDamping = 0.1; 
        cube.body.wakeUp();
      }
    });
    
    createShadowDiceConstraints(); 
    shadowWorldRef.current.gravity.set(0, -1, 0); 
  }, [removeAllShadowConstraints, createShadowDiceConstraints]);

  const completeShadowRecording = useCallback(() => {
    if (!shadowRecordingRef.current.isRecording) return;
    
    console.log("COMPLETING SHADOW RECORDING");
    console.log("Current preset at completion time:", currentRiggingRef.current.preset);
    
    recordShadowFrame();
    
    const originalResults = shadowCubesRef.current.map(getShadowDiceValue);
    console.log("Shadow roll original results:", originalResults);
    
    let recording: ShadowRecording = {
      frames: [...shadowRecordingRef.current.frames],
      finalResults: originalResults,
      isComplete: true
    };
    
    // Apply rigging if enabled
    console.log("About to call rigRecording with current preset:", currentRiggingRef.current.preset);
    recording = rigRecording(recording);
    console.log("After rigging, final results are:", recording.finalResults);
    
    shadowRecordingRef.current.isRecording = false;
    shadowRollInProgressRef.current = false;
    
    // Clear streaming callback
    shadowRecordingRef.current.streamingCallback = null;
    
    shadowCubesRef.current.forEach(cube => {
      cube.body.type = CANNON.Body.STATIC;
      cube.body.sleep();
    });
    
    if (shadowRecordingRef.current.resolvePromise) {
      shadowRecordingRef.current.resolvePromise(recording);
      shadowRecordingRef.current.resolvePromise = null;
    }
    
    setTimeout(() => {
      resetShadowDiceToFloatingState();
    }, 1000);
  }, [recordShadowFrame, getShadowDiceValue, rigRecording, resetShadowDiceToFloatingState]);

  const simulateShadowRollFast = useCallback(() => {
    if (!shadowWorldRef.current || !shadowRecordingRef.current.isRecording) return;
    
    const FAST_TIME_STEP = 1/60;
    const STEPS_PER_FRAME = 6;
    const MAX_SIMULATION_FRAMES = 300;
    let frameCount = 0;
    let simulationTime = 0;
    
    const fastSimulate = () => {
      if (!shadowRecordingRef.current.isRecording || frameCount >= MAX_SIMULATION_FRAMES) {
        console.log("Fast shadow simulation completed or timed out");
        completeShadowRecording();
        return;
      }
      
      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        shadowWorldRef.current?.step(FAST_TIME_STEP);
        simulationTime += FAST_TIME_STEP;
        
        if (i === 0) {
          recordShadowFrame();
        }
      }
      
      frameCount++;
      
      const allSettled = shadowCubesRef.current.every(cube => {
        const linearSpeed = cube.body.velocity.length();
        const angularSpeed = cube.body.angularVelocity.length();
        const hasHitGround = cube.body.position.y < 1.0;
        return hasHitGround && linearSpeed < 0.15 && angularSpeed < 0.15;
      });
      
      if (allSettled) {
        console.log("Fast shadow dice settled after", frameCount, "frames");
        completeShadowRecording();
        return;
      }
      
      requestAnimationFrame(fastSimulate);
    };
    
    requestAnimationFrame(fastSimulate);
  }, [recordShadowFrame, completeShadowRecording]);

  // Apply saved state to shadow dice for perfect sync
  const applySavedStateToShadowDice = useCallback((states: DiceState[]) => {
    shadowCubesRef.current.forEach((cube, index) => {
      if (index < states.length) {
        const state = states[index];
        cube.body.position.set(state.position.x, state.position.y, state.position.z);
        cube.body.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
        cube.body.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
        cube.body.angularVelocity.set(state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z);
        cube.body.wakeUp();
      }
    });
  }, []);

  // Execute shadow throw with optional initial state and streaming support
  const executeShadowThrow = useCallback((throwStrength: number, initialState?: DiceState[]): Promise<ShadowRecording> => {
    return new Promise((resolve) => {
      console.log("EXECUTING SHADOW THROW with preset:", currentRiggingRef.current.preset, "strength:", throwStrength);
      
      if (!shadowWorldRef.current || shadowCubesRef.current.length === 0) {
        console.error("Shadow world not ready");
        resolve({ frames: [], finalResults: [1, 1, 1], isComplete: false });
        return;
      }

      // PERFECT SYNC: Use provided initial state or sync current state
      if (initialState) {
        console.log("Using provided initial state for perfect sync");
        applySavedStateToShadowDice(initialState);
      } else {
        console.log("Using current main dice state for sync");
        syncShadowDiceWithMain();
      }

      shadowRecordingRef.current = {
        isRecording: true,
        frames: [],
        startTime: 0,
        resolvePromise: resolve,
        streamingCallback: null // Will be set by streaming caller
      };

      setIsShadowDiceThrown(true);
      shadowRollInProgressRef.current = true;
      removeAllShadowConstraints();

      if (shadowWorldRef.current) {
        shadowWorldRef.current.gravity.set(0, -50, 0);
      }

      const baseThrowVelocity = new CANNON.Vec3(
        0, 
        DEFAULT_THROW_FORCE_Y * throwStrength,
        DEFAULT_THROW_FORCE_Z * throwStrength
      );

      shadowCubesRef.current.forEach((cube, index) => {
        cube.body.type = CANNON.Body.DYNAMIC;
        cube.body.wakeUp();
        cube.body.linearDamping = 0.05;
        cube.body.angularDamping = 0.05;

        // Add random initial rotation
        const randomInitialRotation = new CANNON.Quaternion();
        randomInitialRotation.setFromAxisAngle(
          new CANNON.Vec3(
            Math.random() - 0.5,
            Math.random() - 0.5, 
            Math.random() - 0.5
          ).unit(),
          Math.random() * Math.PI * 2
        );
        cube.body.quaternion = cube.body.quaternion.mult(randomInitialRotation);

        const variationScale = 0.3 * throwStrength;
        const vx = baseThrowVelocity.x + (Math.random() - 0.5) * variationScale * 2;
        const vy = baseThrowVelocity.y + (Math.random() - 0.5) * variationScale;
        const vz = baseThrowVelocity.z + (Math.random() - 0.5) * variationScale * 3;
        
        cube.body.velocity.set(vx, vy, vz);
        
        // Enhanced random angular velocity
        const baseAngularStrength = (4 + Math.random() * 4) * throwStrength;
        
        const angularX = (Math.random() - 0.5) * baseAngularStrength * (0.5 + Math.random() * 1.5);
        const angularY = (Math.random() - 0.5) * baseAngularStrength * (0.5 + Math.random() * 1.5);
        const angularZ = (Math.random() - 0.5) * baseAngularStrength * (0.5 + Math.random() * 1.5);
        
        const biasX = Math.sin(index * 1.2) * 2 * throwStrength;
        const biasY = Math.cos(index * 0.8) * 2 * throwStrength;
        const biasZ = Math.sin(index * 1.5) * 2 * throwStrength;
        
        cube.body.angularVelocity.set(
          angularX + biasX,
          angularY + biasY,
          angularZ + biasZ
        );
        
        // Add occasional extra spin boost
        if (Math.random() < 0.3) {
          const spinBoost = 3 + Math.random() * 4;
          const spinAxis = Math.floor(Math.random() * 3);
          if (spinAxis === 0) cube.body.angularVelocity.x += (Math.random() - 0.5) * spinBoost;
          else if (spinAxis === 1) cube.body.angularVelocity.y += (Math.random() - 0.5) * spinBoost;
          else cube.body.angularVelocity.z += (Math.random() - 0.5) * spinBoost;
        }
      });

      console.log("Shadow throw forces applied, starting simulation with streaming");
      
      simulateShadowRollFast();
    });
  }, [removeAllShadowConstraints, simulateShadowRollFast, applySavedStateToShadowDice, syncShadowDiceWithMain]);

  // Get the updated hook with accelerometer-based movement control
  const { 
    handleMotionUpdate, 
    startThrow,
    forceThrow,
    enableMovement, 
    disableMovement,
    resetNeutralPosition,
    getDeadzoneStatus,
    getAccelerometerDebugInfo,
    calibrate,
    isMovementEnabled,
    isFloatingMode,
    initFloating,
    streamFrameToMainDice
  } = useAccelerometerDice(
    cubesRef, 
    isThrowingRef, 
    setRollResults, 
    setIsThrowing,
    resetDicePositions,
    worldRef,
    removeAllConstraints,
    createDiceConstraints,
    (throwStrength: number, initialState?: DiceState[]) => {
      // Set up streaming callback before starting shadow throw
      shadowRecordingRef.current.streamingCallback = streamFrameToMainDice;
      return executeShadowThrow(throwStrength, initialState);
    }
  );


  useEffect(() => {
    isThrowingRef.current = isThrowing
  }, [isThrowing])

  // Initialize floating animation at startup
  useEffect(() => {
    if (floatingInitializedRef.current || 
        !worldRef.current || 
        cubesRef.current.length === 0 || 
        !initialPositionsRef.current.length) {
      return;
    }
    
    const initTimer = setTimeout(() => {
      initFloating();
      floatingInitializedRef.current = true;
      setIsFloating(true);
      console.log("Initialized floating animation on startup");
    }, 500);
    
    return () => clearTimeout(initTimer);
  }, [worldRef, cubesRef, initialPositionsRef, initFloating]);

  // Enhanced effect: Set neutral position and handle initial setup with better validation
  useEffect(() => {
    if (motionAccessGranted && motion && 
        motion.accelerationIncludingGravity.x !== null && 
        motion.accelerationIncludingGravity.y !== null && 
        motion.accelerationIncludingGravity.z !== null && 
        !neutralPositionSetRef.current && 
        !isThrowing && !isVisible) {
      
      console.log("Valid motion data received, calibrating...", {
        x: motion.accelerationIncludingGravity.x,
        y: motion.accelerationIncludingGravity.y,
        z: motion.accelerationIncludingGravity.z
      });
      
      calibrate(motion);
      neutralPositionSetRef.current = true;
      
      if (constraintsRef.current.length === 0) {
        createDiceConstraints();
      }
      
      if (!floatingInitializedRef.current) {
        setTimeout(() => {
          initFloating();
          floatingInitializedRef.current = true;
          setIsFloating(true);
          console.log("Floating animation initialized successfully");
        }, 100);
      }
    }
  }, [motionAccessGranted, motion, calibrate, isThrowing, isVisible, createDiceConstraints, initFloating]);

  // Effect to handle shake detection
  useEffect(() => {
    if (movementUnlocked || isThrowing || isVisible) {
      return;
    }
    
    if (motionReady && isShaking) {
      console.log("Shake detected! Unlocking movement with floating mode.");
      setMovementUnlocked(true);
      setIsFloating(true);
      
      setTimeout(() => {
        enableMovement();
        
        if (worldRef.current) {
          worldRef.current.gravity.set(0, -1, 0);
        }
      }, 100);
    }
  }, [motionReady, isShaking, movementUnlocked, enableMovement, isThrowing, isVisible, worldRef]);

  // Update floating state based on dice controller state
  useEffect(() => {
    if (!isThrowing && !isVisible) {
      const floatingState = isFloatingMode();
      setIsFloating(floatingState);
    }
  }, [isThrowing, isVisible, isFloatingMode]);

  // Poll deadzone status frequently for UI updates
  useEffect(() => {
    if (!isThrowing && !isVisible && motionReady) {
      const updateStatus = () => {
        const status = getDeadzoneStatus();
        setDeadzoneState(status);
        
        const debugInfo = getAccelerometerDebugInfo();
        setAccelDebugInfo(debugInfo);
        
        if (motion.accelerationIncludingGravity.x !== null && 
            motion.accelerationIncludingGravity.y !== null && 
            motion.accelerationIncludingGravity.z !== null) {
          setAccelerometerValues({
            x: motion.accelerationIncludingGravity.x,
            y: motion.accelerationIncludingGravity.y,
            z: motion.accelerationIncludingGravity.z,
            tiltX: debugInfo.tiltX,
            tiltY: debugInfo.tiltY
          });
        }
      };
      
      const interval = setInterval(updateStatus, 30);
      return () => clearInterval(interval);
    }
  }, [isThrowing, isVisible, motionReady, getDeadzoneStatus, getAccelerometerDebugInfo, motion]);

  // Process motion updates
  useEffect(() => {
    if (motion) {
      handleMotionUpdate(motion);
    }
  }, [motion, handleMotionUpdate]);

  // Standard Three.js setup and materials code...
  const materials = useMemo(() => {
    const loader = new THREE.TextureLoader()
    
    const textures = [
      loader.load("/dice/1.png"),
      loader.load("/dice/2.png"),
      loader.load("/dice/3.png"),
      loader.load("/dice/4.png"),
      loader.load("/dice/5.png"),
      loader.load("/dice/6.png")
    ];
    
    return [
      new THREE.MeshStandardMaterial({ map: textures[0] }),
      new THREE.MeshStandardMaterial({ map: textures[5] }),
      new THREE.MeshStandardMaterial({ map: textures[1] }),
      new THREE.MeshStandardMaterial({ map: textures[4] }),
      new THREE.MeshStandardMaterial({ map: textures[2] }),
      new THREE.MeshStandardMaterial({ map: textures[3] })
    ]
  }, [])

  const spawnCubes = useCallback(
    (scene: THREE.Scene, world: CANNON.World, cubeMaterial: CANNON.Material): Cube[] => {
      const cubes: Cube[] = []
      const initialPositions: CANNON.Vec3[] = []
      const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6)
  
      for (let i = 0; i < 3; i++) {
        const cubeMesh = new THREE.Mesh(geometry, materials)
        cubeMesh.position.set(0, 7, 2)
        scene.add(cubeMesh)
        
        const initialPos = new CANNON.Vec3(-2 + i * 2, 7, 2)
        initialPositions.push(initialPos.clone())
  
        const cubeShape = new CANNON.Box(new CANNON.Vec3(0.8, 0.8, 0.8))
        
        const cubeBody = new CANNON.Body({
          mass: 2.0,
          shape: cubeShape,
          position: initialPos,
          material: cubeMaterial,
          sleepSpeedLimit: 0.05,
          sleepTimeLimit: 0.05,
          allowSleep: false
        })
  
        cubeBody.updateMassProperties()
        cubeBody.angularDamping = 0.2 
        cubeBody.linearDamping = 0.1  
        cubeBody.collisionResponse = true
        cubeBody.material = cubeMaterial;
        cubeBody.wakeUp();
        
        world.addBody(cubeBody)
        
        cubes.push({ mesh: cubeMesh, body: cubeBody })
      }

      initialPositionsRef.current = initialPositions;
      return cubes
    },
    [materials],
  )

  const spawnShadowCubes = useCallback(
    (world: CANNON.World, cubeMaterial: CANNON.Material): Cube[] => {
      const cubes: Cube[] = []
      const initialPositions: CANNON.Vec3[] = []
      const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6)
  
      for (let i = 0; i < 3; i++) {
        // Shadow cubes don't need meshes - they're invisible
        const cubeMesh = new THREE.Mesh(geometry, materials)
        
        const initialPos = new CANNON.Vec3(-2 + i * 2, 7, 2)
        initialPositions.push(initialPos.clone())
  
        const cubeShape = new CANNON.Box(new CANNON.Vec3(0.8, 0.8, 0.8))
        
        const cubeBody = new CANNON.Body({
          mass: 2.0,
          shape: cubeShape,
          position: initialPos,
          material: cubeMaterial,
          sleepSpeedLimit: 0.05,
          sleepTimeLimit: 0.05,
          allowSleep: false
        })
  
        cubeBody.updateMassProperties()
        cubeBody.angularDamping = 0.2 
        cubeBody.linearDamping = 0.1  
        cubeBody.collisionResponse = true
        cubeBody.material = cubeMaterial;
        cubeBody.wakeUp();
        
        world.addBody(cubeBody)
        
        cubes.push({ mesh: cubeMesh, body: cubeBody })
      }

      shadowInitialPositionsRef.current = initialPositions;
      return cubes
    },
    [materials],
  )

  // Setup three.js scene
  useWindowResize(() => {
    if (cameraRef.current && rendererRef.current) {
      cameraRef.current.aspect = window.innerWidth / window.innerHeight
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(window.innerWidth, window.innerHeight)
    }
  })

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)

  // Toggle debug mode function
  const toggleDebugMode = useCallback(() => {
    setDebugMode(!debugMode)
  }, [debugMode])

  useEffect(() => {
    if (!mountRef.current) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, 5, 12)
    camera.lookAt(new THREE.Vector3(0, 1, 0))
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer

    const mountElement = mountRef.current
    mountElement.appendChild(renderer.domElement)

    // Main world setup
    const world = new CANNON.World()
    world.gravity.set(0, -1, 0)
    world.allowSleep = true
    world.defaultContactMaterial.friction = 0.2  
    world.defaultContactMaterial.restitution = 0.3  
    worldRef.current = world

    // Shadow world setup
    const shadowWorld = new CANNON.World()
    shadowWorld.gravity.set(0, -1, 0)
    shadowWorld.allowSleep = true
    shadowWorld.defaultContactMaterial.friction = 0.2  
    shadowWorld.defaultContactMaterial.restitution = 0.3  
    shadowWorldRef.current = shadowWorld

    // Initialize Cannon Debugger for main world
    cannonDebuggerRef.current = CannonDebugger(scene, world, {
      color: 0x00ff00,
    })

    // Initialize Shadow Debugger
    if (shadowWorld) {
      shadowDebuggerRef.current = CannonDebugger(scene, shadowWorld, {
        color: 0xff0000, // Red for shadow
        scale: 1.01,
        onInit(body: CANNON.Body, mesh: THREE.Mesh) {
          if (mesh.material instanceof THREE.MeshBasicMaterial) {
            mesh.material.wireframe = true;
            mesh.material.color.setHex(0xff0000);
            mesh.material.transparent = true;
            mesh.material.opacity = 0.6;
          }
          mesh.visible = showShadowDebug;
        }
      });
    }

    if ('iterations' in world.solver) {
      (world.solver as any).iterations = 25; 
    }
    if ('tolerance' in world.solver) {
      (world.solver as any).tolerance = 0.001;
    }

    if ('iterations' in shadowWorld.solver) {
      (shadowWorld.solver as any).iterations = 25; 
    }
    if ('tolerance' in shadowWorld.solver) {
      (shadowWorld.solver as any).tolerance = 0.001;
    }

    const cubeMaterial = new CANNON.Material("cubeMaterial")
    const wallMaterial = new CANNON.Material("wallMaterial")

    const cubeWallContact = new CANNON.ContactMaterial(cubeMaterial, wallMaterial, {
      friction: 0.4,
      restitution: 0.2,
      contactEquationStiffness: 1e8,  
      contactEquationRelaxation: 3,   
      frictionEquationStiffness: 1e8, 
    })
    
    const cubeCubeContact = new CANNON.ContactMaterial(cubeMaterial, cubeMaterial, {
      friction: 0.8,         
      restitution: 0.2,      
      contactEquationStiffness: 5e7,  
      frictionEquationStiffness: 5e7, 
    })

    world.addContactMaterial(cubeWallContact)
    world.addContactMaterial(cubeCubeContact)
    
    shadowWorld.addContactMaterial(cubeWallContact)
    shadowWorld.addContactMaterial(cubeCubeContact)

    spawnWalls(world, scene, wallMaterial)
    spawnWalls(shadowWorld, scene, wallMaterial) // Shadow walls don't need to be added to scene
    
    cubesRef.current = spawnCubes(scene, world, cubeMaterial)
    shadowCubesRef.current = spawnShadowCubes(shadowWorld, cubeMaterial)
    
    // Create constraints after cubes are spawned
    setTimeout(() => {
      createDiceConstraints();
      createShadowDiceConstraints();
      
      setTimeout(() => {
        if (!floatingInitializedRef.current) {
          console.log("Auto-initializing floating animation");
          initFloating();
          floatingInitializedRef.current = true;
          setIsFloating(true);
        }
      }, 100);
    }, 100);

    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(5, 10, 5)
    scene.add(light)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    const timeStep = 1 / 60;
    
    const animate = (time: number) => {
      requestAnimationFrame(animate)
      world.step(timeStep);
      shadowWorld.step(timeStep);

      // Sync shadow dice with main dice when not recording
      syncShadowDiceWithMain();

      // Update cannon debugger if debug mode is enabled
      if (debugMode && cannonDebuggerRef.current) {
        cannonDebuggerRef.current.update()
      }

      // Update shadow debugger if enabled
      if (shadowDebuggerRef.current && showShadowDebug) {
        shadowDebuggerRef.current.update()
      }

      cubesRef.current.forEach((cube, index) => {
        // Handle boundary checks and reset if needed
        if (Math.abs(cube.body.position.x) > 20 || 
            cube.body.position.y < -20 || 
            cube.body.position.y > 30 || 
            Math.abs(cube.body.position.z) > 20) {
          if (initialPositionsRef.current.length > 0) {
            const cubeIndex = cubesRef.current.indexOf(cube);
            if (cubeIndex >= 0 && cubeIndex < initialPositionsRef.current.length) {
              cube.body.position.copy(initialPositionsRef.current[cubeIndex]);
              cube.body.velocity.set(0, 0, 0);
              cube.body.angularVelocity.set(0, 0, 0);
            }
          }
        }
        
        // Update cube mesh position and rotation
        cube.mesh.position.copy(cube.body.position);
        cube.mesh.quaternion.copy(cube.body.quaternion);
      });

      renderer.render(scene, camera)
    }
    
    animate(0)

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth , window.innerHeight)
    }
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (mountElement && renderer.domElement) {
        mountElement.removeChild(renderer.domElement)
      }
    }
  }, [spawnCubes, spawnShadowCubes, createDiceConstraints, createShadowDiceConstraints, initFloating, debugMode, showShadowDebug, syncShadowDiceWithMain])

  // Request access to device motion sensors
  const handleRequestAccess = async () => {
    console.log("Requesting motion access...");
    
    try {
      const result = await requestMotionAccess()
      console.log("Motion access result:", result);
      
      if (result) {
        // Wait a bit for motion data to actually start flowing
        console.log("Waiting for motion data to stabilize...");
        
        setTimeout(() => {
          // Reset initialization flags to force re-initialization
          neutralPositionSetRef.current = false;
          floatingInitializedRef.current = false;
          setMovementUnlocked(false);
          setIsFloating(true);
          
          console.log("Motion access setup complete, waiting for motion data...");
        }, 200);
      }
    } catch (error) {
      console.error("Failed to request motion access:", error);
    }
  }

// Handle dice roll results and roll screen with auto-close timer
useEffect(() => {
  if (rollResults.length > 0 && !isThrowing) {
    disableMovement();
    setVisible(true);
    
    // Set auto-close timer
    const autoCloseTimer = setTimeout(() => {
      console.log("Auto-closing result screen");
      setVisible(false);
      
      // Reset game after screen closes
      setTimeout(() => {
        resetDicePositions();
        if (motionReady && motion) calibrate(motion);
        
        setTimeout(() => {
          createDiceConstraints();
          setMovementUnlocked(false);
          setIsFloating(true);
          initFloating();
          floatingInitializedRef.current = true;
          console.log("Auto-reset complete");
        }, rollScreenAnimationTimeRef.current);
      }, 50);
    }, 1500); // 5 seconds
    
    // Cleanup function to clear timer if component unmounts or effect re-runs
    return () => {
      clearTimeout(autoCloseTimer);
    };
  }
}, [rollResults, isThrowing]); // Simplified dependencies
  // Handle roll screen close
  const handleCloseRollScreen = useCallback(() => {
    setVisible(false);
    
    setTimeout(() => {
      resetDicePositions();
      if(motionReady && motion) calibrate(motion)
      
      setTimeout(() => {
        createDiceConstraints();
        setMovementUnlocked(false);
        setIsFloating(true);
        initFloating();
        floatingInitializedRef.current = true;
        
        console.log("Roll cycle complete. Movement locked - waiting for shake.");
      }, rollScreenAnimationTimeRef.current);
    }, 50);
  }, [resetDicePositions, createDiceConstraints, motionReady, motion, calibrate, initFloating]);

  // Calculate total of dice values
  const diceTotal = useMemo(() => {
    return rollResults.reduce((sum, value) => sum + value, 0);
  }, [rollResults]);

  // Disable movement when roll screen is visible
  useEffect(() => {
    if (isVisible) {
      disableMovement();
    }
  }, [isVisible, disableMovement]);

  // Debug forced throw
  const handleForceThrow = useCallback(() => {
    forceThrow(1.5);
  }, [forceThrow]);

  // Function to recalibrate the accelerometer
  const handleRecalibrate = useCallback(() => {
    if (motionReady && motion) {
      calibrate(motion);
      setMovementUnlocked(false);
      setIsFloating(true);
      initFloating();
      
      console.log("Recalibrated. Movement locked - waiting for shake.");
    }
  }, [motionReady, motion, calibrate, initFloating]);

  return (
    <>
      <button
        className={`fixed top-[20px] left-1/2 -translate-x-1/2 w-[200px] h-10 z-[99] text-white rounded-md transition-colors ${
          motionReady ? 'bg-green-500' : motionAccessGranted ? 'bg-yellow-500' : 'bg-blue-500'
        }`}
        onClick={handleRequestAccess}
      >
      </button>

      <RollScreen 
        isVisible={isVisible} 
        result={rollResults} 
        onClose={handleCloseRollScreen} 
      />

      <div 
        ref={mountRef} 
        className={`fixed top-0 left-0 w-screen h-screen overflow-hidden ${className || ""}`} 
        onClick={(e) => {
          if (showPresetMenu && !(e.target as Element).closest('.preset-menu')) {
            setShowPresetMenu(false);
          }
        }}
      />
    </>
  )
}