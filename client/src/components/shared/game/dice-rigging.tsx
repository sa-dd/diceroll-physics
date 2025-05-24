// dice-rigging.tsx - Complete Rigging Engine

"use client"

import * as THREE from "three"

// Rigging constants
const VELOCITY_SETTLE_THRESHOLD = 0.8;
const MIDAIR_HEIGHT_THRESHOLD = 2.0;
const PHYSICS_INFLUENCE_FRAMES = 30;
const TRANSITION_FRAMES = 15;
const MAX_ANGULAR_VELOCITY = 10.0;

// Interface that matches your existing PhysicsFrame structure
export interface PhysicsFrame {
  timestamp: number;
  diceStates: {
    position: { x: number, y: number, z: number };
    quaternion: { x: number, y: number, z: number, w: number };
    velocity: { x: number, y: number, z: number };
    angularVelocity: { x: number, y: number, z: number };
  }[];
}

// Internal interface for rigging processing
interface DiceFrame {
  timestamp: number;
  diceStates: {
    position: { x: number, y: number, z: number };
    quaternion: { x: number, y: number, z: number, w: number };
    velocity: { x: number, y: number, z: number };
    angularVelocity: { x: number, y: number, z: number };
  }[];
}

// Convert PhysicsFrame to DiceFrame for rigging
const physicsFrameToDiceFrame = (frame: PhysicsFrame): DiceFrame => {
  return {
    timestamp: frame.timestamp,
    diceStates: frame.diceStates.map(state => ({
      position: { ...state.position },
      quaternion: { ...state.quaternion },
      velocity: { ...state.velocity },
      angularVelocity: { ...state.angularVelocity }
    }))
  };
};

// Convert DiceFrame back to PhysicsFrame
const diceFrameToPhysicsFrame = (frame: DiceFrame): PhysicsFrame => {
  return {
    timestamp: frame.timestamp,
    diceStates: frame.diceStates.map(state => ({
      position: { ...state.position },
      quaternion: { ...state.quaternion },
      velocity: { ...state.velocity },
      angularVelocity: { ...state.angularVelocity }
    }))
  };
};

// Calculate the orientation needed for a specific dice face to be on top
const calculateLandingOrientation = (targetValue: number): THREE.Quaternion => {
  // Dice face mappings: 1=right, 2=top, 3=front, 4=back, 5=bottom, 6=left
  const faceRotations: { [key: number]: THREE.Euler } = {
    1: new THREE.Euler(0, 0, Math.PI/2),        // Right face up
    2: new THREE.Euler(0, 0, 0),                // Top face up (default)
    3: new THREE.Euler(Math.PI/2, 0, 0),        // Front face up
    4: new THREE.Euler(-Math.PI/2, 0, 0),       // Back face up
    5: new THREE.Euler(Math.PI, 0, 0),          // Bottom face up
    6: new THREE.Euler(0, 0, -Math.PI/2)        // Left face up
  };
  
  const euler = faceRotations[targetValue] || faceRotations[1];
  return new THREE.Quaternion().setFromEuler(euler);
};

// Spherical linear interpolation for quaternions
const slerpQuaternions = (q1: THREE.Quaternion, q2: THREE.Quaternion, t: number): THREE.Quaternion => {
  const result = new THREE.Quaternion();
  result.copy(q1);
  result.slerp(q2, t);
  return result;
};

// Calculate torque needed to orient dice toward target rotation
const calculateOrientingTorque = (
  currentRotation: THREE.Quaternion, 
  targetRotation: THREE.Quaternion, 
  strength: number
): THREE.Vector3 => {
  // Calculate the rotation difference
  const invCurrent = new THREE.Quaternion().copy(currentRotation).invert();
  const rotDiff = new THREE.Quaternion().multiplyQuaternions(targetRotation, invCurrent);
  
  // Convert to axis-angle representation
  const axis = new THREE.Vector3();
  const angle = rotDiff.angleTo(new THREE.Quaternion(0, 0, 0, 1));
  
  if (angle > 0.001) {
    rotDiff.normalize();
    // Extract axis from quaternion
    const s = Math.sqrt(1 - rotDiff.w * rotDiff.w);
    if (s > 0.001) {
      axis.set(rotDiff.x / s, rotDiff.y / s, rotDiff.z / s);
    }
  }
  
  // Apply torque proportional to angle and strength
  const torque = axis.clone().multiplyScalar(angle * strength);
  
  // Clamp torque magnitude
  const maxTorque = 2.0;
  if (torque.length() > maxTorque) {
    torque.normalize().multiplyScalar(maxTorque);
  }
  
  return torque;
};

