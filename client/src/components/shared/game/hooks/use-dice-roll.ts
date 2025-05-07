"use client"

import { useEffect } from "react"
import type React from "react"
import { useCallback, useRef, useState } from "react"
import * as CANNON from "cannon-es"
import * as THREE from "three"
import type { Cube } from "../game-board"
import type { DeviceOrientation } from "./use-device-orientation"

// Constants
const GRAVITY_STRENGTH = 200
const IMPULSE_MULTIPLIER = 8.2 
const TORQUE_MULTIPLIER = 0.4 
const ROTATION_THRESHOLD = 5  // Reduced from 8 to make it more sensitive
const DEAD_ZONE = 10 

// Increased damping for more cohesive movement during regular use
const LINEAR_DAMPING = 0.2  
const ANGULAR_DAMPING = 0.3  

const VELOCITY_THRESHOLD = 0.1
const ANGULAR_VELOCITY_THRESHOLD = 0.1
const STABLE_TIMEOUT = 100
const MAX_VELOCITY = 60
const MAX_ANGULAR_VELOCITY = 20
const DEADZONE_THROW_DELAY = 500 // milliseconds

// Define interfaces for type safety
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

interface SensorFusionDebugInfo {
  processedYaw: string;
  neutralYaw: string;
  yawDiff: string;
  rollPitchActivity: string;
  rawOrientation: {
    alpha: string;
    beta: string;
    gamma: string;
  } | null;
}

