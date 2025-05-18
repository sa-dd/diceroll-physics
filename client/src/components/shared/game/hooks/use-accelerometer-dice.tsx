"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as CANNON from "cannon-es"
import * as THREE from "three"
import type { Cube } from "../game-board"
import type { DeviceMotionData } from "./use-device-motion"

// Constants for accelerometer-based movement
const GRAVITY_STRENGTH = 700
const IMPULSE_MULTIPLIER = 150.0
const TORQUE_MULTIPLIER = 0.2
const TILT_THRESHOLD = 0.25
const DEAD_ZONE = 0.9
const THROW_THRESHOLD = 5.0

// Constants for floating animation
const FLOAT_BASE_HEIGHT = 3.0
const FLOAT_AMPLITUDE = 0.2
const FLOAT_FREQUENCY = 0.4
const FLOAT_ROTATION_SPEED = 0.03

// Physics parameters
const LINEAR_DAMPING = 0.2
const ANGULAR_DAMPING = 0.9
const FLOATING_LINEAR_DAMPING = 0.1
const FLOATING_ANGULAR_DAMPING = 0.1
const GROUND_LINEAR_DAMPING = 0.2  // Higher damping when dice hit ground
const GROUND_ANGULAR_DAMPING = 0.35  // Higher angular damping when dice hit ground
const GROUND_Z_DAMPING_MULTIPLIER = 0.8  // Extra damping in Z direction
const VELOCITY_THRESHOLD = 0.8
const ANGULAR_VELOCITY_THRESHOLD = 0.1
const STABLE_TIMEOUT = 100
const MAX_VELOCITY = 100
const MAX_ANGULAR_VELOCITY = 5
const DEADZONE_THROW_DELAY = 50

// Boundary parameters to keep dice in camera view
const Z_MIN_BOUNDARY = -15  // Forward boundary (keep dice from rolling too far forward)
const Z_RESTORE_FORCE = 15  // Force to apply to bring dice back in bounds

// Recording constants
const RECORD_INTERVAL = 0.016 // ~60 FPS
const SETTLE_THRESHOLD = 0.10

// Rigging constants
const TRANSITION_FRAMES = 15  // Number of frames to smoothly transition to rigged values
const VELOCITY_SETTLE_THRESHOLD = 2.0  // Velocity threshold to identify when dice are nearly settled
const MIDAIR_HEIGHT_THRESHOLD = 2.0    // Height above which dice are considered in mid-air
const PHYSICS_INFLUENCE_FRAMES = 40    // Number of frames for gradual physics influence

// Throw constants
const DEFAULT_THROW_FORCE_Y = 2.0      // Upward force
const DEFAULT_THROW_FORCE_Z = -32.0    // Forward force (negative Z)
const DEFAULT_THROW_STRENGTH = 1.5     // Throw strength multiplier

// Face orientation mapping (MUST match Three.js material order)
const FACE_NORMALS = new Map<number, THREE.Vector3>([
  [1, new THREE.Vector3(0, 1, 0)],   // Top
  [6, new THREE.Vector3(0, -1, 0)],  // Bottom
  [2, new THREE.Vector3(1, 0, 0)],   // Right
  [5, new THREE.Vector3(-1, 0, 0)],  // Left
  [3, new THREE.Vector3(0, 0, 1)],   // Front
  [4, new THREE.Vector3(0, 0, -1)]   // Back
])

// Create reverse mapping for rigging (face value to normal vector)
const FACE_VALUE_TO_NORMAL = new Map<number, THREE.Vector3>([
  [1, new THREE.Vector3(1, 0, 0)],    // 1 is on right face (+X)
  [6, new THREE.Vector3(-1, 0, 0)],   // 6 is on left face (-X)
  [2, new THREE.Vector3(0, 1, 0)],    // 2 is on top face (+Y)
  [5, new THREE.Vector3(0, -1, 0)],   // 5 is on bottom face (-Y)
  [3, new THREE.Vector3(0, 0, 1)],    // 3 is on front face (+Z)
  [4, new THREE.Vector3(0, 0, -1)]    // 4 is on back face (-Z)
])

interface DeadzoneStatus {
  inDeadzone: boolean
  progress: number
  timeMs: number
  hasMoved: boolean
  debug: {
    startTime: number | null
    currentTime: number
    remaining: number
  }
}

interface AccelerometerDebugInfo {
  rawAcceleration: {
    x: string
    y: string
    z: string
  } | null
  filteredAcceleration: {
    x: string
    y: string
    z: string
  }
  acceleration: number
  tiltX: number
  tiltY: number
}

interface FloatingAnimState {
  timeAccumulator: number
  basePositions: CANNON.Vec3[]
  isActive: boolean
}

interface DiceFrame {
  positions: CANNON.Vec3[]
  rotations: CANNON.Quaternion[]
  velocities: CANNON.Vec3[]
  angularVelocities: CANNON.Vec3[]
  timestamp: number
}

interface DiceReplayState {
  isRecording: boolean
  isReplaying: boolean
  recordedFrames: DiceFrame[]
  currentFrame: number
  targetValues: number[]  // Values we want to rig the dice to show
  isRigged: boolean       // Flag to track if the recording has been rigged
  replayAnimationFrame: number | null
}