// Find the midair point where dice are highest and moving
const findMidairPoint = (frames: DiceFrame[]): number => {
  let maxHeight = -Infinity;
  let midAirIndex = Math.floor(frames.length * 0.3); // Default to 30% through
  
  // Look for the highest point where dice are still moving significantly
  for (let i = Math.floor(frames.length * 0.1); i < Math.floor(frames.length * 0.7); i++) {
    const frame = frames[i];
    
    // Calculate average height and movement
    const avgHeight = frame.diceStates.reduce((sum, state) => sum + state.position.y, 0) / frame.diceStates.length;
    const avgSpeed = frame.diceStates.reduce((sum, state) => {
      const vel = state.velocity;
      return sum + Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    }, 0) / frame.diceStates.length;
    
    // Look for high point with significant movement
    if (avgHeight > maxHeight && avgSpeed > 1.0) {
      maxHeight = avgHeight;
      midAirIndex = i;
    }
  }
  
  console.log(`Found midair point at index ${midAirIndex} with height ${maxHeight.toFixed(2)}`);
  return midAirIndex;
};

// Find when dice start to settle
const findSettleIndex = (frames: DiceFrame[]): number => {
  // Start from the end and move backward
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    
    // Check if all dice have low velocities
    const allSlowingDown = frame.diceStates.every(state => {
      const vel = state.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      return speed < VELOCITY_SETTLE_THRESHOLD;
    });
    
    if (allSlowingDown) {
      // Start transition a bit before they completely settle
      return Math.max(0, i - 5);
    }
  }
  
  // If we can't find a good point, use 2/3 of the recording
  return Math.floor(frames.length * 2 / 3);
};

