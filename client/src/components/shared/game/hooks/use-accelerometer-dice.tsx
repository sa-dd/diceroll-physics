// use-accelerometer-dice.tsx

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as CANNON from "cannon-es"
import * as THREE from "three"
import type { Cube } from "../game-board"
import type { DeviceMotionData } from "./use-device-motion"

// Constants for accelerometer-based movement
const GRAVITY_STRENGTH = 700 // Used for tilt-based gravity adjustment
const TILT_FORCE_MULTIPLIER = 7.5; // Multiplier for tilt-based force application
const TILT_THRESHOLD = 0.25 // Threshold for tilt activation
const DEAD_ZONE = 0.9 // Threshold for tilt to be considered active (acceleration diff)

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
const GROUND_LINEAR_DAMPING = 0.8 
const GROUND_ANGULAR_DAMPING = 0.35 
const GROUND_Z_DAMPING_MULTIPLIER = 0.8 
const VELOCITY_THRESHOLD = 0.8
const ANGULAR_VELOCITY_THRESHOLD = 0.1
const MAX_VELOCITY = 100 // Max linear velocity for dice
const MAX_ANGULAR_VELOCITY = 5 // Max angular velocity for dice
const DEADZONE_THROW_DELAY = 50 // Milliseconds to hold in deadzone before throw

// Boundary parameters
const Z_MIN_BOUNDARY = -15 // Minimum Z position for dice
const Z_RESTORE_FORCE = 15 // Force to push dice back from Z boundary

// Settle threshold
const SETTLE_THRESHOLD = 0.15 // Speed below which a die is considered settling

// Throw constants
const DEFAULT_THROW_FORCE_Y = 2.0      
const DEFAULT_THROW_FORCE_Z = -32.0    
const DEFAULT_THROW_STRENGTH = 1.5     

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
  acceleration: number // Magnitude of filtered acceleration
  tiltX: number // Processed tilt around X-axis
  tiltY: number // Processed tilt around Y-axis
}

interface FloatingAnimState {
  timeAccumulator: number
  basePositions: CANNON.Vec3[] // Store base X,Z for floating, Y is calculated
  isActive: boolean
}

// Shadow recording interface
interface ShadowRecording {
  frames: any[] // Consider a more specific type for frames if possible
  finalResults: number[]
  isComplete: boolean
  isRigged?: boolean
  desiredResults?: number[]
}