export const useDiceRoll = (
  cubesRef: React.MutableRefObject<Cube[]>,
  isThrowingRef: React.MutableRefObject<boolean>,
  setRollResults: React.Dispatch<React.SetStateAction<number[]>>,
  setIsThrowing: React.Dispatch<React.SetStateAction<boolean>>,
  resetDicePositions: () => void,
  worldRef: React.MutableRefObject<CANNON.World | null>,
  removeAllConstraints: () => void,  
  createDiceConstraints: () => void  
) => {
  // State management
  const [inDeadzone, setInDeadzone] = useState(false);
  const [deadzoneTimer, setDeadzoneTimer] = useState<number | null>(null);
  const [deadzoneProgress, setDeadzoneProgress] = useState(0);
  const [hasMoved, setHasMoved] = useState(false);
  
  // Core references
  const lastOrientation = useRef<DeviceOrientation | null>(null);
  const neutralPositionRef = useRef<number | null>(null);
  const throwVelocity = useRef<CANNON.Vec3>(new CANNON.Vec3());
  const isReleased = useRef(false);
  const isMovingEnabled = useRef<boolean>(true); // IMPORTANT: Default to true
  const floatingModeRef = useRef<boolean>(false); // IMPORTANT: Default to false to ensure movement
  
  // Simplified orientation tracking
  const lastProcessedYawRef = useRef<number>(0);
  const neutralYawRef = useRef<number>(0);
  
  // Animation frame request ID
  const animationFrameId = useRef<number | null>(null);
  
  // Update function that runs every frame
  const updateDeadzoneState = useCallback(() => {
    if (!inDeadzone || deadzoneTimer === null) return;
    
    const now = Date.now();
    const elapsed = now - deadzoneTimer;
    const newProgress = (elapsed / DEADZONE_THROW_DELAY) * 100;
    
    // Update progress
    setDeadzoneProgress(Math.min(100, newProgress));
    
    // Check if it's time to throw
    if (elapsed >= DEADZONE_THROW_DELAY && lastOrientation.current) {
      console.log("DEADZONE TIMER COMPLETE - THROWING");
      
      // Reset deadzone state
      setInDeadzone(false);
      setDeadzoneTimer(null);
      setDeadzoneProgress(0);
      
      // Disable floating mode before throw
      floatingModeRef.current = false;
      
      // Throw the dice
      startThrow(lastOrientation.current);
    }
    
    // Continue the animation loop
    animationFrameId.current = requestAnimationFrame(updateDeadzoneState);
  }, [inDeadzone, deadzoneTimer]);
  
  // Effect to manage the animation frame
  useEffect(() => {
    if (inDeadzone && deadzoneTimer !== null) {
      animationFrameId.current = requestAnimationFrame(updateDeadzoneState);
    } else if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    
    return () => {
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [inDeadzone, deadzoneTimer, updateDeadzoneState]);
  
  // Get angle difference considering wrap-around
  const getAngleDifference = (a1: number, a2: number): number => {
    const diff = ((a2 - a1 + 180) % 360) - 180;
    return diff < -180 ? diff + 360 : diff;
  };

  /**
   * SIMPLIFIED PROCESSING: Just use alpha directly with minimal filtering
   * This ensures the dice will definitely move in response to device rotation
   */
  const processOrientation = useCallback((orientation: DeviceOrientation): number => {
    if (orientation.alpha === null) {
      return lastProcessedYawRef.current;
    }
    
    // Simple smoothing for alpha value
    const smoothingFactor = 0.7; // Higher = more smoothing, lower = more responsive
    const alpha = orientation.alpha;
    
    // Apply a simple low-pass filter
    const filteredYaw = lastProcessedYawRef.current !== 0 
      ? lastProcessedYawRef.current * (1 - smoothingFactor) + alpha * smoothingFactor
      : alpha;
    
    // Store for next time
    lastProcessedYawRef.current = filteredYaw;
    
    // Log occasionally for debugging
    if (Math.random() < 0.01) {
      console.log(`Raw alpha: ${alpha}, Filtered: ${filteredYaw}`);
    }
    
    return filteredYaw;
  }, []);

  /**
   * Enhanced calibration function
   */
  const calibrate = useCallback((orientation: DeviceOrientation) => {
    if (orientation.alpha !== null) {
      // Process initial orientation with minimal filtering
      const processedYaw = orientation.alpha; // Direct use for simplicity
      
      // Set neutral position to processed yaw
      neutralYawRef.current = processedYaw;
      neutralPositionRef.current = orientation.alpha; // For backward compatibility
      lastProcessedYawRef.current = processedYaw;
      
      console.log("Calibrated to alpha:", processedYaw);
    }
    
    // Reset movement flag when calibrating
    setHasMoved(false);
    
    // IMPORTANT: Ensure floating mode is disabled to allow movement
    floatingModeRef.current = false;
    
    // IMPORTANT: Make sure movement is enabled
    isMovingEnabled.current = true;
    
    console.log("Calibration complete. Movement enabled:", isMovingEnabled.current);
  }, []);
  
  // Calculate dice values
  const getDiceValue = useCallback((cube: Cube): number => {
    const worldUp = new THREE.Vector3(0, 1, 0);
    const faceNormals = [
      new THREE.Vector3(1, 0, 0),   // Right (+X) - face 1
      new THREE.Vector3(-1, 0, 0),  // Left (-X) - face 6
      new THREE.Vector3(0, 1, 0),   // Top (+Y) - face 2
      new THREE.Vector3(0, -1, 0),  // Bottom (-Y) - face 5
      new THREE.Vector3(0, 0, 1),   // Front (+Z) - face 3
      new THREE.Vector3(0, 0, -1),  // Back (-Z) - face 4
    ];
    const faceValues = [1, 6, 2, 5, 3, 4];
    
    const rotation = new THREE.Quaternion(
      cube.body.quaternion.x,
      cube.body.quaternion.y,
      cube.body.quaternion.z,
      cube.body.quaternion.w
    );
    
    let maxAlignment = -Infinity;
    let topFaceIndex = 0;
    
    faceNormals.forEach((normal, index) => {
      const rotatedNormal = normal.clone();
      rotatedNormal.applyQuaternion(rotation);
      const alignment = rotatedNormal.dot(worldUp);
      
      if (alignment > maxAlignment) {
        maxAlignment = alignment;
        topFaceIndex = index;
      }
    });
    
    return faceValues[topFaceIndex];
  }, []);

  // Check if dice have settled
  const checkIfDiceSettled = useCallback(() => {
    if (!isThrowingRef.current || cubesRef.current.length === 0) return;

    const allSettled = cubesRef.current.every(cube => {
      const linearSpeed = cube.body.velocity.length();
      const angularSpeed = cube.body.angularVelocity.length();
      return linearSpeed < VELOCITY_THRESHOLD && angularSpeed < ANGULAR_VELOCITY_THRESHOLD;
    });

    if (allSettled) {
      // Read dice values after brief delay
      setTimeout(() => {
        if (!isThrowingRef.current) return; // Skip if no longer throwing
        
        const results = cubesRef.current.map(getDiceValue);
        
        // Update state
        setRollResults(results);
        setIsThrowing(false);
        isThrowingRef.current = false;
        isReleased.current = false;
        
        // Restore the higher damping values for regular movement
        cubesRef.current.forEach((cube) => {
          cube.body.linearDamping = LINEAR_DAMPING;
          cube.body.angularDamping = ANGULAR_DAMPING;
        });
        
        // IMPORTANT: Keep floating mode off to ensure continued movement
        floatingModeRef.current = false;
      }, STABLE_TIMEOUT);
    }
  }, [cubesRef, getDiceValue, isThrowingRef, setIsThrowing, setRollResults]);

  // Apply cohesive movement
  const applyCohesiveMovement = useCallback(() => {
    if (cubesRef.current.length === 0) return;
    
    // Set damping and wake up dice
    cubesRef.current.forEach(cube => {
      cube.body.linearDamping = LINEAR_DAMPING;
      cube.body.angularDamping = ANGULAR_DAMPING;
      cube.body.wakeUp();
    });
  }, [cubesRef]);

  // Clamp dice velocities
  const clampDiceVelocities = useCallback(() => {
    cubesRef.current.forEach((cube) => {
      const linearVel = cube.body.velocity;
      const linearSpeed = linearVel.length();
      if (linearSpeed > MAX_VELOCITY) {
        linearVel.scale(MAX_VELOCITY / linearSpeed, linearVel);
      }
      
      const angularVel = cube.body.angularVelocity;
      const angularSpeed = angularVel.length();
      if (angularSpeed > MAX_ANGULAR_VELOCITY) {
        angularVel.scale(MAX_ANGULAR_VELOCITY / angularSpeed, angularVel);
      }
    });
  }, [cubesRef]);

  // Enable dice movement
  const enableMovement = useCallback(() => {
    console.log("Movement EXPLICITLY enabled");
    isMovingEnabled.current = true;
    
    // Make sure dice are dynamic and awake
    cubesRef.current.forEach((cube) => {
      cube.body.type = CANNON.Body.DYNAMIC;
      cube.body.wakeUp();
      
      // Apply higher damping for more cohesive movement
      cube.body.linearDamping = LINEAR_DAMPING;
      cube.body.angularDamping = ANGULAR_DAMPING;
    });
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -30, 0);
    }
    
    // Reset movement flag when re-enabling movement
    setHasMoved(false);
    
    // IMPORTANT: Set floating mode to false to ensure dice respond to movement
    floatingModeRef.current = false;
    
    console.log("Movement status after enabling:", {
      isMovingEnabled: isMovingEnabled.current,
      floatingMode: floatingModeRef.current
    });
  }, [cubesRef, worldRef]);

  // Disable dice movement
  const disableMovement = useCallback(() => {
    console.log("Movement disabled");
    isMovingEnabled.current = false;
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -30, 0);
    }
    
    // Reset deadzone state
    setInDeadzone(false);
    setDeadzoneTimer(null);
    setDeadzoneProgress(0);
    
    // Reset movement flag
    setHasMoved(false);
  }, [worldRef]);

  // Reset neutral position
  const resetNeutralPosition = useCallback((orientation: DeviceOrientation) => {
    if (orientation && orientation.alpha !== null) {
      // Just use alpha directly for simplicity
      const processedYaw = orientation.alpha;
      
      // Set as new neutral position
      neutralYawRef.current = processedYaw;
      neutralPositionRef.current = orientation.alpha;
      lastProcessedYawRef.current = processedYaw;
      
      console.log("Neutral position reset to:", processedYaw);
    }
    
    // Reset deadzone state
    setInDeadzone(false);
    setDeadzoneTimer(null);
    setDeadzoneProgress(0);
    
    // Reset movement flag
    setHasMoved(false);
    
    // IMPORTANT: Make sure movement is enabled and floating mode is off
    isMovingEnabled.current = true;
    floatingModeRef.current = false;
  }, []);

  // DIRECT startThrow function
  const startThrow = useCallback(
    (orientation: DeviceOrientation, throwStrength = 1.0) => {
      console.log("THROW STARTED");
      
      // Skip if already throwing
      if (isThrowingRef.current) {
        console.log("Already throwing, skipping");
        return;
      }
      
      // Reset deadzone state
      setInDeadzone(false);
      setDeadzoneTimer(null);
      setDeadzoneProgress(0);
      
      // Clear any previous results
      setRollResults([]);
      
      // Enter throwing mode
      setIsThrowing(true);
      isThrowingRef.current = true;
      isReleased.current = false;
      
      // Disable floating mode during throw
      floatingModeRef.current = false;
      
      // Remove all constraints before throwing
      removeAllConstraints();
      
      // Process orientation to get yaw
      const alpha = orientation.alpha !== null ? orientation.alpha : 0;
      
      // Calculate yaw difference from neutral position
      const yawDiff = getAngleDifference(neutralPositionRef.current || 0, alpha);
      const normalizedYaw = Math.max(-1, Math.min(1, yawDiff / 45));

      // Calculate initial throw velocity
      throwVelocity.current.set(
        normalizedYaw * 5.5 * throwStrength,
        14 * throwStrength,
        -28.0 * throwStrength
      );
      
      // Apply velocity to all dice with increased variations
      cubesRef.current.forEach((cube) => {
        // Make sure dice are awake and dynamic
        cube.body.wakeUp();
        cube.body.type = CANNON.Body.DYNAMIC;
        
        // Apply throw velocity with increased variations for free movement
        const variationScale = 0.4; // Increased variation since constraints are removed
        cube.body.velocity.set(
          throwVelocity.current.x + (Math.random() - 0.5) * variationScale * throwStrength * 2,
          throwVelocity.current.y + (Math.random() - 0.5) * variationScale * throwStrength * 1.5,
          throwVelocity.current.z + (Math.random() - 0.5) * variationScale * throwStrength * 2
        );
        
        // Apply more varied rotations for natural throws
        const baseAngularVel = 10 * throwStrength; // Increased rotation
        cube.body.angularVelocity.set(
          (Math.random() - 0.5) * baseAngularVel,
          (Math.random() - 0.5) * baseAngularVel,
          (Math.random() - 0.5) * baseAngularVel
        );
        
        // Lower damping for more natural throws
        cube.body.linearDamping = 0.1;  // Lower damping during throws
        cube.body.angularDamping = 0.1; // Lower damping during throws
      });
      
      console.log("Throw successfully initiated - constraints removed");
      
      // Reset movement flag after throwing
      setHasMoved(false);
    },
    [cubesRef, getAngleDifference, isThrowingRef, removeAllConstraints, setIsThrowing, setRollResults],
  );

  // Handle orientation changes
  const handleOrientationUpdate = useCallback(
    (orientation: DeviceOrientation) => {
      // Save the last orientation
      lastOrientation.current = orientation;
      
      // Skip if no orientation data or calibration
      if (!orientation || orientation.alpha === null || 
          neutralPositionRef.current === null) {
        return;
      }
      
      // IMPORTANT: Check if movement is disabled
      if (!isMovingEnabled.current) {
        console.log("Movement disabled - skipping orientation update");
        return;
      }
      
      // Different logic for throwing vs positioning
      if (isThrowingRef.current) {
        // THROWING LOGIC
        // Ensure floating mode is disabled during throws
        floatingModeRef.current = false;
        
        // Check if dice have settled
        checkIfDiceSettled();
        
        // Apply forces to dice while in flight
        if (orientation.beta !== null) {
          const currentBeta = orientation.beta;
          const betaDelta = currentBeta - (lastOrientation.current?.beta || 0);
          
          if (betaDelta > 20 && !isReleased.current) {
            isReleased.current = true;
            cubesRef.current.forEach((cube) => {
              cube.body.velocity.y += throwVelocity.current.y * 1.0;
            });
          }
        }
        
        // Get alpha and calculate difference from neutral for force application
        const alpha = orientation.alpha;
        const normalizedAlpha = -1 * Math.max(-1, Math.min(1, 
          getAngleDifference(neutralPositionRef.current || 0, alpha) / 45));
        
        cubesRef.current.forEach((cube) => {
          const force = new CANNON.Vec3(normalizedAlpha * IMPULSE_MULTIPLIER, 0, 0);
          const torque = new CANNON.Vec3(
            0,
            (Math.random() - 0.5) * TORQUE_MULTIPLIER,
            (Math.random() - 0.5) * TORQUE_MULTIPLIER
          );
          
          cube.body.applyForce(force, cube.body.position);
          cube.body.applyTorque(torque);
        });
        
        clampDiceVelocities();
      } 
      else {
        // POSITIONING LOGIC - SIMPLIFIED FOR RELIABLE MOVEMENT
        if (!worldRef.current) return;
        
        // Disable floating mode to ensure dice move
        floatingModeRef.current = false;
        
        // Get alpha (yaw) and calculate difference from neutral
        const alpha = orientation.alpha;
        const baseAlpha = neutralPositionRef.current || 0;
        const alphaDiff = getAngleDifference(baseAlpha, alpha);
        const absAlphaDiff = Math.abs(alphaDiff);
        
        // Check if we're in deadzone - ONLY START TIMER IF DICE HAVE BEEN MOVED
        if (absAlphaDiff <= DEAD_ZONE) {
          // Only trigger deadzone if the user has moved first
          if (hasMoved && !inDeadzone) {
            console.log("ENTERED DEADZONE AFTER MOVEMENT");
            setInDeadzone(true);
            setDeadzoneTimer(Date.now());
            setDeadzoneProgress(0);
          } else if (!hasMoved) {
            console.log("In deadzone but waiting for initial movement");
          }
          
          // Use standard gravity while in deadzone
          worldRef.current.gravity.set(0, -30, 0);
        } 
        else {
          // Just exited deadzone
          if (inDeadzone) {
            console.log("EXITED DEADZONE");
            setInDeadzone(false);
            setDeadzoneTimer(null);
            setDeadzoneProgress(0);
          }
          
          // Skip movement if tilt is too small
          if (absAlphaDiff <= ROTATION_THRESHOLD) {
            worldRef.current.gravity.set(0, -30, 0);
            return;
          }
          
          // Set movement flag if not already set
          if (!hasMoved) {
            console.log("INITIAL MOVEMENT DETECTED!");
            setHasMoved(true);
          }
          
          // IMPORTANT: Apply stronger gravity for more obvious movement
          const tiltStrength = (absAlphaDiff - DEAD_ZONE) / (45 - DEAD_ZONE);
          // Increased multiplier for more responsive movement
          const scaledGravity = GRAVITY_STRENGTH * Math.min(1, tiltStrength) * IMPULSE_MULTIPLIER * 1.5;
          
          if (alphaDiff < 0) {
            worldRef.current.gravity.set(scaledGravity, -30, 0);
            if (Math.random() < 0.01) console.log(`Setting gravity LEFT: ${scaledGravity}`);
          } else {
            worldRef.current.gravity.set(-scaledGravity, -30, 0);
            if (Math.random() < 0.01) console.log(`Setting gravity RIGHT: ${scaledGravity}`);
          }
          
          // Ensure dice are awake and apply cohesive movement
          applyCohesiveMovement();
          clampDiceVelocities();
        }
      }
    },
    [
      applyCohesiveMovement,
      checkIfDiceSettled,
      clampDiceVelocities,
      cubesRef,
      getAngleDifference,
      hasMoved,
      inDeadzone,
      isThrowingRef,
      worldRef,
    ],
  );

  // Get current deadzone status (for UI)
  const getDeadzoneStatus = useCallback((): DeadzoneStatus => {
    return {
      inDeadzone: inDeadzone && hasMoved, // Only show as in deadzone if moved first
      progress: deadzoneProgress,
      timeMs: deadzoneTimer ? Date.now() - deadzoneTimer : 0,
      hasMoved: hasMoved,
      debug: {
        startTime: deadzoneTimer,
        currentTime: Date.now(),
        remaining: deadzoneTimer ? 
          Math.max(0, DEADZONE_THROW_DELAY - (Date.now() - deadzoneTimer)) : 0
      }
    };
  }, [inDeadzone, deadzoneProgress, deadzoneTimer, hasMoved]);
  
  // Function to check if we're in floating mode
  const getFloatingModeStatus = useCallback(() => {
    return floatingModeRef.current;
  }, []);

  // Function to toggle floating mode
  const setFloatingMode = useCallback((enabled: boolean) => {
    console.log(`Setting floating mode to: ${enabled}`);
    floatingModeRef.current = enabled;
  }, []);
  
  // Function to get sensor fusion debug info
  const getSensorFusionDebugInfo = useCallback((): SensorFusionDebugInfo => {
    const rawOri = lastOrientation.current;
    let rawOrientation = null;
    
    if (rawOri && rawOri.alpha !== null && rawOri.beta !== null && rawOri.gamma !== null) {
      rawOrientation = {
        alpha: rawOri.alpha.toFixed(2),
        beta: rawOri.beta.toFixed(2),
        gamma: rawOri.gamma.toFixed(2)
      };
    }
    
    return {
      processedYaw: lastProcessedYawRef.current.toFixed(2),
      neutralYaw: neutralYawRef.current.toFixed(2),
      yawDiff: getAngleDifference(
        neutralYawRef.current, 
        lastProcessedYawRef.current
      ).toFixed(2),
      rollPitchActivity: "N/A", // Simplified version doesn't track this
      rawOrientation
    };
  }, [getAngleDifference]);

  return {
    handleOrientationUpdate,
    startThrow,
    enableMovement,
    disableMovement,
    resetNeutralPosition,
    getDeadzoneStatus,
    getFloatingModeStatus,
    setFloatingMode,
    calibrate,
    getSensorFusionDebugInfo
  };
}