// Create natural transition frames with gradual physics influence
const createNaturalTransitionFrames = (
  startFrame: DiceFrame,
  originalFrames: DiceFrame[],
  targetValues: number[],
  strengthFactor: number = 0.1
): DiceFrame[] => {
  const transitionFrames: DiceFrame[] = [];
  
  // Calculate target orientations for each die
  const targetLandingOrientations = targetValues.map(value => calculateLandingOrientation(value));
  
  const totalFrames = originalFrames.length > 0 ? originalFrames.length : PHYSICS_INFLUENCE_FRAMES;
  
  // Process each frame of the original physics simulation
  for (let i = 0; i < totalFrames; i++) {
    const useOriginalFrame = i < originalFrames.length;
    const frameToModify = useOriginalFrame ? originalFrames[i] : 
                        (i > 0 ? transitionFrames[i-1] : startFrame);
    
    // Calculate progress through the transition (0-1)
    const progress = i / totalFrames;
    
    // Modified sigmoid function for earlier, more aggressive influence
    const sigmoidProgress = 1 / (1 + Math.exp(-15 * (progress - 0.35)));
    const appliedStrength = sigmoidProgress * strengthFactor * 1.2;
    
    // Create a new frame by modifying the original
    const newFrame: DiceFrame = {
      timestamp: useOriginalFrame ? originalFrames[i].timestamp : 
                (i > 0 ? transitionFrames[i-1].timestamp + 16 : startFrame.timestamp + 16),
      diceStates: frameToModify.diceStates.map((state, idx) => {
        // Handle position with physics
        let newPosition = { ...state.position };
        if (i > 0 && transitionFrames.length > 0) {
          const prevState = transitionFrames[i-1].diceStates[idx];
          const dt = 0.016; // 16ms between frames
          
          newPosition.x = prevState.position.x + prevState.velocity.x * dt;
          newPosition.y = prevState.position.y + prevState.velocity.y * dt;
          newPosition.z = prevState.position.z + prevState.velocity.z * dt;
        }
        
        // Gradually influence rotations toward the landing orientation
        const currentQuat = new THREE.Quaternion(
          state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w
        );
        const targetQuat = targetLandingOrientations[idx];
        const influencedQuat = slerpQuaternions(currentQuat, targetQuat, appliedStrength);
        
        // Apply physics-based adjustments to velocities
        const newVel = { ...state.velocity };
        
        // As dice approach ground, ensure they have downward momentum
        if (state.position.y > MIDAIR_HEIGHT_THRESHOLD && progress > 0.3) {
          newVel.y = Math.min(newVel.y, -2.5 * (1.0 - progress));
        }
        
        // Add subtle horizontal adjustments
        if (progress > 0.2) {
          newVel.x += (Math.random() - 0.5) * 0.15 * appliedStrength;
          newVel.z += (Math.random() - 0.5) * 0.15 * appliedStrength;
        }
        
        // Calculate torque for angular velocity
        const torque = calculateOrientingTorque(currentQuat, targetQuat, appliedStrength * 0.3);
        const newAngVel = {
          x: state.angularVelocity.x + torque.x,
          y: state.angularVelocity.y + torque.y,
          z: state.angularVelocity.z + torque.z
        };
        
        // Clamp angular velocity
        const angSpeed = Math.sqrt(newAngVel.x * newAngVel.x + newAngVel.y * newAngVel.y + newAngVel.z * newAngVel.z);
        if (angSpeed > MAX_ANGULAR_VELOCITY) {
          const scale = MAX_ANGULAR_VELOCITY / angSpeed;
          newAngVel.x *= scale;
          newAngVel.y *= scale;
          newAngVel.z *= scale;
        }
        
        return {
          position: newPosition,
          quaternion: {
            x: influencedQuat.x,
            y: influencedQuat.y,
            z: influencedQuat.z,
            w: influencedQuat.w
          },
          velocity: newVel,
          angularVelocity: newAngVel
        };
      })
    };
    
    transitionFrames.push(newFrame);
  }
  
  // Add a final frame with reduced velocities for smooth settling
  if (transitionFrames.length > 0) {
    const lastFrame = transitionFrames[transitionFrames.length - 1];
    const finalFrame: DiceFrame = {
      timestamp: lastFrame.timestamp + 16,
      diceStates: lastFrame.diceStates.map((state, idx) => {
        // Final adjustment to ensure correct orientation
        const currentQuat = new THREE.Quaternion(
          state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w
        );
        const finalQuat = slerpQuaternions(currentQuat, targetLandingOrientations[idx], 0.3);
        
        return {
          position: { ...state.position },
          quaternion: {
            x: finalQuat.x,
            y: finalQuat.y,
            z: finalQuat.z,
            w: finalQuat.w
          },
          velocity: {
            x: state.velocity.x * 0.4,
            y: state.velocity.y * 0.4,
            z: state.velocity.z * 0.4
          },
          angularVelocity: {
            x: state.angularVelocity.x * 0.2,
            y: state.angularVelocity.y * 0.2,
            z: state.angularVelocity.z * 0.2
          }
        };
      })
    };
    
    transitionFrames.push(finalFrame);
  }
  
  return transitionFrames;
};