export const useAccelerometerDice = (
  cubesRef: React.MutableRefObject<Cube[]>,
  isThrowingRef: React.MutableRefObject<boolean>,
  setRollResults: React.Dispatch<React.SetStateAction<number[]>>,
  setIsThrowing: React.Dispatch<React.SetStateAction<boolean>>,
  resetDicePositions: () => void,
  worldRef: React.MutableRefObject<CANNON.World | null>,
  removeAllConstraints: () => void,
  createDiceConstraints: () => void
) => {
  const [inDeadzone, setInDeadzone] = useState(false)
  const [deadzoneTimer, setDeadzoneTimer] = useState<number | null>(null)
  const [deadzoneProgress, setDeadzoneProgress] = useState(0)
  const [hasMoved, setHasMoved] = useState(false)
  
  const lastMotion = useRef<DeviceMotionData | null>(null)
  const filteredAcceleration = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 })
  const throwVelocity = useRef<CANNON.Vec3>(new CANNON.Vec3())
  const isReleased = useRef(false)
  const isMovingEnabled = useRef<boolean>(false)
  const floatingModeRef = useRef<boolean>(true)
  const floatingAnimState = useRef<FloatingAnimState>({
    timeAccumulator: 0,
    basePositions: [],
    isActive: false
  })
  
  const diceHitGroundRef = useRef<boolean>(false)
  const groundHitTimeRef = useRef<number | null>(null)
  const MIN_GROUND_SETTLE_TIME = 300
  
  const neutralAccelRef = useRef<{ x: number; y: number; z: number } | null>(null)
  
  const animationFrameId = useRef<number | null>(null)
  const pulsationAnimationId = useRef<number | null>(null)

  // Recording state with rigging additions
  const replayState = useRef<DiceReplayState>({
    isRecording: false,
    isReplaying: false,
    recordedFrames: [],
    currentFrame: 0,
    targetValues: Array(cubesRef.current.length).fill(6), // Default to all 6's
    isRigged: false,
    replayAnimationFrame: null
  })

  // A new function to calculate the orientation (quaternion) for a specific face value
  const calculateOrientationForFaceValue = useCallback((faceValue: number): CANNON.Quaternion => {
    // Get the normal vector for this face value
    const upVector = FACE_VALUE_TO_NORMAL.get(faceValue);
    if (!upVector) {
      console.error(`Unknown face value: ${faceValue}`);
      return new CANNON.Quaternion();
    }

    // Create rotation that aligns this normal with world up (0,1,0)
    const worldUp = new THREE.Vector3(0, 1, 0);
    
    // We need to find the rotation that transforms upVector to worldUp
    const quaternion = new THREE.Quaternion();
    
    // Angle between the vectors
    const angle = Math.acos(upVector.dot(worldUp) / (upVector.length() * worldUp.length()));
    
    if (Math.abs(angle) < 0.001 || Math.abs(angle - Math.PI) < 0.001) {
      // Vectors are parallel or opposite
      if (Math.abs(angle) < 0.001) {
        // Already aligned
        quaternion.set(0, 0, 0, 1);
      } else {
        // Opposite direction, rotate 180 degrees around X axis
        quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      }
    } else {
      // Cross product gives rotation axis
      const axis = new THREE.Vector3().crossVectors(upVector, worldUp).normalize();
      quaternion.setFromAxisAngle(axis, angle);
    }
    
    // Convert THREE quaternion to CANNON quaternion
    return new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }, []);

  // Find mid-air point where dice are descending but still above ground
  const findMidairPoint = useCallback((frames: DiceFrame[]): number => {
    // First find when the dice reach peak height after the throw
    let peakIndex = 0;
    let peakHeight = 0;
    
    // Find maximum height point
    for (let i = 0; i < frames.length; i++) {
      const avgHeight = frames[i].positions.reduce((sum, pos) => sum + pos.y, 0) / frames[i].positions.length;
      
      if (avgHeight > peakHeight) {
        peakHeight = avgHeight;
        peakIndex = i;
      }
    }
    
    // Now find a good point during initial ascent (about 30% up)
    // This is earlier than before - we're now influencing even during the upward trajectory
    for (let i = 0; i < peakIndex; i++) {
      const avgHeight = frames[i].positions.reduce((sum, pos) => sum + pos.y, 0) / frames[i].positions.length;
      const allAboveGround = frames[i].positions.every(pos => pos.y > 3.0); // Lower threshold
      
      // Find a point during early ascent that's roughly 30% of the way to peak
      if (allAboveGround && avgHeight > (peakHeight * 0.75)) {
        console.log(`Found early mid-air point at frame ${i} (height: ${avgHeight.toFixed(2)})`);
        return i;
      }
    }
    
    // Fallback: use a point 1/5 of the way through the recording (earlier than before)
    const fallbackIndex = Math.floor(frames.length / 4);
    console.log(`Falling back to earlier mid-air point at frame ${fallbackIndex}`);
    return fallbackIndex;
  }, []);

  // Find the index where dice are about to settle
  const findSettleIndex = useCallback((frames: DiceFrame[]): number => {
    // Start from the end and move backward
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i];
      
      // Check if all dice have low velocities
      const allSlowingDown = frame.velocities.every(vel => {
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        return speed < VELOCITY_SETTLE_THRESHOLD;
      });
      
      if (allSlowingDown) {
        // We want to start transition a bit before they completely settle
        return Math.max(0, i - 5);
      }
    }
    
    // If we can't find a good point, use 2/3 of the recording
    return Math.floor(frames.length * 2 / 3);
  }, []);

  // Calculate the torque needed to rotate toward desired orientation
  const calculateOrientingTorque = useCallback((
    currentRotation: CANNON.Quaternion,
    targetRotation: CANNON.Quaternion,
    strength: number = 1.0
  ): CANNON.Vec3 => {
    // Convert to THREE.js quaternions for easier math
    const currentQuat = new THREE.Quaternion(
      currentRotation.x, currentRotation.y, currentRotation.z, currentRotation.w
    );
    const targetQuat = new THREE.Quaternion(
      targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w
    );
    
    // Calculate the difference quaternion (rotation needed to get from current to target)
    const diffQuat = new THREE.Quaternion();
    const invertedCurrent = currentQuat.clone().invert();
    diffQuat.multiplyQuaternions(targetQuat, invertedCurrent);
    
    // Convert to axis-angle representation
    const axisAngle = new THREE.Vector3();
    let angle = 0;
    
    // Only extract axis if there's a significant rotation
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
    
    // Apply strength factor with a higher base multiplier (1.5x stronger)
    axisAngle.multiplyScalar(angle * strength * 1.5);
    
    return new CANNON.Vec3(axisAngle.x, axisAngle.y, axisAngle.z);
  }, []);

  // Custom quaternion slerp implementation since CANNON.js doesn't have a static slerp method
  const slerpQuaternions = useCallback((qa: CANNON.Quaternion, qb: CANNON.Quaternion, t: number): CANNON.Quaternion => {
    // Based on THREE.js quaternion slerp implementation
    if (t === 0) return new CANNON.Quaternion(qa.x, qa.y, qa.z, qa.w);
    if (t === 1) return new CANNON.Quaternion(qb.x, qb.y, qb.z, qb.w);

    const x = qa.x, y = qa.y, z = qa.z, w = qa.w;
    let qax = x, qay = y, qaz = z, qaw = w;
    let qbx = qb.x, qby = qb.y, qbz = qb.z, qbw = qb.w;

    // Calculate cosine
    let cosHalfTheta = qax * qbx + qay * qby + qaz * qbz + qaw * qbw;

    // If qa=qb or qa=-qb then theta = 0 and we can return qa
    if (Math.abs(cosHalfTheta) >= 1.0) {
      return new CANNON.Quaternion(qax, qay, qaz, qaw);
    }

    // Calculate temporary values
    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

    // If theta = 180 degrees then result is not fully defined
    // We could rotate around any axis normal to qa or qb
    if (Math.abs(sinHalfTheta) < 0.001) {
      const result = new CANNON.Quaternion(
        qax * 0.5 + qbx * 0.5,
        qay * 0.5 + qby * 0.5,
        qaz * 0.5 + qbz * 0.5,
        qaw * 0.5 + qbw * 0.5
      );
      return result;
    }

    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    // Calculate quaternion
    const result = new CANNON.Quaternion(
      qax * ratioA + qbx * ratioB,
      qay * ratioA + qby * ratioB,
      qaz * ratioA + qbz * ratioB,
      qaw * ratioA + qbw * ratioB
    );
    
    return result;
  }, []);

  // Calculate landing orientation that would naturally lead to desired face up
  const calculateLandingOrientation = useCallback((faceValue: number): CANNON.Quaternion => {
    // This is more complex than just the final orientation
    // We need to calculate what orientation in air would naturally lead to landing with desired face up
    
    // Get target face normal
    const targetNormal = FACE_VALUE_TO_NORMAL.get(faceValue);
    if (!targetNormal) {
      console.error(`Unknown face value: ${faceValue}`);
      return new CANNON.Quaternion();
    }
    
    // For a natural landing, we want the opposite face pointing down during descent
    // This makes physics naturally rotate it to have our target face up when it hits ground
    const oppositeVector = targetNormal.clone().multiplyScalar(-1);
    
    // Create a quaternion that orients this opposite vector downward (-Y in world space)
    const worldDown = new THREE.Vector3(0, -1, 0);
    
    // Calculate the quaternion that aligns oppositeVector with worldDown
    const quaternion = new THREE.Quaternion();
    
    // Angle between the vectors
    const angle = Math.acos(oppositeVector.dot(worldDown) / (oppositeVector.length() * worldDown.length()));
    
    if (Math.abs(angle) < 0.001 || Math.abs(angle - Math.PI) < 0.001) {
      // Vectors are parallel or opposite
      if (Math.abs(angle) < 0.001) {
        // Already aligned
        quaternion.set(0, 0, 0, 1);
      } else {
        // Opposite direction, rotate 180 degrees around X axis
        quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      }
    } else {
      // Cross product gives rotation axis
      const axis = new THREE.Vector3().crossVectors(oppositeVector, worldDown).normalize();
      quaternion.setFromAxisAngle(axis, angle);
    }
    
    // Add a slight random rotation around Y axis to make it look natural
    const randomYRotation = new THREE.Quaternion();
    randomYRotation.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), 
      (Math.random() - 0.5) * Math.PI * 0.25  // Up to ±22.5 degrees
    );
    
    // Apply the random Y rotation
    quaternion.premultiply(randomYRotation);
    
    // Convert THREE quaternion to CANNON quaternion
    return new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }, []);

  // Create natural transition frames with gradual physics influence
  const createNaturalTransitionFrames = useCallback((
    startFrame: DiceFrame,
    originalFrames: DiceFrame[],
    targetValues: number[],
    strengthFactor: number = 0.1
  ): DiceFrame[] => {
    const transitionFrames: DiceFrame[] = [];
    
    // Calculate target orientations for each die based on what face we want to show
    const targetLandingOrientations = targetValues.map(value => calculateLandingOrientation(value));
    
    const totalFrames = originalFrames.length > 0 ? originalFrames.length : PHYSICS_INFLUENCE_FRAMES;
    
    // Process each frame of the original physics simulation
    for (let i = 0; i < totalFrames; i++) {
      // Whether we're using original frames or generating new ones
      const useOriginalFrame = i < originalFrames.length;
      const frameToModify = useOriginalFrame ? originalFrames[i] : 
                          (i > 0 ? transitionFrames[i-1] : startFrame);
      
      // Calculate progress through the transition (0-1)
      const progress = i / totalFrames;
      
      // Modified sigmoid function for earlier, more aggressive influence
      // Faster at start, still smooth in middle, slower at end
      const sigmoidProgress = 1 / (1 + Math.exp(-15 * (progress - 0.35))); // Changed from -12 and 0.5
      
      // Apply influence earlier and stronger
      const appliedStrength = sigmoidProgress * strengthFactor * 1.2; // Extra 20% strength
      
      // Create a new frame by modifying the original
      const newFrame: DiceFrame = {
        // Start with positions from the previous frame if available, otherwise use original
        positions: frameToModify.positions.map((pos, idx) => {
          // In later frames, we should apply some physics to make the motion natural
          // If this is not the first frame, use velocity from previous frame
          if (i > 0 && transitionFrames.length > 0) {
            const prevPos = transitionFrames[i-1].positions[idx];
            const prevVel = transitionFrames[i-1].velocities[idx];
            const dt = 0.016; // 16ms between frames
            
            // Apply velocity with a small damping factor
            const newPos = prevPos.clone();
            newPos.x += prevVel.x * dt;
            newPos.y += prevVel.y * dt;
            newPos.z += prevVel.z * dt;
            
            return newPos;
          }
          return pos.clone();
        }),
        
        // Gradually influence rotations toward the landing orientation
        rotations: frameToModify.rotations.map((rot, idx) => {
          // Different influence strategy based on phase
          let targetRot;
          
          // During descent, aim for landing orientation
          targetRot = targetLandingOrientations[idx];
          
          // Smoothly interpolate toward target orientation - more influence
          return slerpQuaternions(rot, targetRot, appliedStrength);
        }),
        
        // Apply physics-based adjustments to velocities
        velocities: frameToModify.velocities.map((vel, idx) => {
          // Create a modified velocity that's influenced by our desired outcome
          const newVel = vel.clone();
          
          // As dice approach ground, ensure they have downward momentum
          if (frameToModify.positions[idx].y > MIDAIR_HEIGHT_THRESHOLD && progress > 0.3) { // Changed from 0.5
            newVel.y = Math.min(newVel.y, -2.5 * (1.0 - progress)); // Stronger downward motion (-2.5 vs -2.0)
          }
          
          // Add subtle horizontal adjustments to make motion look natural
          if (progress > 0.2) { // Start earlier (0.2 vs 0.3)
            // Stronger random horizontal adjustments
            newVel.x += (Math.random() - 0.5) * 0.15 * appliedStrength; // 0.15 vs 0.1
            newVel.z += (Math.random() - 0.5) * 0.15 * appliedStrength; // 0.15 vs 0.1
          }
          
          return newVel;
        }),
        
        // Apply calculated torque as angular velocity adjustments
        angularVelocities: frameToModify.angularVelocities.map((angVel, idx) => {
          // Calculate torque needed to achieve target orientation (stronger now)
          const torque = calculateOrientingTorque(
            frameToModify.rotations[idx],
            targetLandingOrientations[idx],
            appliedStrength * 0.3  // Increased from 0.2 - more subtle torque
          );
          
          // Apply torque as an adjustment to angular velocity
          const adjustedAngVel = angVel.clone();
          adjustedAngVel.x += torque.x;
          adjustedAngVel.y += torque.y;
          adjustedAngVel.z += torque.z;
          
          // Ensure angular velocity doesn't get too high
          const maxAngVel = 10.0; // Increased from 8.0
          const angSpeed = adjustedAngVel.length();
          if (angSpeed > maxAngVel) {
            adjustedAngVel.scale(maxAngVel / angSpeed, adjustedAngVel);
          }
          
          return adjustedAngVel;
        }),
        
        // Use original timestamp if available, otherwise increment based on last frame
        timestamp: useOriginalFrame ? 
                 originalFrames[i].timestamp : 
                 (i > 0 ? transitionFrames[i-1].timestamp + 16 : startFrame.timestamp + 16)
      };
      
      transitionFrames.push(newFrame);
    }
    
    // Add a final frame with reduced velocities to ensure smooth settling
    if (transitionFrames.length > 0) {
      const lastFrame = transitionFrames[transitionFrames.length - 1];
      const finalFrame: DiceFrame = {
        positions: lastFrame.positions.map(pos => pos.clone()),
        rotations: lastFrame.rotations.map((rot, idx) => {
          // Final adjustment to ensure correct orientation
          return slerpQuaternions(rot, targetLandingOrientations[idx], 0.3); // Increased from 0.2
        }),
        velocities: lastFrame.velocities.map(vel => {
          // Reduce velocity for smoother settling
          const reducedVel = vel.clone();
          reducedVel.scale(0.4, reducedVel); // 0.4 vs 0.5 - slower final motion
          return reducedVel;
        }),
        angularVelocities: lastFrame.angularVelocities.map(angVel => {
          // Reduce angular velocity for smoother settling
          const reducedAngVel = angVel.clone();
          reducedAngVel.scale(0.2, reducedAngVel); // 0.4 vs 0.5 - slower final rotation
          return reducedAngVel;
        }),
        timestamp: lastFrame.timestamp + 16
      };
      
      transitionFrames.push(finalFrame);
    }
    
    return transitionFrames;
  }, [calculateLandingOrientation, calculateOrientingTorque, slerpQuaternions]);

  // Create the transition frames for smooth rigging (for end of animation)
  const createTransitionFrames = useCallback((
    startFrame: DiceFrame,
    targetValues: number[],
    numFrames: number
  ): DiceFrame[] => {
    const transitionFrames: DiceFrame[] = [];
    const startTime = startFrame.timestamp;
    const frameInterval = 16; // ms between frames
    
    // Calculate target rotations for each die
    const targetRotations = targetValues.map(value => calculateOrientationForFaceValue(value));
    
    // Create frames for smooth transition
    for (let i = 0; i < numFrames; i++) {
      const progress = i / (numFrames - 1); // 0 to 1
      
      // Create interpolated positions, rotations, and velocities
      const positions = startFrame.positions.map(pos => pos.clone());
      
      // Interpolate rotations using our custom slerp implementation
      const rotations = startFrame.rotations.map((rot, index) => {
        const target = targetRotations[index];
        return slerpQuaternions(rot, target, progress);
      });
      
      // Gradually reduce velocities to give a settling effect
      const velocityFactor = 1 - progress;
      const velocities = startFrame.velocities.map(vel => {
        const reducedVel = vel.clone();
        reducedVel.scale(velocityFactor * velocityFactor, reducedVel); // Square for faster reduction
        return reducedVel;
      });
      
      // Similarly reduce angular velocities
      const angularVelocities = startFrame.angularVelocities.map(angVel => {
        const reducedAngVel = angVel.clone();
        reducedAngVel.scale(velocityFactor * velocityFactor, reducedAngVel);
        return reducedAngVel;
      });
      
      // Create the frame
      transitionFrames.push({
        positions,
        rotations,
        velocities,
        angularVelocities,
        timestamp: startTime + i * frameInterval
      });
    }
    
    // Add a final frame with zero velocities to ensure dice stop completely
    const finalFrame = transitionFrames[transitionFrames.length - 1];
    const zeroVelFrame = {
      positions: finalFrame.positions.map(pos => pos.clone()),
      rotations: finalFrame.rotations.map(rot => rot.clone()),
      velocities: finalFrame.positions.map(() => new CANNON.Vec3(0, 0, 0)),
      angularVelocities: finalFrame.positions.map(() => new CANNON.Vec3(0, 0, 0)),
      timestamp: finalFrame.timestamp + frameInterval
    };
    
    transitionFrames.push(zeroVelFrame);
    
    return transitionFrames;
  }, [calculateOrientationForFaceValue, slerpQuaternions]);

  // Rig the recording to show target values - updated to use gradual physics influence
  const rigRecording = useCallback(() => {
    if (replayState.current.recordedFrames.length < 10 || replayState.current.isRigged) {
      console.log("Recording too short or already rigged");
      return false;
    }
    
    console.log("Rigging dice recording to show values:", replayState.current.targetValues);
    
    // Find mid-air point for early influence
    const midAirIndex = findMidairPoint(replayState.current.recordedFrames);
    console.log(`Found mid-air point at index ${midAirIndex} out of ${replayState.current.recordedFrames.length} frames`);
    
    // Find settle point as fallback
    const settleIndex = findSettleIndex(replayState.current.recordedFrames);
    console.log(`Found settle index at ${settleIndex} out of ${replayState.current.recordedFrames.length} frames`);
    
    // Keep frames before mid-air point unchanged
    const naturalFrames = replayState.current.recordedFrames.slice(0, midAirIndex);
    
    // Extract frames from mid-air to settling for physics influence
    const framesToInfluence = replayState.current.recordedFrames.slice(
      midAirIndex, 
      Math.min(settleIndex, replayState.current.recordedFrames.length)
    );
    
    // Apply gradual physics influence to create natural-looking rigged frames
    const physicsInfluencedFrames = createNaturalTransitionFrames(
      replayState.current.recordedFrames[midAirIndex],
      framesToInfluence,
      replayState.current.targetValues,
      0.9 // Increased from 0.6 - stronger influence factor
    );
    
    // If there are any frames between physics influence and the end, add them
    let remainingFrames: DiceFrame[] = [];
    if (settleIndex < replayState.current.recordedFrames.length) {
      // Apply final adjustments for complete settling
      remainingFrames = createTransitionFrames(
        physicsInfluencedFrames[physicsInfluencedFrames.length - 1],
        replayState.current.targetValues,
        TRANSITION_FRAMES
      );
    }
    
    // Combine all phases
    replayState.current.recordedFrames = [
      ...naturalFrames,               // Keep natural throw until mid-air
      ...physicsInfluencedFrames,     // Apply gradual physics influence
      ...remainingFrames              // Final settling adjustments if needed
    ];
    
    replayState.current.isRigged = true;
    
    console.log(`Rigging complete. New recording has ${replayState.current.recordedFrames.length} frames`);
    return true;
  }, [findMidairPoint, findSettleIndex, createNaturalTransitionFrames, createTransitionFrames]);

  const updateDeadzoneState = useCallback(() => {
    if (!inDeadzone || deadzoneTimer === null) return;
    
    const now = Date.now();
    const elapsed = now - deadzoneTimer;
    const newProgress = (elapsed / DEADZONE_THROW_DELAY) * 100;
    
    setDeadzoneProgress(Math.min(100, newProgress));
    
    if (elapsed >= DEADZONE_THROW_DELAY) {
      console.log("DEADZONE TIMER COMPLETE - THROWING");
      
      setInDeadzone(false);
      setDeadzoneTimer(null);
      setDeadzoneProgress(0);
      
      floatingModeRef.current = false;
      stopFloatingAnimation();
      diceHitGroundRef.current = false;
      groundHitTimeRef.current = null;
      
      // Use consistent throw direction regardless of device orientation
      startThrow(DEFAULT_THROW_STRENGTH);
    }
    
    animationFrameId.current = requestAnimationFrame(updateDeadzoneState);
  }, [inDeadzone, deadzoneTimer]);

  const storeBasePositions = useCallback(() => {
    const positions: CANNON.Vec3[] = []
    
    cubesRef.current.forEach((cube) => {
      if (cube.body) {
        positions.push(cube.body.position.clone())
      }
    })
    
    floatingAnimState.current.basePositions = positions
  }, [cubesRef])

  const stopFloatingAnimation = useCallback(() => {
    if (pulsationAnimationId.current !== null) {
      cancelAnimationFrame(pulsationAnimationId.current)
      pulsationAnimationId.current = null
    }
    floatingAnimState.current.isActive = false
  }, [])

  const applyPulsatingAnimation = useCallback(() => {
    if (!floatingModeRef.current || isThrowingRef.current) {
      stopFloatingAnimation()
      return
    }
    
    floatingAnimState.current.timeAccumulator += 0.016
    const totalTime = floatingAnimState.current.timeAccumulator
    
    const pulsation = Math.sin(totalTime * FLOAT_FREQUENCY) * FLOAT_AMPLITUDE
    
    cubesRef.current.forEach((cube, index) => {
      if (!cube.body) return
      
      let basePos: CANNON.Vec3
      
      if (index < floatingAnimState.current.basePositions.length) {
        basePos = floatingAnimState.current.basePositions[index]
      } else {
        basePos = cube.body.position.clone()
        floatingAnimState.current.basePositions.push(basePos)
      }
      
      const targetY = FLOAT_BASE_HEIGHT + pulsation
      const yDiff = targetY - cube.body.position.y
      const xDiff = basePos.x - cube.body.position.x
      const zDiff = basePos.z - cube.body.position.z
      
      const yForce = yDiff * 12
      const xForce = xDiff * 4
      const zForce = zDiff * 4
      
      cube.body.applyForce(new CANNON.Vec3(xForce, yForce, zForce), cube.body.position)
      
      const rotX = Math.sin(totalTime * 1.1) * FLOAT_ROTATION_SPEED
      const rotY = Math.cos(totalTime * 0.7) * FLOAT_ROTATION_SPEED
      const rotZ = Math.sin(totalTime * 0.9) * FLOAT_ROTATION_SPEED
      
      cube.body.angularVelocity.set(rotX, rotY, rotZ)
      cube.body.linearDamping = FLOATING_LINEAR_DAMPING
      cube.body.angularDamping = FLOATING_ANGULAR_DAMPING
      cube.body.wakeUp()
    })
    
    pulsationAnimationId.current = requestAnimationFrame(applyPulsatingAnimation)
  }, [cubesRef, stopFloatingAnimation])

  const startFloatingAnimation = useCallback(() => {
    if (floatingAnimState.current.isActive) return
    
    console.log("Starting floating animation")
    
    floatingAnimState.current.timeAccumulator = 0
    storeBasePositions()
    floatingAnimState.current.isActive = true
    
    if (pulsationAnimationId.current !== null) {
      cancelAnimationFrame(pulsationAnimationId.current)
    }
    pulsationAnimationId.current = requestAnimationFrame(applyPulsatingAnimation)
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -1, 0)
    }
  }, [applyPulsatingAnimation, storeBasePositions, worldRef])

  useEffect(() => {
    if (inDeadzone && deadzoneTimer !== null) {
      animationFrameId.current = requestAnimationFrame(updateDeadzoneState)
    } else if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }
    
    return () => {
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }
    }
  }, [inDeadzone, deadzoneTimer, updateDeadzoneState])

  useEffect(() => {
    return () => {
      if (pulsationAnimationId.current !== null) {
        cancelAnimationFrame(pulsationAnimationId.current)
        pulsationAnimationId.current = null
      }
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }
      if (replayState.current.replayAnimationFrame !== null) {
        cancelAnimationFrame(replayState.current.replayAnimationFrame)
        replayState.current.replayAnimationFrame = null
      }
    }
  }, [])

  // Recording functions
  const startRecording = useCallback(() => {
    replayState.current = {
      ...replayState.current,
      isRecording: true,
      recordedFrames: [],
      currentFrame: 0,
      isRigged: false
    }
  }, [])

  const recordFrame = useCallback(() => {
    if (!replayState.current.isRecording) return

    const frame: DiceFrame = {
      positions: cubesRef.current.map(cube => cube.body.position.clone()),
      rotations: cubesRef.current.map(cube => cube.body.quaternion.clone()),
      velocities: cubesRef.current.map(cube => cube.body.velocity.clone()),
      angularVelocities: cubesRef.current.map(cube => cube.body.angularVelocity.clone()),
      timestamp: Date.now()
    }

    replayState.current.recordedFrames.push(frame)
  }, [cubesRef])

  const stopRecording = useCallback(() => {
    replayState.current.isRecording = false
  }, [])


