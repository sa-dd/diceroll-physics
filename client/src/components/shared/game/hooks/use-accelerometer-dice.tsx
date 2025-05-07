"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as CANNON from "cannon-es"
import * as THREE from "three"
import type { Cube } from "../game-board"
import type { DeviceMotionData } from "./use-device-motion"

// Constants for accelerometer-based movement
const GRAVITY_STRENGTH = 600
const IMPULSE_MULTIPLIER = 100.0
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
const ANGULAR_DAMPING = 0.3
const FLOATING_LINEAR_DAMPING = 0.1
const FLOATING_ANGULAR_DAMPING = 0.1
const VELOCITY_THRESHOLD = 0.8
const ANGULAR_VELOCITY_THRESHOLD = 0.1
const STABLE_TIMEOUT = 100
const MAX_VELOCITY = 80
const MAX_ANGULAR_VELOCITY = 10
const DEADZONE_THROW_DELAY = 50

// Recording constants
const RECORD_INTERVAL = 0.016 // ~60 FPS
const SETTLE_THRESHOLD = 0.8

// Face orientation mapping (MUST match Three.js material order)
const FACE_NORMALS = new Map<number, THREE.Vector3>([
  [1, new THREE.Vector3(0, 1, 0)],   // Top
  [6, new THREE.Vector3(0, -1, 0)],  // Bottom
  [2, new THREE.Vector3(1, 0, 0)],   // Right
  [5, new THREE.Vector3(-1, 0, 0)],  // Left
  [3, new THREE.Vector3(0, 0, 1)],   // Front
  [4, new THREE.Vector3(0, 0, -1)]   // Back
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

interface DiceRecording {
  frames: DiceFrame[]
  finalTargetRotations?: CANNON.Quaternion[]  // Triple 6 rotations
}

interface DiceReplayState {
  isRecording: boolean
  isReplaying: boolean
  recordedFrames: DiceFrame[]
  currentFrame: number
  targetValues: number[]
  replayAnimationFrame: number | null
  finalTargetRotations: CANNON.Quaternion[] | null
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

  // Recording state
  const replayState = useRef<DiceReplayState>({
    isRecording: false,
    isReplaying: false,
    recordedFrames: [],
    currentFrame: 0,
    targetValues: Array(cubesRef.current.length).fill(6),
    replayAnimationFrame: null,
    finalTargetRotations: null
  })

  const updateDeadzoneState = useCallback(() => {
    if (!inDeadzone || deadzoneTimer === null) return
    
    const now = Date.now()
    const elapsed = now - deadzoneTimer
    const newProgress = (elapsed / DEADZONE_THROW_DELAY) * 100
    
    setDeadzoneProgress(Math.min(100, newProgress))
    
    if (elapsed >= DEADZONE_THROW_DELAY && lastMotion.current) {
      console.log("DEADZONE TIMER COMPLETE - THROWING")
      
      setInDeadzone(false)
      setDeadzoneTimer(null)
      setDeadzoneProgress(0)
      
      floatingModeRef.current = false
      stopFloatingAnimation()
      diceHitGroundRef.current = false
      groundHitTimeRef.current = null
      
      startThrow(lastMotion.current)
    }
    
    animationFrameId.current = requestAnimationFrame(updateDeadzoneState)
  }, [inDeadzone, deadzoneTimer])

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

  // Calculate quaternion rotation to orient die to show 6
  const getRotationForSix = useCallback((cube: Cube): CANNON.Quaternion => {
    // The 6 face normal is (0, -1, 0) and we want it to point up (0, 1, 0)
    // This requires a 180-degree rotation around the x-axis
    const targetUp = new THREE.Vector3(0, 1, 0)
    const sixFaceNormal = new THREE.Vector3(0, -1, 0)
    
    // Create a quaternion that rotates sixFaceNormal to point up
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(sixFaceNormal, targetUp)
    
    // Convert to CANNON.Quaternion
    return new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  }, [])

  // Recording functions
  const startRecording = useCallback(() => {
    replayState.current = {
      ...replayState.current,
      isRecording: true,
      recordedFrames: [],
      currentFrame: 0,
      finalTargetRotations: null
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
    
    // Calculate and store the rotations needed for triple 6
    const targetRotations = cubesRef.current.map(cube => getRotationForSix(cube))
    replayState.current.finalTargetRotations = targetRotations
    
    console.log("Stored triple 6 target rotations")
  }, [cubesRef, getRotationForSix])

  const playbackFrame = useCallback(() => {
    if (!replayState.current.isReplaying || replayState.current.recordedFrames.length === 0) {
      return
    }

    const frame = replayState.current.recordedFrames[replayState.current.currentFrame]
    const isLastFrame = replayState.current.currentFrame === replayState.current.recordedFrames.length - 1
    
    if (frame) {
      cubesRef.current.forEach((cube, index) => {
        if (frame.positions[index] && frame.rotations[index]) {
          // Set positions and rotations
          cube.body.position.copy(frame.positions[index])
          
          // Use target rotations for the last frame (triple 6)
          if (isLastFrame && replayState.current.finalTargetRotations?.[index]) {
            cube.body.quaternion.copy(replayState.current.finalTargetRotations[index])
          } else {
            cube.body.quaternion.copy(frame.rotations[index])
          }
          
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
        stopReplay()
      } else {
        // Schedule next frame
        replayState.current.replayAnimationFrame = requestAnimationFrame(playbackFrame)
      }
    }
  }, [cubesRef])

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

    // Start replay
    replayState.current.isReplaying = true
    replayState.current.currentFrame = 0
    
    // Begin playback
    playbackFrame()
  }, [cubesRef, playbackFrame])

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

  const checkForGroundHit = useCallback(() => {
    if (!isThrowingRef.current || diceHitGroundRef.current || cubesRef.current.length === 0) {
      return
    }
    
    const groundHit = cubesRef.current.some(cube => {
      return cube.body.position.y < 1.0
    })
    
    if (groundHit && !diceHitGroundRef.current) {
      console.log("DICE HIT GROUND")
      diceHitGroundRef.current = true
      groundHitTimeRef.current = Date.now()
      
      if (worldRef.current) {
        worldRef.current.gravity.set(0, -30, 0)
      }
    }
  }, [cubesRef, isThrowingRef, worldRef])

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
      // FREEZE PHYSICS STATE
      cubesRef.current.forEach(cube => {
        cube.body.sleep()
        cube.body.velocity.set(0, 0, 0)
        cube.body.angularVelocity.set(0, 0, 0)
      })
      
      // Stop recording
      stopRecording()
      
      const results = cubesRef.current.map(getDiceValue)
      
      setTimeout(() => {
        setRollResults(results)
        setIsThrowing(false)
        isThrowingRef.current = false
        isReleased.current = false
      }, 50)
    }
  }, [cubesRef, getDiceValue, isThrowingRef, setIsThrowing, setRollResults, checkForGroundHit, stopRecording])

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

  const startThrow = useCallback(
    (motion: DeviceMotionData, throwStrength = 1.0) => {
      console.log("THROW STARTED")
      
      if (isThrowingRef.current) {
        console.log("Already throwing, skipping")
        return
      }
      
      setInDeadzone(false)
      setDeadzoneTimer(null)
      setDeadzoneProgress(0)
      diceHitGroundRef.current = false
      groundHitTimeRef.current = null
      setRollResults([])
      setIsThrowing(true)
      isThrowingRef.current = true
      isReleased.current = false
      floatingModeRef.current = false
      stopFloatingAnimation()
      removeAllConstraints()
      
      const tiltX = neutralAccelRef.current && motion.accelerationIncludingGravity.x !== null
        ? motion.accelerationIncludingGravity.x - neutralAccelRef.current.x
        : 5
      
      const normalizedTiltX = Math.max(-1, Math.min(1, tiltX / 5.0))
      
      throwVelocity.current.set(
        normalizedTiltX * 5.5 * throwStrength+4.5,
        14 * throwStrength,
        -38.0 * throwStrength
      )
      
      if (worldRef.current) {
        worldRef.current.gravity.set(0, -30, 0)
      }
      
      cubesRef.current.forEach((cube) => {
        cube.body.wakeUp()
        cube.body.type = CANNON.Body.DYNAMIC
        
        const variationScale = 0.4
        cube.body.velocity.set(
          throwVelocity.current.x + (Math.random() - 0.5) * variationScale * throwStrength * 2,
          throwVelocity.current.y + (Math.random() - 0.5) * variationScale * throwStrength * 1.5,
          throwVelocity.current.z + (Math.random() - 0.5) * variationScale * throwStrength * 2
        )
        
        const baseAngularVel = 10 * throwStrength
        cube.body.angularVelocity.set(
          (Math.random() - 0.5) * baseAngularVel,
          (Math.random() - 0.5) * baseAngularVel,
          (Math.random() - 0.5) * baseAngularVel
        )
        
        cube.body.linearDamping = 0.1
        cube.body.angularDamping = 0.1
      })

      // Start recording the throw
      startRecording()
      
      console.log("Throw successfully initiated - constraints removed")
      setHasMoved(false)
    },
    [cubesRef, isThrowingRef, removeAllConstraints, setIsThrowing, setRollResults, worldRef, stopFloatingAnimation, startRecording]
  )

  const forceThrow = useCallback((throwStrength = 1.5) => {
    if (!lastMotion.current) {
      console.log("No motion data available for throw")
      return
    }
    
    startThrow(lastMotion.current, throwStrength)
  }, [lastMotion, startThrow])

  const handleMotionUpdate = useCallback(
    (motion: DeviceMotionData) => {
      lastMotion.current = motion
      
      if (!motion.accelerationIncludingGravity.x || 
          !motion.accelerationIncludingGravity.y || 
          !motion.accelerationIncludingGravity.z || 
          !neutralAccelRef.current) {
        return
      }
      
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
    replayState.current.targetValues = values
  }, [])

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
    hasRecording,
    isReplaying
  }
}