// Create final transition frames for settling
const createTransitionFrames = (
  startFrame: DiceFrame,
  targetValues: number[],
  numFrames: number
): DiceFrame[] => {
  const transitionFrames: DiceFrame[] = [];
  const targetOrientations = targetValues.map(value => calculateLandingOrientation(value));
  
  for (let i = 0; i < numFrames; i++) {
    const progress = i / (numFrames - 1);
    const frame: DiceFrame = {
      timestamp: startFrame.timestamp + (i + 1) * 16,
      diceStates: startFrame.diceStates.map((state, idx) => {
        // Interpolate to final orientation
        const currentQuat = new THREE.Quaternion(
          state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w
        );
        const finalQuat = slerpQuaternions(currentQuat, targetOrientations[idx], progress * 0.8);
        
        // Gradually reduce velocities
        const velocityScale = 1.0 - (progress * 0.9);
        const angularScale = 1.0 - (progress * 0.95);
        
        return {
          position: { ...state.position },
          quaternion: {
            x: finalQuat.x,
            y: finalQuat.y,
            z: finalQuat.z,
            w: finalQuat.w
          },
          velocity: {
            x: state.velocity.x * velocityScale,
            y: state.velocity.y * velocityScale,
            z: state.velocity.z * velocityScale
          },
          angularVelocity: {
            x: state.angularVelocity.x * angularScale,
            y: state.angularVelocity.y * angularScale,
            z: state.angularVelocity.z * angularScale
          }
        };
      })
    };
    
    transitionFrames.push(frame);
  }
  
  return transitionFrames;
};

// Main rigging function
export const rigRecording = (
  recordedFrames: PhysicsFrame[],
  targetValues: number[],
  isRigged: boolean
): { frames: PhysicsFrame[], isRigged: boolean } => {
  if (recordedFrames.length < 10 || isRigged) {
    console.log("Recording too short or already rigged");
    return { frames: recordedFrames, isRigged };
  }
  
  console.log("Rigging dice recording to show values:", targetValues);
  
  try {
    // Convert to DiceFrame format for processing
    const diceFrames = recordedFrames.map(physicsFrameToDiceFrame);
    
    // Find mid-air point for early influence
    const midAirIndex = findMidairPoint(diceFrames);
    console.log(`Found mid-air point at index ${midAirIndex} out of ${diceFrames.length} frames`);
    
    // Find settle point as fallback
    const settleIndex = findSettleIndex(diceFrames);
    console.log(`Found settle index at ${settleIndex} out of ${diceFrames.length} frames`);
    
    // Keep frames before mid-air point unchanged
    const naturalFrames = diceFrames.slice(0, midAirIndex);
    
    // Extract frames from mid-air to settling for physics influence
    const framesToInfluence = diceFrames.slice(
      midAirIndex, 
      Math.min(settleIndex, diceFrames.length)
    );
    
    // Apply gradual physics influence to create natural-looking rigged frames
    const physicsInfluencedFrames = createNaturalTransitionFrames(
      diceFrames[midAirIndex],
      framesToInfluence,
      targetValues,
      0.9 // Strong influence factor
    );
    
    // If there are any frames between physics influence and the end, add them
    let remainingFrames: DiceFrame[] = [];
    if (settleIndex < diceFrames.length) {
      // Apply final adjustments for complete settling
      remainingFrames = createTransitionFrames(
        physicsInfluencedFrames[physicsInfluencedFrames.length - 1],
        targetValues,
        TRANSITION_FRAMES
      );
    }
    
    // Combine all phases
    const riggedDiceFrames = [
      ...naturalFrames,               // Keep natural throw until mid-air
      ...physicsInfluencedFrames,     // Apply gradual physics influence
      ...remainingFrames              // Final settling adjustments if needed
    ];
    
    // Convert back to PhysicsFrame format
    const riggedPhysicsFrames = riggedDiceFrames.map(diceFrameToPhysicsFrame);
    
    console.log(`Rigging complete. New recording has ${riggedPhysicsFrames.length} frames`);
    
    return { frames: riggedPhysicsFrames, isRigged: true };
  } catch (error) {
    console.error("Error during rigging:", error);
    return { frames: recordedFrames, isRigged: false };
  }
};

// Export helper functions for advanced usage
export {
  findMidairPoint,
  findSettleIndex,
  createNaturalTransitionFrames,
  createTransitionFrames,
  calculateLandingOrientation,
  slerpQuaternions,
  calculateOrientingTorque,
  physicsFrameToDiceFrame,
  diceFrameToPhysicsFrame
};