const getDiceValue = useCallback((cube: Cube): number => {
    const worldUp = new THREE.Vector3(0, 1, 0)
    const faceNormals = [
      new THREE.Vector3(1, 0, 0),   // Right (+X) - face 1
      new THREE.Vector3(-1, 0, 0),  // Left (-X) - face 6
      new THREE.Vector3(0, 1, 0),   // Top (+Y) - face 2
      new THREE.Vector3(0, -1, 0),  // Bottom (-Y) - face 5
      new THREE.Vector3(0, 0, 1),   // Front (+Z) - face 3
      new THREE.Vector3(0, 0, -1),  // Back (-Z) - face 4
    ]
    const faceValues = [1, 6, 2, 5, 3, 4]
    
    const rotation = new THREE.Quaternion(
      cube.body.quaternion.x,
      cube.body.quaternion.y,
      cube.body.quaternion.z,
      cube.body.quaternion.w
    )
    
    let maxAlignment = -Infinity
    let topFaceIndex = 0
    
    faceNormals.forEach((normal, index) => {
      const rotatedNormal = normal.clone()
      rotatedNormal.applyQuaternion(rotation)
      const alignment = rotatedNormal.dot(worldUp)
      
      if (alignment > maxAlignment) {
        maxAlignment = alignment
        topFaceIndex = index
      }
    })
    
    return faceValues[topFaceIndex]
  }, [])

  const stopReplay = useCallback(() => {
    if (replayState.current.replayAnimationFrame !== null) {
      cancelAnimationFrame(replayState.current.replayAnimationFrame)
      replayState.current.replayAnimationFrame = null
    }
    
    replayState.current.isReplaying = false
    replayState.current.currentFrame = 0
    
    // Return to normal state
    setIsThrowing(false)
    isThrowingRef.current = false
  }, [setIsThrowing])