export const useAccelerometerDice = (
  cubesRef: React.MutableRefObject<Cube[]>,
  isThrowingRef: React.MutableRefObject<boolean>,
  setRollResults: React.Dispatch<React.SetStateAction<number[]>>,
  setIsThrowing: React.Dispatch<React.SetStateAction<boolean>>,
  resetDicePositions: () => void,
  worldRef: React.MutableRefObject<CANNON.World | null>,
  removeAllConstraints: () => void,
  createDiceConstraints: () => void,
  onShadowThrowNeeded: (throwStrength: number) => Promise<ShadowRecording>,
  initialPositionsRef: React.MutableRefObject<CANNON.Vec3[]>
) => {
  const [inDeadzone, setInDeadzone] = useState(false)
  const [deadzoneTimer, setDeadzoneTimer] = useState<number | null>(null)
  const [deadzoneProgress, setDeadzoneProgress] = useState(0)
  const [hasMoved, setHasMoved] = useState(false) // Tracks if user has made an initial tilt movement
  
  const lastMotion = useRef<DeviceMotionData | null>(null)
  const filteredAcceleration = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 })
  const isMovingEnabled = useRef<boolean>(false) // Controlled by enableMovement/disableMovement
  const floatingModeRef = useRef<boolean>(true) // Tracks if dice are in floating state
  const floatingAnimState = useRef<FloatingAnimState>({
    timeAccumulator: 0,
    basePositions: [],
    isActive: false
  })
  
  const diceHitGroundRef = useRef<boolean>(false) // Tracks if dice hit ground during a throw
  const groundHitTimeRef = useRef<number | null>(null) // Timestamp of ground hit
  const MIN_GROUND_SETTLE_TIME = 300 // ms, min time after ground hit before checking settle
  
  const neutralAccelRef = useRef<{ x: number; y: number; z: number } | null>(null) // Stores calibrated neutral acceleration
  
  const animationFrameId = useRef<number | null>(null) // For deadzone progress updates
  const pulsationAnimationId = useRef<number | null>(null) // For floating animation

  const playbackStateRef = useRef<{
    isPlayingBack: boolean
    recording: ShadowRecording | null
    startTime: number
    currentFrameIndex: number // Not strictly needed with timestamp-based playback
    isRigged: boolean
    riggedResults: number[]
  }>({
    isPlayingBack: false,
    recording: null,
    startTime: 0,
    currentFrameIndex: 0,
    isRigged: false,
    riggedResults: []
  })

  // Pre-throw animation state
  const preThrowAnimationRef = useRef<{
    isAnimating: boolean
    startTime: number
    startPositions: CANNON.Vec3[]
    targetPositions: CANNON.Vec3[]
    pendingThrowStrength: number
    animationFrameId: number | null
  }>({
    isAnimating: false,
    startTime: 0,
    startPositions: [],
    targetPositions: [],
    pendingThrowStrength: DEFAULT_THROW_STRENGTH,
    animationFrameId: null
  })

  const updateDeadzoneState = useCallback(() => {
    if (!inDeadzone || deadzoneTimer === null) { 
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
      return;
    }
    
    const now = Date.now();
    const elapsed = now - deadzoneTimer;
    const newProgress = Math.min(100, (elapsed / DEADZONE_THROW_DELAY) * 100);
    setDeadzoneProgress(newProgress);
    
    if (elapsed >= DEADZONE_THROW_DELAY) {
      console.log("DEADZONE TIMER COMPLETE - INITIATING SHADOW-FIRST THROW");
      
      setInDeadzone(false); 
      setDeadzoneTimer(null);
      setDeadzoneProgress(0);
      
      floatingModeRef.current = false;
      stopFloatingAnimation();
      diceHitGroundRef.current = false; 
      groundHitTimeRef.current = null;
      
      startShadowFirstThrow(DEFAULT_THROW_STRENGTH); 
    } else {
      animationFrameId.current = requestAnimationFrame(updateDeadzoneState);
    }
  }, [inDeadzone, deadzoneTimer]); 

  const storeBasePositions = useCallback(() => {
    const positions: CANNON.Vec3[] = []
    cubesRef.current.forEach((cube) => {
      if (cube.body) {
        positions.push(new CANNON.Vec3(cube.body.position.x, FLOAT_BASE_HEIGHT, cube.body.position.z));
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

  const stopPreThrowAnimation = useCallback(() => {
    if (preThrowAnimationRef.current.animationFrameId !== null) {
      cancelAnimationFrame(preThrowAnimationRef.current.animationFrameId)
      preThrowAnimationRef.current.animationFrameId = null
    }
    preThrowAnimationRef.current.isAnimating = false
  }, [])

  const animateToStartingPositions = useCallback(() => {
    if (!preThrowAnimationRef.current.isAnimating) return

    const currentTime = Date.now()
    const elapsed = currentTime - preThrowAnimationRef.current.startTime
    const duration = 200 // 600ms animation duration
    const progress = Math.min(elapsed / duration, 1)

    // Use easeOutCubic for smooth deceleration
    const easeProgress = 1 - Math.pow(1 - progress, 3)

    cubesRef.current.forEach((cube, index) => {
      if (index < preThrowAnimationRef.current.startPositions.length && 
          index < preThrowAnimationRef.current.targetPositions.length && cube.body) {
        
        const startPos = preThrowAnimationRef.current.startPositions[index]
        const targetPos = preThrowAnimationRef.current.targetPositions[index]

        // Interpolate position
        const currentX = startPos.x + (targetPos.x - startPos.x) * easeProgress
        const currentY = startPos.y + (targetPos.y - startPos.y) * easeProgress
        const currentZ = startPos.z + (targetPos.z - startPos.z) * easeProgress

        cube.body.position.set(currentX, currentY, currentZ)
        
        // Reduce velocities during animation for smoother movement
        cube.body.velocity.scale(0.9, cube.body.velocity)
        cube.body.angularVelocity.scale(0.9, cube.body.angularVelocity)
        
        cube.body.wakeUp()
      }
    })

    if (progress >= 1) {
      console.log("Pre-throw animation complete, starting actual throw")
      stopPreThrowAnimation()
      
      // Now start the actual throw with the pending strength
      executeActualThrow(preThrowAnimationRef.current.pendingThrowStrength)
    } else {
      // Continue animation
      preThrowAnimationRef.current.animationFrameId = requestAnimationFrame(animateToStartingPositions)
    }
  }, [cubesRef])

  const startPreThrowAnimation = useCallback((throwStrength: number) => {
    console.log("Starting pre-throw animation to move dice to starting positions")
    
    // Store current positions as start positions
    const startPositions: CANNON.Vec3[] = []
    const targetPositions: CANNON.Vec3[] = []
    
    cubesRef.current.forEach((cube, index) => {
      startPositions.push(cube.body.position.clone())
      
      // Target positions are the initial spawn positions (centered formation)
      if (index < initialPositionsRef.current.length) {
        const targetPos = initialPositionsRef.current[index].clone()
        targetPos.y = FLOAT_BASE_HEIGHT // Keep them at floating height
        targetPositions.push(targetPos)
      } else {
        targetPositions.push(cube.body.position.clone()) // Fallback
      }
    })

    preThrowAnimationRef.current = {
      isAnimating: true,
      startTime: Date.now(),
      startPositions,
      targetPositions,
      pendingThrowStrength: throwStrength,
      animationFrameId: null
    }

    // Disable floating animation and movement during pre-throw
    stopFloatingAnimation()
    floatingModeRef.current = false
    
    // Remove constraints to allow smooth movement
    removeAllConstraints()
    
    // Set appropriate physics for smooth animation
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -5, 0) // Light gravity during animation
    }
    
    cubesRef.current.forEach(cube => {
      cube.body.type = CANNON.Body.DYNAMIC
      cube.body.linearDamping = 0.8 // High damping for smooth movement
      cube.body.angularDamping = 0.8
      cube.body.wakeUp()
    })

    // Start the animation
    preThrowAnimationRef.current.animationFrameId = requestAnimationFrame(animateToStartingPositions)
  }, [cubesRef, initialPositionsRef, stopFloatingAnimation, removeAllConstraints, worldRef, animateToStartingPositions])

 const interpolateFrame = useCallback((frame1: any, frame2: any, t: number): any => {
    const interpolatedStates = frame1.diceStates.map((state1: any, index: number) => {
      const state2 = frame2.diceStates[index]
      
      const position = {
        x: state1.position.x + (state2.position.x - state1.position.x) * t,
        y: state1.position.y + (state2.position.y - state1.position.y) * t,
        z: state1.position.z + (state2.position.z - state1.position.z) * t
      }
      
      const q1 = new THREE.Quaternion(state1.quaternion.x, state1.quaternion.y, state1.quaternion.z, state1.quaternion.w)
      const q2 = new THREE.Quaternion(state2.quaternion.x, state2.quaternion.y, state2.quaternion.z, state2.quaternion.w)
      const interpolatedQuaternion = q1.slerp(q2, t) 
      
      const velocity = {
        x: state1.velocity.x + (state2.velocity.x - state1.velocity.x) * t,
        y: state1.velocity.y + (state2.velocity.y - state1.velocity.y) * t,
        z: state1.velocity.z + (state2.velocity.z - state1.velocity.z) * t
      }
      
      const angularVelocity = {
        x: state1.angularVelocity.x + (state2.angularVelocity.x - state1.angularVelocity.x) * t,
        y: state1.angularVelocity.y + (state2.angularVelocity.y - state1.angularVelocity.y) * t,
        z: state1.angularVelocity.z + (state2.angularVelocity.z - state1.angularVelocity.z) * t
      }
      
      return {
        position,
        quaternion: { x: interpolatedQuaternion.x, y: interpolatedQuaternion.y, z: interpolatedQuaternion.z, w: interpolatedQuaternion.w },
        velocity,
        angularVelocity
      }
    })
    
    return {
      timestamp: frame1.timestamp + (frame2.timestamp - frame1.timestamp) * t,
      diceStates: interpolatedStates
    }
  }, [])

 const applyRecordedFrame = useCallback((frame: any) => {
    const playback = playbackStateRef.current;
    
    cubesRef.current.forEach((cube, index) => {
      if (index < frame.diceStates.length && cube.body) {
        const state = frame.diceStates[index]
        
        cube.body.position.set(state.position.x, state.position.y, state.position.z)
        cube.body.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w)
        
        cube.body.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z)
        cube.body.angularVelocity.set(state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z)
        
        cube.body.wakeUp() 
      }
    })
    
    if (playback.isRigged && frame === playback.recording?.frames[playback.recording.frames.length - 1]) {
      console.log("Applied final rigged frame. Expected results:", playback.riggedResults);
    }
  }, [cubesRef])

const updatePlayback = useCallback(() => {
    const playback = playbackStateRef.current
    if (!playback.isPlayingBack || !playback.recording || playback.recording.frames.length === 0) return

    const currentTime = Date.now()
    const elapsedTime = currentTime - playback.startTime 
    
    let currentFrameIndex = -1
    let nextFrameIndex = -1
    
    for (let i = 0; i < playback.recording.frames.length - 1; i++) {
      if (elapsedTime >= playback.recording.frames[i].timestamp && 
          elapsedTime < playback.recording.frames[i + 1].timestamp) {
        currentFrameIndex = i
        nextFrameIndex = i + 1
        break
      }
    }
    
    if (currentFrameIndex !== -1 && nextFrameIndex !== -1) {
      const frame1 = playback.recording.frames[currentFrameIndex]
      const frame2 = playback.recording.frames[nextFrameIndex]
      
      const timeDiffBetweenFrames = frame2.timestamp - frame1.timestamp
      const t = timeDiffBetweenFrames > 0 ? (elapsedTime - frame1.timestamp) / timeDiffBetweenFrames : 0
      
      const interpolatedFrame = interpolateFrame(frame1, frame2, Math.max(0, Math.min(1, t)))
      applyRecordedFrame(interpolatedFrame)
    } else { 
      const lastFrame = playback.recording.frames[playback.recording.frames.length - 1]
      if (elapsedTime >= lastFrame.timestamp) { 
        applyRecordedFrame(lastFrame) 
        
        if (elapsedTime >= lastFrame.timestamp + 100) { 
          console.log("ENHANCED PLAYBACK COMPLETE - FINALIZING RESULTS");
          
          cubesRef.current.forEach(cube => { 
            cube.body.type = CANNON.Body.STATIC
            cube.body.velocity.set(0, 0, 0)
            cube.body.angularVelocity.set(0, 0, 0)
          })
          
          const finalResults = (playback.isRigged && playback.riggedResults.length > 0)
            ? playback.riggedResults 
            : playback.recording!.finalResults;
            
          console.log("Finalizing results:", finalResults, playback.isRigged ? "(RIGGED)" : "(NATURAL)");
          
          setTimeout(() => { 
            setRollResults(finalResults)
            setIsThrowing(false)
            isThrowingRef.current = false
            playback.isPlayingBack = false
            playback.recording = null
            playback.isRigged = false
            playback.riggedResults = []
            floatingModeRef.current = false 
            stopFloatingAnimation()
          }, 50) 
          
          return 
        }
      } else { 
        applyRecordedFrame(playback.recording.frames[0])
      }
    }
    
    requestAnimationFrame(updatePlayback) 
  }, [applyRecordedFrame, interpolateFrame, setRollResults, setIsThrowing, stopFloatingAnimation, isThrowingRef, cubesRef])

  const executeActualThrow = useCallback(async (throwStrength: number) => {
    console.log("EXECUTING ACTUAL THROW after pre-animation, strength:", throwStrength)
    
    if (isThrowingRef.current) return
    
    isThrowingRef.current = true
    setIsThrowing(true)
    diceHitGroundRef.current = false
    groundHitTimeRef.current = null

    try {
      console.log("Requesting shadow roll recording from main game component...")
      const shadowRecording = await onShadowThrowNeeded(throwStrength)
      
      console.log("Shadow roll recording received. Frames:", shadowRecording.frames.length, 
                  "Rigged:", shadowRecording.isRigged, "Desired:", shadowRecording.desiredResults)
      
      if (worldRef.current) { 
        worldRef.current.gravity.set(0, -50, 0)
      }
      
      cubesRef.current.forEach(cube => { 
        cube.body.type = CANNON.Body.DYNAMIC
        cube.body.linearDamping = 0.05
        cube.body.angularDamping = 0.05
        cube.body.wakeUp()
      })
      
      playbackStateRef.current = {
        isPlayingBack: true,
        recording: shadowRecording,
        startTime: Date.now(),
        currentFrameIndex: 0, 
        isRigged: shadowRecording.isRigged || false,
        riggedResults: (shadowRecording.isRigged && shadowRecording.desiredResults) ? shadowRecording.desiredResults : shadowRecording.finalResults
      }
      
      requestAnimationFrame(updatePlayback)
      
    } catch (error) {
      console.error("Shadow roll failed or was rejected, falling back to direct throw:", error)
      startDirectThrowImmediate(throwStrength)
    }
  }, [cubesRef, isThrowingRef, setIsThrowing, worldRef, onShadowThrowNeeded, updatePlayback])

  const startDirectThrowImmediate = useCallback((throwStrength = DEFAULT_THROW_STRENGTH) => {
    console.log("DIRECT THROW (immediate, after pre-animation) initiated, strength:", throwStrength)
    
    if (worldRef.current) worldRef.current.gravity.set(0, -50, 0)
    
    const baseThrowVelocity = new CANNON.Vec3(
      0, 
      DEFAULT_THROW_FORCE_Y * throwStrength, 
      DEFAULT_THROW_FORCE_Z * throwStrength
    )
    
    cubesRef.current.forEach((cube, index) => {
      cube.body.type = CANNON.Body.DYNAMIC
      cube.body.wakeUp()
      
      // Add random initial rotation to each die before throwing
      const randomInitialRotation = new CANNON.Quaternion()
      randomInitialRotation.setFromAxisAngle(
        new CANNON.Vec3(
          Math.random() - 0.5,
          Math.random() - 0.5, 
          Math.random() - 0.5
        ).unit(),
        Math.random() * Math.PI * 2
      )
      cube.body.quaternion = cube.body.quaternion.mult(randomInitialRotation)
      
      const variationScale = 0.3 * throwStrength
      const vx = baseThrowVelocity.x + (Math.random() - 0.5) * variationScale * 2
      const vy = baseThrowVelocity.y + (Math.random() - 0.5) * variationScale
      const vz = baseThrowVelocity.z + (Math.random() - 0.5) * variationScale * 3
      
      cube.body.velocity.set(vx, vy, vz)
      
      // Enhanced random angular velocity with more variation per die
      const baseAngularStrength = (4 + Math.random() * 4) * throwStrength
      const angularX = (Math.random() - 0.5) * baseAngularStrength * (0.5 + Math.random() * 1.5)
      const angularY = (Math.random() - 0.5) * baseAngularStrength * (0.5 + Math.random() * 1.5)
      const angularZ = (Math.random() - 0.5) * baseAngularStrength * (0.5 + Math.random() * 1.5)
      
      const biasX = Math.sin(index * 1.2) * 2 * throwStrength
      const biasY = Math.cos(index * 0.8) * 2 * throwStrength
      const biasZ = Math.sin(index * 1.5) * 2 * throwStrength
      
      cube.body.angularVelocity.set(
        angularX + biasX,
        angularY + biasY,
        angularZ + biasZ
      )
      
      if (Math.random() < 0.3) {
        const spinBoost = 3 + Math.random() * 4
        const spinAxis = Math.floor(Math.random() * 3)
        if (spinAxis === 0) cube.body.angularVelocity.x += (Math.random() - 0.5) * spinBoost
        else if (spinAxis === 1) cube.body.angularVelocity.y += (Math.random() - 0.5) * spinBoost
        else cube.body.angularVelocity.z += (Math.random() - 0.5) * spinBoost
      }
      
      cube.body.linearDamping = 0.05
      cube.body.angularDamping = 0.05
    })
    
    setHasMoved(false)
  }, [cubesRef, worldRef, setHasMoved])

  const applyPulsatingAnimation = useCallback(() => {
    if (!floatingModeRef.current || isThrowingRef.current || !floatingAnimState.current.isActive) {
      stopFloatingAnimation() 
      return
    }
    
    floatingAnimState.current.timeAccumulator += 0.016 
    const totalTime = floatingAnimState.current.timeAccumulator
    
    const pulsation = Math.sin(totalTime * FLOAT_FREQUENCY) * FLOAT_AMPLITUDE 
    
    cubesRef.current.forEach((cube, index) => {
      if (!cube.body) return
      
      let basePos: CANNON.Vec3 = (index < floatingAnimState.current.basePositions.length)
                               ? floatingAnimState.current.basePositions[index]
                               : new CANNON.Vec3(cube.body.position.x, FLOAT_BASE_HEIGHT, cube.body.position.z); 
      
      const targetY = FLOAT_BASE_HEIGHT + pulsation
      const yDiff = targetY - cube.body.position.y
      const xDiff = basePos.x - cube.body.position.x 
      const zDiff = basePos.z - cube.body.position.z
      
      const yForce = yDiff * 12 
      const xForce = xDiff * 4  
      const zForce = zDiff * 4  
      
      cube.body.applyForce(new CANNON.Vec3(xForce, yForce, zForce), cube.body.position)
      
      const rotX = Math.sin(totalTime * 1.1 + index * 0.5) * FLOAT_ROTATION_SPEED 
      const rotY = Math.cos(totalTime * 0.7 + index * 0.5) * FLOAT_ROTATION_SPEED
      const rotZ = Math.sin(totalTime * 0.9 + index * 0.5) * FLOAT_ROTATION_SPEED
      
      cube.body.angularVelocity.set(rotX, rotY, rotZ)
      cube.body.linearDamping = FLOATING_LINEAR_DAMPING
      cube.body.angularDamping = FLOATING_ANGULAR_DAMPING
      cube.body.wakeUp()
    })
    
    pulsationAnimationId.current = requestAnimationFrame(applyPulsatingAnimation)
  }, [cubesRef, stopFloatingAnimation, isThrowingRef])

  const startFloatingAnimation = useCallback(() => {
    if (floatingAnimState.current.isActive || !floatingModeRef.current) return
    
    console.log("Starting floating animation (Main Game - useAccelerometerDice)");
    floatingAnimState.current.timeAccumulator = 0
    storeBasePositions() 
    floatingAnimState.current.isActive = true
    
    if (pulsationAnimationId.current !== null) cancelAnimationFrame(pulsationAnimationId.current);
    pulsationAnimationId.current = requestAnimationFrame(applyPulsatingAnimation);
    
    if (worldRef.current) {
      worldRef.current.gravity.set(0, -1, 0); 
    }
  }, [applyPulsatingAnimation, storeBasePositions, worldRef])

  useEffect(() => {
    if (inDeadzone && deadzoneTimer !== null) {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); 
      animationFrameId.current = requestAnimationFrame(updateDeadzoneState);
    } else {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    }
    return () => { 
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [inDeadzone, deadzoneTimer, updateDeadzoneState]);

  useEffect(() => {
    return () => { 
      if (pulsationAnimationId.current !== null) cancelAnimationFrame(pulsationAnimationId.current);
      if (animationFrameId.current !== null) cancelAnimationFrame(animationFrameId.current);
      if (preThrowAnimationRef.current.animationFrameId !== null) cancelAnimationFrame(preThrowAnimationRef.current.animationFrameId);
    };
  }, []);

  const getDiceValue = useCallback((cube: Cube): number => {
    if (!cube || !cube.body) return 1; 
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
      const worldNormal = normal.clone().applyQuaternion(rotation) 
      const alignment = worldNormal.dot(worldUp) 
      if (alignment > maxAlignment) {
        maxAlignment = alignment
        topFaceIndex = index
      }
    })
    return faceValues[topFaceIndex]
  }, [])

  const processAcceleration = useCallback((motion: DeviceMotionData) => {
    if (!motion.accelerationIncludingGravity.x || !motion.accelerationIncludingGravity.y || !motion.accelerationIncludingGravity.z) {
      return filteredAcceleration.current; 
    }
    const alpha = 0.8; 
    filteredAcceleration.current = {
      x: filteredAcceleration.current.x * alpha + motion.accelerationIncludingGravity.x * (1 - alpha),
      y: filteredAcceleration.current.y * alpha + motion.accelerationIncludingGravity.y * (1 - alpha),
      z: filteredAcceleration.current.z * alpha + motion.accelerationIncludingGravity.z * (1 - alpha)
    };
    return filteredAcceleration.current;
  }, [])

  const startShadowFirstThrow = useCallback(async (throwStrength = DEFAULT_THROW_STRENGTH) => {
    console.log("STARTING SHADOW-FIRST THROW with pre-animation, strength:", throwStrength)
    if (isThrowingRef.current || preThrowAnimationRef.current.isAnimating) return
    
    // Check if dice are already near starting positions
    const needsPreAnimation = cubesRef.current.some((cube, index) => {
      if (index >= initialPositionsRef.current.length) return false
      const targetPos = initialPositionsRef.current[index]
      const currentPos = cube.body.position
      const distance = Math.sqrt(
        Math.pow(currentPos.x - targetPos.x, 2) + 
        Math.pow(currentPos.z - targetPos.z, 2)
      )
      return distance > 1.0 // If more than 1 unit away, needs animation
    })

    if (needsPreAnimation) {
      console.log("Dice are away from center, starting pre-throw animation")
      startPreThrowAnimation(throwStrength)
    } else {
      console.log("Dice are already centered, starting throw immediately")
      executeActualThrow(throwStrength)
    }
  }, [cubesRef, initialPositionsRef, isThrowingRef, startPreThrowAnimation, executeActualThrow])

  const checkForGroundHit = useCallback(() => {
    if (!isThrowingRef.current || diceHitGroundRef.current || cubesRef.current.length === 0 || playbackStateRef.current.isPlayingBack) return;
    
    const groundHit = cubesRef.current.some(cube => cube.body.position.y < 1.0); 
    
    if (groundHit && !diceHitGroundRef.current) {
      console.log("DICE HIT GROUND (Direct Throw) - Applying ground damping");
      diceHitGroundRef.current = true;
      groundHitTimeRef.current = Date.now();
      
      cubesRef.current.forEach(cube => {
        cube.body.linearDamping = GROUND_LINEAR_DAMPING;
        cube.body.angularDamping = GROUND_ANGULAR_DAMPING;
        if (cube.body.velocity.z < 0) { 
          cube.body.velocity.z *= (1 - GROUND_Z_DAMPING_MULTIPLIER * 0.05); 
        }
      });
    }
    
    if (diceHitGroundRef.current) {
      cubesRef.current.forEach(cube => {
        if (cube.body.position.z < Z_MIN_BOUNDARY) {
          const zForceMagnitude = (Z_MIN_BOUNDARY - cube.body.position.z) * Z_RESTORE_FORCE;
          cube.body.applyForce(new CANNON.Vec3(0, 0, zForceMagnitude), cube.body.position);
          cube.body.velocity.z *= 0.5; 
        }
      });
    }
  }, [cubesRef, isThrowingRef]); 

  const checkIfDiceSettled = useCallback(() => {
    if (!isThrowingRef.current || cubesRef.current.length === 0 || playbackStateRef.current.isPlayingBack) return;
    
    checkForGroundHit(); 
    
    if (!diceHitGroundRef.current || !groundHitTimeRef.current || (Date.now() - groundHitTimeRef.current < MIN_GROUND_SETTLE_TIME)) {
      return;
    }

    const allSettled = cubesRef.current.every(cube => {
      const linearSpeed = cube.body.velocity.length();
      const angularSpeed = cube.body.angularVelocity.length();
      return linearSpeed < SETTLE_THRESHOLD && angularSpeed < SETTLE_THRESHOLD && cube.body.sleepState === CANNON.Body.SLEEPING;
    });

    if (allSettled) {
      console.log("MAIN DICE SETTLED (Direct Throw)");
      removeAllConstraints(); 

      cubesRef.current.forEach(cube => { 
        cube.body.type = CANNON.Body.STATIC;
        cube.body.velocity.set(0,0,0);
        cube.body.angularVelocity.set(0,0,0);
        cube.mesh.position.copy(cube.body.position as unknown as THREE.Vector3);
        cube.mesh.quaternion.copy(cube.body.quaternion as unknown as THREE.Quaternion);
      });
      
      if (worldRef.current) worldRef.current.gravity.set(0, 0, 0); 
      
      const results = cubesRef.current.map(getDiceValue);
      
      setTimeout(() => { 
        setRollResults(results);
        setIsThrowing(false);
        isThrowingRef.current = false;
        floatingModeRef.current = false; 
        stopFloatingAnimation();
      }, 50);
    }
  }, [cubesRef, getDiceValue, isThrowingRef, setIsThrowing, setRollResults, checkForGroundHit, removeAllConstraints, stopFloatingAnimation, worldRef]);
  
  const applyCohesiveMovement = useCallback(() => {
    if (cubesRef.current.length === 0) return;
    cubesRef.current.forEach(cube => {
      if (floatingModeRef.current) {
        cube.body.linearDamping = FLOATING_LINEAR_DAMPING;
        cube.body.angularDamping = FLOATING_ANGULAR_DAMPING;
      } else { 
        cube.body.linearDamping = LINEAR_DAMPING;
        cube.body.angularDamping = ANGULAR_DAMPING;
      }
      cube.body.wakeUp();
    });
  }, [cubesRef]);

  const clampDiceVelocities = useCallback(() => {
    cubesRef.current.forEach((cube) => {
      const linearVel = cube.body.velocity;
      if (linearVel.length() > MAX_VELOCITY) linearVel.scale(MAX_VELOCITY / linearVel.length(), linearVel);
      const angularVel = cube.body.angularVelocity;
      if (angularVel.length() > MAX_ANGULAR_VELOCITY) angularVel.scale(MAX_ANGULAR_VELOCITY / angularVel.length(), angularVel);
    });
  }, [cubesRef]);

  const calibrate = useCallback((motion: DeviceMotionData) => {
    if (motion.accelerationIncludingGravity.x === null || motion.accelerationIncludingGravity.y === null || motion.accelerationIncludingGravity.z === null) return;
    const processedAccel = { x: motion.accelerationIncludingGravity.x, y: motion.accelerationIncludingGravity.y, z: motion.accelerationIncludingGravity.z };
    neutralAccelRef.current = processedAccel;
    filteredAcceleration.current = { ...processedAccel }; 
    console.log("Calibrated neutral acceleration (Main Game) to:", processedAccel);
    setHasMoved(false); 
    diceHitGroundRef.current = false; 
    groundHitTimeRef.current = null;
  }, []);

  const initFloating = useCallback(() => {
    if (!worldRef.current) return;
    console.log("Initializing floating state (Main Game - useAccelerometerDice)");
    floatingModeRef.current = true; 

    worldRef.current.gravity.set(0, -1, 0); 

    cubesRef.current.forEach((cube) => { 
      if (cube.body) {
        cube.body.type = CANNON.Body.DYNAMIC;
        cube.body.velocity.set(0,0,0);
        cube.body.angularVelocity.set(0,0,0);
        cube.body.linearDamping = FLOATING_LINEAR_DAMPING;
        cube.body.angularDamping = FLOATING_ANGULAR_DAMPING;
        cube.body.wakeUp();
      }
    });
    
    createDiceConstraints(); 
    startFloatingAnimation(); 
  }, [cubesRef, worldRef, createDiceConstraints, startFloatingAnimation]);

  const enableMovement = useCallback(() => {
    console.log("Accelerometer movement EXPLICITLY enabled (Main Game)");
    isMovingEnabled.current = true;

    if (worldRef.current && floatingModeRef.current) { 
      worldRef.current.gravity.set(0, -1, 0);
    }

    cubesRef.current.forEach((cube) => { 
      cube.body.type = CANNON.Body.DYNAMIC;
      cube.body.wakeUp();
    });
    
    createDiceConstraints(); 
    setHasMoved(false); 
    diceHitGroundRef.current = false; 
    groundHitTimeRef.current = null;

    if (floatingModeRef.current && !floatingAnimState.current.isActive) {
        startFloatingAnimation();
    }
  }, [cubesRef, worldRef, createDiceConstraints, startFloatingAnimation]);

  const disableMovement = useCallback(() => {
    console.log("Accelerometer movement disabled (Main Game)");
    isMovingEnabled.current = false;
    
    setInDeadzone(false);
    setDeadzoneTimer(null);
    setDeadzoneProgress(0);
  }, []);

  const resetNeutralPosition = useCallback((motion: DeviceMotionData) => {
    if (motion.accelerationIncludingGravity.x === null || motion.accelerationIncludingGravity.y === null || motion.accelerationIncludingGravity.z === null) return;
    calibrate(motion); 
    console.log("Neutral position explicitly reset (Main Game).");
  }, [calibrate]);

  const startThrow = useCallback( 
    (throwStrength = DEFAULT_THROW_STRENGTH) => {
      startShadowFirstThrow(throwStrength); 
    },
    [startShadowFirstThrow]
  );

  const forceThrow = useCallback((throwStrength = DEFAULT_THROW_STRENGTH) => {
    startThrow(throwStrength);
  }, [startThrow]);

  const handleMotionUpdate = useCallback(
    (motionData: DeviceMotionData) => {
      lastMotion.current = motionData; 
      if (!motionData.accelerationIncludingGravity.x || !motionData.accelerationIncludingGravity.y || !motionData.accelerationIncludingGravity.z || !neutralAccelRef.current) {
        return; 
      }
      
      processAcceleration(motionData); 

      if (isThrowingRef.current && !playbackStateRef.current.isPlayingBack) {
        checkForGroundHit();
        checkIfDiceSettled();
      } 
      else if (preThrowAnimationRef.current.isAnimating) {
        // During pre-throw animation, ignore motion input to allow smooth animation
        return;
      }
      else if (isMovingEnabled.current && floatingModeRef.current && !isThrowingRef.current) {
        if (!worldRef.current) return;
        
        const tiltX = filteredAcceleration.current.x - neutralAccelRef.current.x;
        const tiltMagnitude = Math.abs(tiltX);
        
        if (tiltMagnitude <= DEAD_ZONE) { 
          if (hasMoved && !inDeadzone) { 
            console.log("ENTERED DEADZONE (Main Game) - Starting throw timer");
            setInDeadzone(true);
            setDeadzoneTimer(Date.now()); 
            setDeadzoneProgress(0);
          }
        } 
        else { 
          if (inDeadzone) { 
            console.log("EXITED DEADZONE (Main Game) due to movement");
            setInDeadzone(false);
            setDeadzoneTimer(null);
            setDeadzoneProgress(0);
          }
          
          if (!hasMoved) { 
            console.log("INITIAL MOVEMENT DETECTED (Main Game)!");
            setHasMoved(true);
          }

          // Calculate tilt strength and apply gravity-based movement
          if (tiltMagnitude <= TILT_THRESHOLD) {
            if (floatingModeRef.current) {
              worldRef.current.gravity.set(0, -1, 0);
            } else {
              worldRef.current.gravity.set(0, -30, 0);
            }
            return;
          }
          
          const tiltStrength = Math.min(1, (Math.abs(tiltX) - DEAD_ZONE) / (1.0 - DEAD_ZONE));
          const scaledGravity = GRAVITY_STRENGTH * tiltStrength;
          const gravityX = tiltX * scaledGravity;
          
          if (floatingModeRef.current) {
            worldRef.current.gravity.set(gravityX, -1, 0);
          } else {
            worldRef.current.gravity.set(gravityX, -30, 0);
          }
        }
        applyCohesiveMovement(); 
        clampDiceVelocities(); 
      }
    },
    [
      processAcceleration, isThrowingRef, checkForGroundHit, checkIfDiceSettled, 
      worldRef, hasMoved, inDeadzone, 
      applyCohesiveMovement, clampDiceVelocities, cubesRef 
    ]
  );

  const getDeadzoneStatus = useCallback((): DeadzoneStatus => {
    return {
      inDeadzone: inDeadzone && hasMoved, 
      progress: deadzoneProgress,
      timeMs: deadzoneTimer ? Date.now() - deadzoneTimer : 0,
      hasMoved: hasMoved,
      debug: { 
        startTime: deadzoneTimer,
        currentTime: Date.now(),
        remaining: deadzoneTimer ? Math.max(0, DEADZONE_THROW_DELAY - (Date.now() - deadzoneTimer)) : DEADZONE_THROW_DELAY
      }
    };
  }, [inDeadzone, deadzoneProgress, deadzoneTimer, hasMoved]);

  const getAccelerometerDebugInfo = useCallback((): AccelerometerDebugInfo => {
    const raw = lastMotion.current?.accelerationIncludingGravity;
    const tiltX = neutralAccelRef.current ? filteredAcceleration.current.x - neutralAccelRef.current.x : 0;
    const tiltY = neutralAccelRef.current ? filteredAcceleration.current.y - neutralAccelRef.current.y : 0;
    const mag = Math.sqrt(filteredAcceleration.current.x**2 + filteredAcceleration.current.y**2 + filteredAcceleration.current.z**2);
    return {
      rawAcceleration: raw && raw.x !== null && raw.y !== null && raw.z !== null 
        ? { x: raw.x.toFixed(2), y: raw.y.toFixed(2), z: raw.z.toFixed(2) } 
        : null,
      filteredAcceleration: { 
        x: filteredAcceleration.current.x.toFixed(2), 
        y: filteredAcceleration.current.y.toFixed(2), 
        z: filteredAcceleration.current.z.toFixed(2) 
      },
      acceleration: parseFloat(mag.toFixed(2)),
      tiltX: parseFloat(tiltX.toFixed(2)), 
      tiltY: parseFloat(tiltY.toFixed(2)),
    };
  }, []); 

  const isMovementEnabledHook = useCallback(() => isMovingEnabled.current, []);
  const isFloatingModeHook = useCallback(() => floatingModeRef.current, []);

  return {
    handleMotionUpdate, startThrow, forceThrow, enableMovement, disableMovement,
    resetNeutralPosition, getDeadzoneStatus, getAccelerometerDebugInfo, calibrate,
    isMovementEnabled: isMovementEnabledHook, 
    isFloatingMode: isFloatingModeHook,     
    initFloating 
  };
};