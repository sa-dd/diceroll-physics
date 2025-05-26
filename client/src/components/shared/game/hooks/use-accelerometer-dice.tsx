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
const GROUND_LINEAR_DAMPING = 0.2
const GROUND_ANGULAR_DAMPING = 0.35
const GROUND_Z_DAMPING_MULTIPLIER = 0.8
const VELOCITY_THRESHOLD = 0.8
const ANGULAR_VELOCITY_THRESHOLD = 0.1
const STABLE_TIMEOUT = 100
const MAX_VELOCITY = 100
const MAX_ANGULAR_VELOCITY = 5
const DEADZONE_THROW_DELAY = 50

// Boundary parameters to keep dice in camera view
const Z_MIN_BOUNDARY = -15
const Z_RESTORE_FORCE = 15

// Settle threshold for detecting when dice have stopped moving
const SETTLE_THRESHOLD = 0.10

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
  acceleration: number
  tiltX: number
  tiltY: number
}

interface FloatingAnimState {
  timeAccumulator: number
  basePositions: CANNON.Vec3[]
  isActive: boolean
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

export const useAccelerometerDice = (
  cubesRef: React.MutableRefObject<Cube[]>,
  isThrowingRef: React.MutableRefObject<boolean>,
  setRollResults: React.Dispatch<React.SetStateAction<number[]>>,
  setIsThrowing: React.Dispatch<React.SetStateAction<boolean>>,
  resetDicePositions: () => void,
  worldRef: React.MutableRefObject<CANNON.World | null>,
  removeAllConstraints: () => void,
  createDiceConstraints: () => void,
  onShadowThrowNeeded: (throwStrength: number) => Promise<ShadowRecording>
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

  // Playback state for recorded shadow throws
  const playbackStateRef = useRef<{
    isPlayingBack: boolean
    recording: ShadowRecording | null
    startTime: number
    currentFrameIndex: number
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
      
      // Start shadow throw and playback instead of direct physics
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

  // Interpolate between two recorded frames for smooth playback
  const interpolateFrame = useCallback((frame1: PhysicsFrame, frame2: PhysicsFrame, t: number): PhysicsFrame => {
    const interpolatedStates = frame1.diceStates.map((state1, index) => {
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

  // Apply a recorded frame to the actual dice
  const applyRecordedFrame = useCallback((frame: PhysicsFrame) => {
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

  // Update playback of recorded shadow throw
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
          console.log("PLAYBACK COMPLETE - FINALIZING RESULTS");
          
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
  }, [cubesRef, stopFloatingAnimation, isThrowingRef])

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
    }
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

  // Execute shadow throw and playback the recording
  const executeThrow = useCallback(async (throwStrength: number) => {
    console.log("EXECUTING SHADOW THROW with strength:", throwStrength)
    
    if (isThrowingRef.current) return
    
    isThrowingRef.current = true
    setIsThrowing(true)
    diceHitGroundRef.current = false
    groundHitTimeRef.current = null
    floatingModeRef.current = false
    stopFloatingAnimation()
    removeAllConstraints()

    try {
      console.log("Requesting shadow roll recording...")
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
      console.error("Shadow roll failed:", error)
      // Fallback to direct physics if shadow recording fails
      startDirectThrow(throwStrength)
    }
  }, [cubesRef, isThrowingRef, setIsThrowing, worldRef, onShadowThrowNeeded, updatePlayback, stopFloatingAnimation, removeAllConstraints])

  // Fallback direct throw for when shadow recording fails
  const startDirectThrow = useCallback((throwStrength = DEFAULT_THROW_STRENGTH) => {
    console.log("DIRECT THROW (fallback) initiated, strength:", throwStrength)
    
    if (worldRef.current) worldRef.current.gravity.set(0, -50, 0)
    
    const baseThrowVelocity = new CANNON.Vec3(
      0, 
      DEFAULT_THROW_FORCE_Y * throwStrength, 
      DEFAULT_THROW_FORCE_Z * throwStrength
    )
    
    cubesRef.current.forEach((cube) => {
      cube.body.type = CANNON.Body.DYNAMIC
      cube.body.wakeUp()
      
      const variationScale = 0.3 * throwStrength
      const vx = baseThrowVelocity.x + (Math.random() - 0.5) * variationScale * 2
      const vy = baseThrowVelocity.y + (Math.random() - 0.5) * variationScale
      const vz = baseThrowVelocity.z + (Math.random() - 0.5) * variationScale * 3
      
      cube.body.velocity.set(vx, vy, vz)
      
      const baseAngularStrength = (4 + Math.random() * 4) * throwStrength
      cube.body.angularVelocity.set(
        (Math.random() - 0.5) * baseAngularStrength,
        (Math.random() - 0.5) * baseAngularStrength,
        (Math.random() - 0.5) * baseAngularStrength
      )
      
      cube.body.linearDamping = 0.05
      cube.body.angularDamping = 0.05
    })
    
    setHasMoved(false)
  }, [cubesRef, worldRef, setHasMoved])

  // Function to start throwing dice using shadow recording
  const startThrow = useCallback(
    (throwStrength = DEFAULT_THROW_STRENGTH) => {
      executeThrow(throwStrength)
    },
    [executeThrow]
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

      if (isThrowingRef.current) {
        // During playback, don't interfere with dice physics
        if (playbackStateRef.current.isPlayingBack) {
          return
        }
        
        // Handle direct physics throws (fallback only)
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
      } 
      else if (!isMovingEnabled.current) {
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
        }
      }
    },
    [
      processAcceleration,
      cubesRef,
      hasMoved,
      inDeadzone,
      isThrowingRef,
      worldRef
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
    initFloating
  }
}