// Modified playbackFrame to ensure dice stay in place after settling
const playbackFrame = useCallback(() => {
  if (!replayState.current.isReplaying || replayState.current.recordedFrames.length === 0) {
    return
  }

  const frame = replayState.current.recordedFrames[replayState.current.currentFrame]
  
  if (frame) {
    cubesRef.current.forEach((cube, index) => {
      if (frame.positions[index] && frame.rotations[index]) {
        // Set positions and rotations
        cube.body.position.copy(frame.positions[index])
        cube.body.quaternion.copy(frame.rotations[index])
        
        // Sync mesh with body
        cube.mesh.position.copy(cube.body.position)
        cube.mesh.quaternion.copy(cube.body.quaternion)
        
        // Set velocities for smooth motion
        if (frame.velocities[index]) {
          cube.body.velocity.copy(frame.velocities[index])
        }
        if (frame.angularVelocities[index]) {
          cube.body.angularVelocity.copy(frame.angularVelocities[index])
        }
        
        cube.body.wakeUp()
      }
    })

    replayState.current.currentFrame++

    // Check if replay finished
    if (replayState.current.currentFrame >= replayState.current.recordedFrames.length) {
      // IMPORTANT: Make sure constraints remain removed
      removeAllConstraints()
      
      // FREEZE PHYSICS STATE
      cubesRef.current.forEach(cube => {
        // Explicitly set type to STATIC to prevent any movement
        cube.body.type = CANNON.Body.STATIC
        cube.body.velocity.set(0, 0, 0)
        cube.body.angularVelocity.set(0, 0, 0)
        cube.body.sleep()
        
        // Store final position and rotation
        const finalPosition = cube.body.position.clone()
        const finalRotation = cube.body.quaternion.clone()
        
        // Set mesh to exact final position
        cube.mesh.position.copy(finalPosition)
        cube.mesh.quaternion.copy(finalRotation)
      })
      
      // Disable any further physics influence
      if (worldRef.current) {
        worldRef.current.gravity.set(0, 0, 0)
      }
      
      stopReplay()
      
      // If replay completed, set the roll results
      if (replayState.current.isRigged) {
        setRollResults([...replayState.current.targetValues])
      } else {
        const results = cubesRef.current.map(getDiceValue)
        setRollResults(results)
      }
      
      // IMPORTANT: Make sure floating mode is disabled
      floatingModeRef.current = false
      stopFloatingAnimation()
    } else {
      // Schedule next frame
      replayState.current.replayAnimationFrame = requestAnimationFrame(playbackFrame)
    }
  }
}, [cubesRef, getDiceValue, setRollResults, stopReplay, removeAllConstraints, stopFloatingAnimation])

  // Modified startReplay to apply rigging if not already done
  const startReplay = useCallback(() => {
    if (replayState.current.recordedFrames.length === 0) {
      console.log("No recorded frames to replay")
      return
    }

    // Reset physics
    cubesRef.current.forEach(cube => {
      cube.body.velocity.set(0, 0, 0)
      cube.body.angularVelocity.set(0, 0, 0)
      cube.body.wakeUp()
    })

    // If we have target values but haven't rigged the recording yet, do it now
    if (!replayState.current.isRigged && replayState.current.targetValues.length > 0) {
      console.log("Rigging the recording before replay")
      rigRecording()
    }

    // Start replay
    replayState.current.isReplaying = true
    replayState.current.currentFrame = 0
    setIsThrowing(true)
    isThrowingRef.current = true
    
    // Begin playback
    playbackFrame()
  }, [cubesRef, playbackFrame, rigRecording, setIsThrowing])

  const hasRecording = useCallback(() => {
    return replayState.current.recordedFrames.length > 0
  }, [])

  const processAcceleration = useCallback((motion: DeviceMotionData) => {
    if (!motion.accelerationIncludingGravity.x || 
        !motion.accelerationIncludingGravity.y || 
        !motion.accelerationIncludingGravity.z) {
      return filteredAcceleration.current
    }
    
    const alpha = 0.8
    
    filteredAcceleration.current = {
      x: filteredAcceleration.current.x * alpha + motion.accelerationIncludingGravity.x * (1 - alpha),
      y: filteredAcceleration.current.y * alpha + motion.accelerationIncludingGravity.y * (1 - alpha),
      z: filteredAcceleration.current.z * alpha + motion.accelerationIncludingGravity.z * (1 - alpha)
    }
    
    return filteredAcceleration.current
  }, [])

  // Modified function to apply damping and boundary constraints when dice hit ground
  const checkForGroundHit = useCallback(() => {
    if (!isThrowingRef.current || diceHitGroundRef.current || cubesRef.current.length === 0) {
      return
    }
    
    const groundHit = cubesRef.current.some(cube => {
      return cube.body.position.y < 1.0
    })
    
    if (groundHit && !diceHitGroundRef.current) {
      console.log("DICE HIT GROUND - Applying enhanced damping")
      diceHitGroundRef.current = true
      groundHitTimeRef.current = Date.now()
      
      if (worldRef.current) {
        worldRef.current.gravity.set(0, -50, 0)
      }
      
      // Apply increased damping to limit motion, especially in Z direction
      cubesRef.current.forEach(cube => {
        cube.body.linearDamping = GROUND_LINEAR_DAMPING
        cube.body.angularDamping = GROUND_ANGULAR_DAMPING
        
        // Apply extra damping to Z velocity to prevent rolling out of view
        if (cube.body.velocity.z < 0) {  // If moving forward (negative Z)
          const dampedZVel = cube.body.velocity.z * (1 - GROUND_Z_DAMPING_MULTIPLIER * 0.05)
          cube.body.velocity.z = dampedZVel
        }
      })
    }
    
    // Check boundary constraints for all dice
    if (diceHitGroundRef.current) {
      cubesRef.current.forEach(cube => {
        // Check if dice are moving too far forward (negative Z)
        if (cube.body.position.z < Z_MIN_BOUNDARY) {
          // Apply a restoring force to push dice back into view
          const zForce = (Z_MIN_BOUNDARY - cube.body.position.z) * Z_RESTORE_FORCE
          cube.body.applyForce(
            new CANNON.Vec3(0, 0, zForce),
            cube.body.position
          )
          
          // Apply additional damping to z velocity
          cube.body.velocity.z *= 0.5
        }
      })
    }
  }, [cubesRef, isThrowingRef, worldRef])

