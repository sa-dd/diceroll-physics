"use client"

import type React from "react"
import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import * as THREE from "three"
import * as CANNON from "cannon-es"
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

// Debug mode toggle - set to true to show accelerometer values
const DEBUG_MODE = true;
const DEADZONE_THROW_DELAY = 5;

export const DiceGame: React.FC<Props> = ({ className }) => {
  const mountRef = useRef<HTMLDivElement>(null)
  const cubesRef = useRef<Cube[]>([])
  const initialPositionsRef = useRef<CANNON.Vec3[]>([])
  const constraintsRef = useRef<ConstraintData[]>([])

  const [rollResults, setRollResults] = useState<number[]>([])
  const [isThrowing, setIsThrowing] = useState<boolean>(false)
  const isThrowingRef = useRef<boolean>(false)
  const [isVisible, setVisible] = useState(false)
  const [accessGranted, setAccessGranted] = useState(false)
  const worldRef = useRef<CANNON.World | null>(null)
  const rollScreenAnimationTimeRef = useRef<number>(400)
  const neutralPositionSetRef = useRef<boolean>(false)
  const floatingInitializedRef = useRef<boolean>(false)
  
  // State for tracking if movement is unlocked by shake
  // IMPORTANT FIX: Set this to false by default to enforce shake detection
  const [movementUnlocked, setMovementUnlocked] = useState(false)
  
  // State for floating mode tracking
  const [isFloating, setIsFloating] = useState(true) // Default to true for initial state
  
  // NEW: State for dice rigging
  const [targetValues, setTargetValues] = useState<number[]>([6, 6, 6]) // Default to triple sixes
  const [riggingEnabled, setRiggingEnabled] = useState<boolean>(false)   // Toggle for rigging
  const [cheatMenuOpen, setCheatMenuOpen] = useState<boolean>(false)     // Cheat menu visibility
  
  // State for accelerometer values - only care about X for movement
  const [accelerometerValues, setAccelerometerValues] = useState<{
    x: number | null;
    y: number | null;
    z: number | null;
    tiltX: number;
    tiltY: number;  // kept for debugging but not used for movement
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
    if (!worldRef.current || cubesRef.current.length < 2) return;
    
    // Clear existing constraints
    constraintsRef.current.forEach(data => {
      worldRef.current?.removeConstraint(data.constraint);
    });
    constraintsRef.current = [];
    
    // Create constraints between all pairs of dice
    for (let i = 0; i < cubesRef.current.length; i++) {
      for (let j = i + 1; j < cubesRef.current.length; j++) {
        const bodyA = cubesRef.current[i].body;
        const bodyB = cubesRef.current[j].body;
        
        // Calculate initial distance between the dice
        const initialDistance = bodyA.position.distanceTo(bodyB.position);
        
        // Create a constraint with some flexibility
        const constraint = new CANNON.DistanceConstraint(
          bodyA, 
          bodyB,
          initialDistance,
          // Spring force - allows some elasticity
          10.0
        );
        
        // Store constraint data
        constraintsRef.current.push({ 
          constraint, 
          bodyA, 
          bodyB 
        });
        
        // Add constraint to world
        worldRef.current.addConstraint(constraint);
      }
    }
  }, [worldRef, cubesRef]);

  // Function to remove all constraints between dice
  const removeAllConstraints = useCallback(() => {
    if (!worldRef.current) return;
    
    // Remove all constraints from the world
    constraintsRef.current.forEach(data => {
      worldRef.current?.removeConstraint(data.constraint);
    });
    
    // Clear the constraints array
    constraintsRef.current = [];
  }, [worldRef]);

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
    startReplay,
    hasRecording,
    isReplaying,
    // NEW: Add rigging functions
    setTargetValues: setDiceTargetValues,
    rigRecording
  } = useAccelerometerDice(
    cubesRef, 
    isThrowingRef, 
    setRollResults, 
    setIsThrowing,
    resetDicePositions,
    worldRef,
    removeAllConstraints,
    createDiceConstraints
  );

  // Get device motion data using our new hook
  const { 
    motion, 
    isShaking, 
    accessGranted: motionAccessGranted, 
    requestAccess: requestMotionAccess, 
    revokeAccess: revokeMotionAccess 
  } = useDeviceMotion({
    shakeThreshold: 2.5  // Slightly higher threshold for more intentional shakes
  });

  useEffect(() => {
    isThrowingRef.current = isThrowing
  }, [isThrowing])

  // NEW: Update dice target values when they change in UI
  useEffect(() => {
    if (riggingEnabled) {
      setDiceTargetValues(targetValues);
    }
  }, [targetValues, riggingEnabled, setDiceTargetValues]);

  // NEW: Initialize floating animation at startup
  useEffect(() => {
    // Skip if already initialized or not ready
    if (floatingInitializedRef.current || 
        !worldRef.current || 
        cubesRef.current.length === 0 || 
        !initialPositionsRef.current.length) {
      return;
    }
    
    // Small delay to ensure physics world is fully set up
    const initTimer = setTimeout(() => {
      // Initialize floating animation
      initFloating();
      
      // Mark as initialized
      floatingInitializedRef.current = true;
      setIsFloating(true);
      
      console.log("Initialized floating animation on startup");
    }, 500);
    
    return () => clearTimeout(initTimer);
  }, [worldRef, cubesRef, initialPositionsRef, initFloating]);

  // Modified effect: Set neutral position and handle initial setup
  useEffect(() => {
    if (motionAccessGranted && motion && !neutralPositionSetRef.current && !isThrowing && !isVisible) {
      // Use the calibrate function for proper accelerometer setup
      calibrate(motion);
      neutralPositionSetRef.current = true;
      
      // Create constraints if they don't exist yet
      if (constraintsRef.current.length === 0) {
        createDiceConstraints();
      }
      
      // Enable floating by default
      if (!floatingInitializedRef.current) {
        initFloating();
        floatingInitializedRef.current = true;
        setIsFloating(true);
      }
    }
  }, [motionAccessGranted, motion, calibrate, isThrowing, isVisible, createDiceConstraints, initFloating]);

  // Effect to handle shake detection
  useEffect(() => {
    // Skip if already unlocked or if throw is in progress
    if (movementUnlocked || isThrowing || isVisible) {
      return;
    }
    
    // Check if device is shaking from the hook's state
    if (motionAccessGranted && isShaking) {
      console.log("Shake detected! Unlocking movement with floating mode.");
      setMovementUnlocked(true);
      setIsFloating(true);
      
      // Call enableMovement explicitly to ensure dice can move and float
      setTimeout(() => {
        enableMovement();
        
        // If worldRef is accessible directly, also set low gravity here as backup
        if (worldRef.current) {
          worldRef.current.gravity.set(0, -1, 0);  // Even lower gravity for floating
        }
      }, 100);
    }
  }, [motionAccessGranted, isShaking, movementUnlocked, enableMovement, isThrowing, isVisible, worldRef]);

  // Update floating state based on dice controller state
  useEffect(() => {
    if (!isThrowing && !isVisible) {
      const floatingState = isFloatingMode();
      setIsFloating(floatingState);
    }
  }, [isThrowing, isVisible, isFloatingMode]);

  // Poll deadzone status frequently for UI updates
  useEffect(() => {
    if (!isThrowing && !isVisible) {
      const updateStatus = () => {
        const status = getDeadzoneStatus();
        setDeadzoneState(status);
        
        // Also update accelerometer debug info
        const debugInfo = getAccelerometerDebugInfo();
        setAccelDebugInfo(debugInfo);
        
        // Update accelerometer values for UI display
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
  }, [isThrowing, isVisible, getDeadzoneStatus, getAccelerometerDebugInfo, motion]);

  // Process motion updates
  useEffect(() => {
    if (motion) {
      // Pass motion data to our dice controller
      handleMotionUpdate(motion);
    }
  }, [motion, handleMotionUpdate]);

  // Standard Three.js setup and materials code...
  const materials = useMemo(() => {
    const loader = new THREE.TextureLoader()
    
    // Load all dice face textures
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
        cubeMesh.position.set(0, 7, 5)  // Start higher for floating effect
        scene.add(cubeMesh)
        
        // Store initial position for reset - position dice closer together and higher
        const initialPos = new CANNON.Vec3(-2 + i * 2, 7, 5)  // Start at Y=7 instead of Y=5
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

    const world = new CANNON.World()
    // Start with low gravity for floating
    world.gravity.set(0, -1, 0)
    world.allowSleep = true
    world.defaultContactMaterial.friction = 0.2  
    world.defaultContactMaterial.restitution = 0.3  

    worldRef.current = world

    if ('iterations' in world.solver) {
      (world.solver as any).iterations = 25; 
    }
    if ('tolerance' in world.solver) {
      (world.solver as any).tolerance = 0.001;
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

    spawnWalls(world, scene, wallMaterial)
    cubesRef.current = spawnCubes(scene, world, cubeMaterial)
    
    // Create constraints after cubes are spawned
    setTimeout(() => {
      createDiceConstraints();
      
      // Initialize floating right after constraints are created
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

      cubesRef.current.forEach((cube) => {
        if (Math.abs(cube.body.position.x) > 20 || 
            cube.body.position.y < -20 || 
            cube.body.position.y > 30 || 
            Math.abs(cube.body.position.z) > 20) {
          if (initialPositionsRef.current.length > 0) {
            const index = cubesRef.current.indexOf(cube);
            if (index >= 0 && index < initialPositionsRef.current.length) {
              cube.body.position.copy(initialPositionsRef.current[index]);
              cube.body.velocity.set(0, 0, 0);
              cube.body.angularVelocity.set(0, 0, 0);
            }
          }
        }
        
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
  }, [spawnCubes, createDiceConstraints, initFloating])

  // Request access to device motion sensors
  const handleRequestAccess = async () => {
    const result = await requestMotionAccess()
    setAccessGranted(result)
    
    if (result) {
      // Reset neutralPositionSetRef to ensure it gets set again with the new motion data
      neutralPositionSetRef.current = false;
      
      // Don't automatically unlock movement
      setMovementUnlocked(false);
      
      // Don't disable floating mode - we want dice to float by default
      setIsFloating(true);
      
      // Restart floating animation if needed
      if (!floatingInitializedRef.current) {
        setTimeout(() => {
          initFloating();
          floatingInitializedRef.current = true;
        }, 100);
      }
    }
  }

  // Handle dice roll results and roll screen
  useEffect(() => {
    if (rollResults.length > 0 && !isThrowing) {
      disableMovement();
      setVisible(true);
    }
  }, [rollResults, isThrowing, disableMovement]);

  // Handle roll screen close
  const handleCloseRollScreen = useCallback(() => {
    setVisible(false);
    
    setTimeout(() => {
      // Reset dice positions
      resetDicePositions();
      if(motion) calibrate(motion)
      
      setTimeout(() => {
        // Recreate constraints after reset
        createDiceConstraints();
        
        // IMPORTANT FIX: Set movement lock - require shake for next roll
        setMovementUnlocked(false);
        
        // Re-enable floating mode after roll
        setIsFloating(true);
        initFloating();
        floatingInitializedRef.current = true;
        
        console.log("Roll cycle complete. Movement locked - waiting for shake.");
      }, rollScreenAnimationTimeRef.current);
    }, 50);
  }, [resetDicePositions, createDiceConstraints, motion, calibrate, initFloating]);

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
    if (motion) {
      calibrate(motion);
      
      // IMPORTANT FIX: When recalibrating, lock movement and require shake
      setMovementUnlocked(false);
      
      // But keep floating mode
      setIsFloating(true);
      initFloating();
      
      console.log("Recalibrated. Movement locked - waiting for shake.");
    }
  }, [motion, calibrate, initFloating]);

  // NEW: Function to toggle cheat menu
  const toggleCheatMenu = useCallback(() => {
    setCheatMenuOpen(!cheatMenuOpen);
  }, [cheatMenuOpen]);

  // NEW: Function to toggle rigging
  const toggleRigging = useCallback(() => {
    setRiggingEnabled(!riggingEnabled);
    
    // If enabling rigging, set the target values
    if (!riggingEnabled) {
      setDiceTargetValues(targetValues);
      console.log("Dice rigging enabled with values:", targetValues);
    } else {
      console.log("Dice rigging disabled");
    }
  }, [riggingEnabled, targetValues, setDiceTargetValues]);

  // NEW: Function to update a single die value
  const updateDieValue = useCallback((index: number, value: number) => {
    if (index >= 0 && index < 3 && value >= 1 && value <= 6) {
      const newValues = [...targetValues];
      newValues[index] = value;
      setTargetValues(newValues);
      
      // Update active target values if rigging is enabled
      if (riggingEnabled) {
        setDiceTargetValues(newValues);
      }
    }
  }, [targetValues, riggingEnabled, setDiceTargetValues]);

  // NEW: Function to set a dice preset
  const setDicePreset = useCallback((preset: number[]) => {
    if (preset.length === 3 && preset.every(val => val >= 1 && val <= 6)) {
      setTargetValues(preset);
      
      // Update active target values if rigging is enabled
      if (riggingEnabled) {
        setDiceTargetValues(preset);
      }
    }
  }, [riggingEnabled, setDiceTargetValues]);

  // Handle replay button click with rigging support
  const handleReplay = useCallback(() => {
    if (hasRecording()) {
      console.log("Starting replay...");
      setVisible(false);
      
      // Reset positions before replay
      setTimeout(() => {
        resetDicePositions();
        
        setTimeout(() => {
          // Apply rigging if enabled
          if (riggingEnabled) {
            setDiceTargetValues(targetValues);
            rigRecording();
          }
          
          // Start replay
          startReplay();
        }, 200);
      }, 50);
    }
  }, [hasRecording, resetDicePositions, startReplay, riggingEnabled, targetValues, setDiceTargetValues, rigRecording]);

  return (
    <>
      <button
        className="fixed top-[20px] left-1/2 -translate-x-1/2 w-[200px] h-10 z-[99] bg-blue-500 text-white rounded-md"
        onClick={handleRequestAccess}
      >
        {motionAccessGranted ? "Access Granted" : "Enable Sensors"}
      </button>

      {/* Secret cheat button - positioned at bottom right for easier mobile access */}
      <button
        className="fixed bottom-[20px] right-[20px] w-14 h-14 z-[99] bg-black bg-opacity-30 text-white rounded-full flex items-center justify-center opacity-40"
        onClick={toggleCheatMenu}
      >
        🎲
      </button>

      {/* Cheat menu - positioned from bottom for mobile ergonomics */}
      {cheatMenuOpen && (
        <div className="fixed bottom-[70px] right-[20px] w-[280px] z-[100] bg-gray-800 bg-opacity-90 rounded-lg p-4 text-white shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-yellow-400">🎲 Dice Cheat Menu</h3>
            <button 
              className="text-gray-400 hover:text-white" 
              onClick={toggleCheatMenu}
            >
              ✕
            </button>
          </div>
          
          <div className="flex items-center mb-4">
            <span className="mr-2">Rigging:</span>
            <button 
              className={`px-3 py-1 rounded ${riggingEnabled ? 'bg-green-600' : 'bg-red-600'}`}
              onClick={toggleRigging}
            >
              {riggingEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          
          <div className="mb-4">
            <div className="text-sm text-gray-300 mb-2">Target Values:</div>
            <div className="flex space-x-2">
              {[0, 1, 2].map(dieIndex => (
                <div key={dieIndex} className="flex flex-col items-center">
                  <div className="bg-white text-black w-12 h-12 rounded-md flex items-center justify-center text-xl font-bold mb-1">
                    {targetValues[dieIndex]}
                  </div>
                  <div className="flex space-x-1">
                    <button 
                      className="w-6 h-6 bg-gray-600 rounded text-xs" 
                      onClick={() => updateDieValue(dieIndex, Math.max(1, targetValues[dieIndex] - 1))}
                    >
                      -
                    </button>
                    <button 
                      className="w-6 h-6 bg-gray-600 rounded text-xs"
                      onClick={() => updateDieValue(dieIndex, Math.min(6, targetValues[dieIndex] + 1))}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mb-4">
            <div className="text-sm text-gray-300 mb-2">Presets:</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-sm" onClick={() => setDicePreset([6, 6, 6])}>
                Triple 6's
              </button>
              <button className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-sm" onClick={() => setDicePreset([1, 1, 1])}>
                Triple 1's
              </button>
              <button className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-sm" onClick={() => setDicePreset([4, 5, 6])}>
                4-5-6
              </button>
              <button className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-sm" onClick={() => setDicePreset([1, 2, 3])}>
                1-2-3
              </button>
            </div>
          </div>
          
          <div className="text-xs text-gray-400 italic">
            Roll the dice as normal, then replay with your chosen values!
          </div>
        </div>
      )}

      {/* SHAKE INSTRUCTION - Only show when movement is locked */}
      {motionAccessGranted && !movementUnlocked && !isThrowing && !isVisible && !isReplaying() && (
        <div className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[250px] z-[99] flex flex-col items-center">
          <div className="text-center text-white rounded-md bg-orange-500 px-3 py-2 text-sm w-full">
            <div className="font-bold">
              SHAKE TO UNLOCK
            </div>
            <div className="text-xs mt-1">
              Shake your device to unlock dice movement
            </div>
          </div>
        </div>
      )}

      {/* WAITING FOR INITIAL MOVEMENT - Only show after shake unlock */}
      {motionAccessGranted && movementUnlocked && !deadzoneState.hasMoved && !isThrowing && !isVisible && !isReplaying() && (
        <div className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[250px] z-[99] flex flex-col items-center">
          <div className="text-center text-white rounded-md bg-blue-500 px-3 py-2 text-sm w-full">
            <div className="font-bold">
              UNLOCKED! TILT LEFT/RIGHT TO MOVE DICE
            </div>
            <div className="text-xs mt-1">
              Tilt device left/right to move floating dice, then hold still to throw
            </div>
          </div>
        </div>
      )}

     
      {/* Standard instruction - after moving but not in deadzone */}
      {motionAccessGranted && movementUnlocked && deadzoneState.hasMoved && !deadzoneState.inDeadzone && !isThrowing && !isVisible && !isReplaying() && (
        <div className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[250px] h-10 z-[99] text-center bg-black text-white rounded-md bg-opacity-50 flex items-center justify-center">
          Tilt device left/right to move dice or hold still to throw
        </div>
      )}

      {/* On-screen dice results display */}
      {rollResults.length > 0 && !isThrowing && !isReplaying() && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center">
          <div className="flex space-x-4 mb-2">
            {rollResults.map((value, index) => (
              <div 
                key={index} 
                className="w-15 h-14 bg-white rounded-lg flex items-center justify-center"
                style={{
                  border: '3px solid #333',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
                  position: 'relative'
                }}
              >
                <span className="text-4xl font-extrabold" style={{ color: '#000' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          
          <div 
            className="bg-black text-white py-2 px-6 rounded-full font-bold text-xl"
            style={{ boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)' }}
          >
            Total: {diceTotal}
          </div>
          
          {/* NEW: Show rigging indicator if enabled */}
          {riggingEnabled && (
            <div className="mt-2 px-3 py-1 bg-yellow-500 text-black text-xs font-bold rounded-full">
              🎲 RIGGED ROLL 🎲
            </div>
          )}
        </div>
      )}

      {/* Replay button - only show when a recording exists and dice are settled */}
      {hasRecording() && rollResults.length > 0 && !isThrowing && !isReplaying() && !isVisible && (
        <div className="fixed left-1/2 bottom-24 -translate-x-1/2 z-[100]">
          <button
            onClick={handleReplay}
            className={`${riggingEnabled ? 'bg-purple-700' : 'bg-purple-600'} text-white px-6 py-3 rounded-lg font-bold text-lg hover:bg-purple-700 transition-colors shadow-lg flex items-center space-x-2`}
          >
            <span>↺</span>
            <span>
              {riggingEnabled ? `Replay Rigged Roll (${targetValues.join('-')})` : 'Replay Last Roll'}
            </span>
          </button>
        </div>
      )}

      {/* Replaying indicator */}
      {isReplaying() && (
        <div className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[250px] h-10 z-[99] text-center bg-purple-500 text-white rounded-md flex items-center justify-center font-bold">
          {riggingEnabled ? 'Replaying Rigged Roll...' : 'Replaying...'}
        </div>
      )}

      {/* Instructions for throwing mode */}
      {motionAccessGranted && isThrowing && !isReplaying() && (
        <div className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[250px] h-10 z-[99] text-center bg-green-500 text-white rounded-md flex items-center justify-center font-bold">
          Throwing dice...
        </div>
      )}

      <RollScreen 
        isVisible={isVisible} 
        result={rollResults} 
        onClose={handleCloseRollScreen} 
      />

      <div ref={mountRef} className={`fixed top-0 left-0 w-screen h-screen overflow-hidden ${className || ""}`} />
    </>
  )
}