// Modified checkIfDiceSettled to ensure dice stay in place after settling
const checkIfDiceSettled = useCallback(() => {
  if (!isThrowingRef.current || cubesRef.current.length === 0) return
  
  checkForGroundHit()
  
  if (!diceHitGroundRef.current || !groundHitTimeRef.current) {
    return
  }
  
  const groundHitElapsed = Date.now() - groundHitTimeRef.current
  if (groundHitElapsed < MIN_GROUND_SETTLE_TIME) {
    return
  }

  const allSettled = cubesRef.current.every(cube => {
    const linearSpeed = cube.body.velocity.length()
    const angularSpeed = cube.body.angularVelocity.length()
    return linearSpeed < SETTLE_THRESHOLD && angularSpeed < SETTLE_THRESHOLD
  })

  if (allSettled) {
    // IMPORTANT: Make sure constraints remain removed
    removeAllConstraints()

    // FREEZE PHYSICS STATE - Make sure dice are completely frozen in place
    cubesRef.current.forEach(cube => {
      // Explicitly set type to STATIC to prevent any movement
      cube.body.type = CANNON.Body.STATIC
      cube.body.velocity.set(0, 0, 0)
      cube.body.angularVelocity.set(0, 0, 0)
      cube.body.sleep()
      
      // Store final position and rotation
      const finalPosition = cube.body.position.clone()
      const finalRotation = cube.body.quaternion.clone()
      
      // Set mesh to exact final position
      cube.mesh.position.copy(finalPosition)
      cube.mesh.quaternion.copy(finalRotation)
    })
    
    // Disable any further physics influence
    if (worldRef.current) {
      worldRef.current.gravity.set(0, 0, 0)
    }
    
    // Stop recording
    stopRecording()
    
    const results = cubesRef.current.map(getDiceValue)
    
    setTimeout(() => {
      setRollResults(results)
      setIsThrowing(false)
      isThrowingRef.current = false
      isReleased.current = false
      
      // IMPORTANT: Make sure floating mode is disabled and no animations restart
      floatingModeRef.current = false
      stopFloatingAnimation()
    }, 50)
  }
}, [cubesRef, getDiceValue, isThrowingRef, setIsThrowing, setRollResults, checkForGroundHit, removeAllConstraints, stopRecording, stopFloatingAnimation])
  
  const applyCohesiveMovement = useCallback(() => {
    if (cubesRef.current.length === 0) return
    
    cubesRef.current.forEach(cube => {
      if (floatingModeRef.current) {
        cube.body.linearDamping = FLOATING_LINEAR_DAMPING
        cube.body.angularDamping = FLOATING_ANGULAR_DAMPING
      } else {
        cube.body.linearDamping = LINEAR_DAMPING
        cube.body.angularDamping = ANGULAR_DAMPING
      }
      cube.body.wakeUp()
    })
  }, [cubesRef])

  const clampDiceVelocities = useCallback(() => {
    cubesRef.current.forEach((cube) => {
      const linearVel = cube.body.velocity
      const linearSpeed = linearVel.length()
      if (linearSpeed > MAX_VELOCITY) {
        linearVel.scale(MAX_VELOCITY / linearSpeed, linearVel)
      }
      
      const angularVel = cube.body.angularVelocity
      const angularSpeed = angularVel.length()
      if (angularSpeed > MAX_ANGULAR_VELOCITY) {
        angularVel.scale(MAX_ANGULAR_VELOCITY / angularSpeed, angularVel)
      }
    })
  }, [cubesRef])

  const calibrate = useCallback((motion: DeviceMotionData) => {
    if (motion.accelerationIncludingGravity.x === null || 
        motion.accelerationIncludingGravity.y === null || 
        motion.accelerationIncludingGravity.z === null) {
      return
    }
    
    const processedAccel = {
      x: motion.accelerationIncludingGravity.x,
      y: motion.accelerationIncludingGravity.y,
      z: motion.accelerationIncludingGravity.z
    }
    
    neutralAccelRef.current = processedAccel
    filteredAcceleration.current = processedAccel
    
    console.log("Calibrated to acceleration:", processedAccel)
    setHasMoved(false)
    diceHitGroundRef.current = false
    groundHitTimeRef.current = null
    console.log("Calibration complete. Movement enabled:", isMovingEnabled.current)
  }, [])

  const initFloating = useCallback(() => {
    cubesRef.current.forEach((cube) => {
      if (cube.body) {
        cube.body.position.y = FLOAT_BASE_HEIGHT
        cube.body.velocity.set(0, 0, 0)
        cube.body.angularVelocity.set(0, 0, 0)
        cube.body.linearDamping = FLOATING_LINEAR_DAMPING
        cube.body.angularDamping = FLOATING_ANGULAR_DAMPING
        cube.body.wakeUp()
      }
    })
    
    createDiceConstraints()
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -1, 0)
    }
    
    floatingModeRef.current = true
    startFloatingAnimation()
    console.log("Initialized floating animation")
  }, [cubesRef, worldRef, createDiceConstraints, startFloatingAnimation])

  const enableMovement = useCallback(() => {
    console.log("Movement EXPLICITLY enabled")
    isMovingEnabled.current = true
    floatingModeRef.current = true
    
    cubesRef.current.forEach((cube) => {
      cube.body.type = CANNON.Body.DYNAMIC
      cube.body.wakeUp()
      cube.body.linearDamping = FLOATING_LINEAR_DAMPING
      cube.body.angularDamping = FLOATING_ANGULAR_DAMPING
    })
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -1, 0)
    }
    
    createDiceConstraints()
    setHasMoved(false)
    diceHitGroundRef.current = false
    groundHitTimeRef.current = null
    startFloatingAnimation()
    
    console.log("Movement status after enabling:", {
      isMovingEnabled: isMovingEnabled.current,
      floatingMode: floatingModeRef.current
    })
  }, [cubesRef, worldRef, createDiceConstraints, startFloatingAnimation])

  const disableMovement = useCallback(() => {
    console.log("Movement disabled")
    isMovingEnabled.current = false
    floatingModeRef.current = false
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -30, 0)
    }
    
    setInDeadzone(false)
    setDeadzoneTimer(null)
    setDeadzoneProgress(0)
    setHasMoved(false)
    diceHitGroundRef.current = false
    groundHitTimeRef.current = null
    stopFloatingAnimation()
  }, [worldRef, stopFloatingAnimation])

  const resetNeutralPosition = useCallback((motion: DeviceMotionData) => {
    if (motion.accelerationIncludingGravity.x === null || 
        motion.accelerationIncludingGravity.y === null || 
        motion.accelerationIncludingGravity.z === null) {
      return
    }
    
    const processedAccel = {
      x: motion.accelerationIncludingGravity.x,
      y: motion.accelerationIncludingGravity.y,
      z: motion.accelerationIncludingGravity.z
    }
    
    neutralAccelRef.current = processedAccel
    filteredAcceleration.current = processedAccel
    
    console.log("Neutral position reset to:", processedAccel)
    setInDeadzone(false)
    setDeadzoneTimer(null)
    setDeadzoneProgress(0)
    setHasMoved(false)
    diceHitGroundRef.current = false
    groundHitTimeRef.current = null
  }, [])

  // Modified startThrow function to always apply force in -Z (forward) and Y (up) direction
  const startThrow = useCallback(
    (throwStrength = DEFAULT_THROW_STRENGTH) => {
      console.log("THROW STARTED with strength:", throwStrength)
      
      if (isThrowingRef.current) {
        console.log("Already throwing, skipping")
        return
      }
      
      // Reset states
      setInDeadzone(false)
      diceHitGroundRef.current = false
      groundHitTimeRef.current = null
      setRollResults([])
      setIsThrowing(true)
      isThrowingRef.current = true
      isReleased.current = false
      removeAllConstraints()
      
      // Apply fixed throw velocity in -Z (forward) and Y (up) directions
      throwVelocity.current.set(
        0,  // No X velocity 
        DEFAULT_THROW_FORCE_Y * throwStrength,  // Upward force
        DEFAULT_THROW_FORCE_Z * throwStrength   // Forward force (negative Z)
      )
      
      // Strong gravity for consistent downward trajectory
      if (worldRef.current) {
        worldRef.current.gravity.set(0, -40, 0)
      }
      
      cubesRef.current.forEach((cube) => {
        cube.body.wakeUp()
        cube.body.type = CANNON.Body.DYNAMIC
        
        // Small random variation for natural look but keep main direction consistent
        const variationScale = 0.2
        
        const vx = (Math.random() - 0.5) * variationScale * throwStrength; // Small random X
        const vy = throwVelocity.current.y + (Math.random() - 0.5) * variationScale * throwStrength;
        const vz = throwVelocity.current.z + (Math.random() - 0.5) * variationScale * throwStrength;
        
        cube.body.velocity.set(vx, vy, vz);
        
        // Apply consistent spin for natural tumbling
        const baseAngularVel = 3 * throwStrength;
        cube.body.angularVelocity.set(
          (Math.random() - 0.5) * baseAngularVel,
          (Math.random() - 0.5) * baseAngularVel,
          (Math.random() - 0.5) * baseAngularVel
        )
        
        // Lower damping for natural physics during initial throw
        cube.body.linearDamping = 0.1
        cube.body.angularDamping = 0.1
      })

      // Start recording the throw and reset rigged state
      replayState.current.isRigged = false
      startRecording()
      
      console.log("Throw successfully initiated with fixed direction")
      setHasMoved(false)
    },
    [cubesRef, isThrowingRef, removeAllConstraints, setIsThrowing, setRollResults, worldRef, stopFloatingAnimation, startRecording]
  )

  const forceThrow = useCallback((throwStrength = DEFAULT_THROW_STRENGTH) => {
    startThrow(throwStrength)
  }, [startThrow])

  const handleMotionUpdate = useCallback(
    (motion: DeviceMotionData) => {
      lastMotion.current = motion
      
      if (!motion.accelerationIncludingGravity.x || 
          !motion.accelerationIncludingGravity.y || 
          !motion.accelerationIncludingGravity.z || 
          !neutralAccelRef.current) {
        return
      }
      
      // Process and filter acceleration
      processAcceleration(motion)
      
      // Skip recording if replaying
      if (replayState.current.isRecording && !replayState.current.isReplaying) {
        recordFrame()
      }

      if (isThrowingRef.current && !replayState.current.isReplaying) {
        checkForGroundHit()
        
        if (!diceHitGroundRef.current) {
          floatingModeRef.current = false
          
          const tiltX = filteredAcceleration.current.x - neutralAccelRef.current.x
          const normalizedTiltX = Math.max(-1, Math.min(1, tiltX / 3.0)) * IMPULSE_MULTIPLIER
          
          cubesRef.current.forEach((cube) => {
            const force = new CANNON.Vec3(normalizedTiltX, 0, 0)
            const torque = new CANNON.Vec3(
              0,
              (Math.random() - 0.5) * TORQUE_MULTIPLIER,
              (Math.random() - 0.5) * TORQUE_MULTIPLIER
            )
            
            cube.body.applyForce(force, cube.body.position)
            cube.body.applyTorque(torque)
          })
          
          clampDiceVelocities()
        }
        
        checkIfDiceSettled()
      } 
      else if (!isMovingEnabled.current || replayState.current.isReplaying) {
        return
      }
      else {
        if (!worldRef.current) return
        
        const tiltX = filteredAcceleration.current.x - neutralAccelRef.current.x
        const tiltMagnitude = Math.abs(tiltX)
        
        if (tiltMagnitude <= DEAD_ZONE) {
          if (hasMoved && !inDeadzone) {
            console.log("ENTERED DEADZONE AFTER MOVEMENT")
            setInDeadzone(true)
            setDeadzoneTimer(Date.now())
            setDeadzoneProgress(0)
          } else if (!hasMoved) {
            console.log("In deadzone but waiting for initial movement")
          }
          
          if (floatingModeRef.current) {
            worldRef.current.gravity.set(0, -1, 0)
          } else {
            worldRef.current.gravity.set(0, -30, 0)
          }
        } 
        else {
          if (inDeadzone) {
            console.log("EXITED DEADZONE")
            setInDeadzone(false)
            setDeadzoneTimer(null)
            setDeadzoneProgress(0)
          }
          
          if (tiltMagnitude <= TILT_THRESHOLD) {
            if (floatingModeRef.current) {
              worldRef.current.gravity.set(0, -1, 0)
            } else {
              worldRef.current.gravity.set(0, -30, 0)
            }
            return
          }
          
          if (!hasMoved) {
            console.log("INITIAL MOVEMENT DETECTED!")
            setHasMoved(true)
          }
          
          const tiltStrength = Math.min(1, (Math.abs(tiltX) - DEAD_ZONE) / (1.0 - DEAD_ZONE))
          const scaledGravity = GRAVITY_STRENGTH * tiltStrength
          const gravityX = tiltX * scaledGravity
          
          if (floatingModeRef.current) {
            worldRef.current.gravity.set(gravityX, -1, 0)
          } else {
            worldRef.current.gravity.set(gravityX, -30, 0)
          }
          
          applyCohesiveMovement()
          clampDiceVelocities()
        }
      }
    },
    [
      applyCohesiveMovement,
      checkIfDiceSettled,
      clampDiceVelocities,
      cubesRef,
      hasMoved,
      inDeadzone,
      isThrowingRef,
      isMovingEnabled,
      processAcceleration,
      worldRef,
      checkForGroundHit,
      recordFrame
    ],
  )

  const getDeadzoneStatus = useCallback((): DeadzoneStatus => {
    return {
      inDeadzone: inDeadzone && hasMoved,
      progress: deadzoneProgress,
      timeMs: deadzoneTimer ? Date.now() - deadzoneTimer : 0,
      hasMoved: hasMoved,
      debug: {
        startTime: deadzoneTimer,
        currentTime: Date.now(),
        remaining: deadzoneTimer ? 
          Math.max(0, DEADZONE_THROW_DELAY - (Date.now() - deadzoneTimer)) : 0
      }
    }
  }, [inDeadzone, deadzoneProgress, deadzoneTimer, hasMoved])

  const getAccelerometerDebugInfo = useCallback((): AccelerometerDebugInfo => {
    const rawMotion = lastMotion.current
    let rawAcceleration = null
    
    if (rawMotion && 
        rawMotion.accelerationIncludingGravity.x !== null && 
        rawMotion.accelerationIncludingGravity.y !== null && 
        rawMotion.accelerationIncludingGravity.z !== null) {
      rawAcceleration = {
        x: rawMotion.accelerationIncludingGravity.x.toFixed(2),
        y: rawMotion.accelerationIncludingGravity.y.toFixed(2),
        z: rawMotion.accelerationIncludingGravity.z.toFixed(2)
      }
    }
    
    const tiltX = neutralAccelRef.current && filteredAcceleration.current 
      ? filteredAcceleration.current.x - neutralAccelRef.current.x
      : 0
      
    const tiltY = neutralAccelRef.current && filteredAcceleration.current 
      ? filteredAcceleration.current.y - neutralAccelRef.current.y
      : 0
    
    const accelerationMagnitude = Math.sqrt(
      filteredAcceleration.current.x * filteredAcceleration.current.x +
      filteredAcceleration.current.y * filteredAcceleration.current.y +
      filteredAcceleration.current.z * filteredAcceleration.current.z
    )
    
    return {
      rawAcceleration,
      filteredAcceleration: {
        x: filteredAcceleration.current.x.toFixed(2),
        y: filteredAcceleration.current.y.toFixed(2),
        z: filteredAcceleration.current.z.toFixed(2)
      },
      acceleration: parseFloat(accelerationMagnitude.toFixed(2)),
      tiltX: parseFloat(tiltX.toFixed(2)),
      tiltY: parseFloat(tiltY.toFixed(2))
    }
  }, [])

  const isMovementEnabled = useCallback(() => {
    return isMovingEnabled.current
  }, [])

  const isFloatingMode = useCallback(() => {
    return floatingModeRef.current
  }, [])

  const getGroundHitStatus = useCallback(() => {
    return {
      hasHitGround: diceHitGroundRef.current,
      hitTime: groundHitTimeRef.current
    }
  }, [])

  const setTargetValues = useCallback((values: number[]) => {
    if (values.length !== cubesRef.current.length) {
      console.error(`Target values length (${values.length}) doesn't match dice count (${cubesRef.current.length})`);
      return false;
    }
    
    // Validate each value is between 1-6
    if (!values.every(v => v >= 1 && v <= 6)) {
      console.error("All target values must be between 1-6");
      return false;
    }
    
    console.log("Setting target dice values to:", values);
    replayState.current.targetValues = [...values];
    
    // If we already have a recording, mark it as not rigged yet
    if (replayState.current.recordedFrames.length > 0) {
      replayState.current.isRigged = false;
    }
    
    return true;
  }, [cubesRef]);

  const isReplaying = useCallback(() => {
    return replayState.current.isReplaying
  }, [])

  return {
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
    getGroundHitStatus,
    initFloating,
    setTargetValues,
    startReplay,
    rigRecording,
    hasRecording,
    isReplaying
  }
}