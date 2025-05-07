"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Define interface for acceleration data
export interface AccelerationData {
  x: number | null;
  y: number | null;
  z: number | null;
}

// Define interface for rotation rate data
export interface RotationRateData {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

// Complete device motion data structure
export interface DeviceMotionData {
  acceleration: AccelerationData;
  accelerationIncludingGravity: AccelerationData;
  rotationRate: RotationRateData;
  interval: number | null;
}

// Shake detection configuration
const DEFAULT_SHAKE_THRESHOLD = 2.0;
const SHAKE_SAMPLE_SIZE = 5;
const SHAKE_TIMEOUT = 1000; // Time before shake is reset in ms

export const useDeviceMotion = (options?: {
  shakeThreshold?: number;
  sampleSize?: number;
  shakeTimeout?: number;
}) => {
  // Set configuration with defaults
  const shakeThreshold = options?.shakeThreshold || DEFAULT_SHAKE_THRESHOLD;
  const sampleSize = options?.sampleSize || SHAKE_SAMPLE_SIZE;
  const shakeTimeout = options?.shakeTimeout || SHAKE_TIMEOUT;

  // State for the motion data
  const [motion, setMotion] = useState<DeviceMotionData>({
    acceleration: { x: null, y: null, z: null },
    accelerationIncludingGravity: { x: null, y: null, z: null },
    rotationRate: { alpha: null, beta: null, gamma: null },
    interval: null
  });
  
  // State for access
  const [accessGranted, setAccessGranted] = useState<boolean>(false);
  
  // For shake detection
  const lastAcceleration = useRef<AccelerationData>({ x: 0, y: 0, z: 0 });
  const accelerationSamples = useRef<Array<AccelerationData>>([]);
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const shakeTimeoutRef = useRef<number | null>(null);
  
  // Process motion events
  const handleDeviceMotion = useCallback((event: DeviceMotionEvent) => {
    // Extract the motion data
    const newMotion: DeviceMotionData = {
      acceleration: {
        x: event.acceleration?.x ?? null,
        y: event.acceleration?.y ?? null,
        z: event.acceleration?.z ?? null
      },
      accelerationIncludingGravity: {
        x: event.accelerationIncludingGravity?.x ?? null,
        y: event.accelerationIncludingGravity?.y ?? null,
        z: event.accelerationIncludingGravity?.z ?? null
      },
      rotationRate: {
        alpha: event.rotationRate?.alpha ?? null,
        beta: event.rotationRate?.beta ?? null,
        gamma: event.rotationRate?.gamma ?? null
      },
      interval: event.interval || null
    };
    
    // Update state with new motion data
    setMotion(newMotion);
    
    // Process for shake detection
    if (newMotion.acceleration.x !== null && 
        newMotion.acceleration.y !== null && 
        newMotion.acceleration.z !== null) {
      const accel = {
        x: newMotion.acceleration.x,
        y: newMotion.acceleration.y,
        z: newMotion.acceleration.z
      };
      
      // Add to samples for averaging
      accelerationSamples.current.push(accel);
      if (accelerationSamples.current.length > sampleSize) {
        accelerationSamples.current.shift();
      }
      
      // Calculate acceleration delta (change in acceleration)
      const deltaX = Math.abs(accel.x - (lastAcceleration.current.x || 0));
      const deltaY = Math.abs(accel.y - (lastAcceleration.current.y || 0));
      const deltaZ = Math.abs(accel.z - (lastAcceleration.current.z || 0));
      
      // Update last acceleration values
      lastAcceleration.current = accel;
      
      // Calculate total acceleration change
      const accelerationChange = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
      
      // Check if shake is detected
      if (accelerationChange > shakeThreshold) {
        setIsShaking(true);
        
        // Reset shake status after timeout
        if (shakeTimeoutRef.current !== null) {
          window.clearTimeout(shakeTimeoutRef.current);
        }
        
        shakeTimeoutRef.current = window.setTimeout(() => {
          setIsShaking(false);
          shakeTimeoutRef.current = null;
        }, shakeTimeout);
      }
    }
  }, [shakeThreshold, sampleSize, shakeTimeout]);
  
  // Request access to device motion
  const requestAccess = useCallback(async (): Promise<boolean> => {
    // For iOS 13+ which requires permission
    if (typeof DeviceMotionEvent !== 'undefined' && 
        typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const permissionState = await (DeviceMotionEvent as any).requestPermission();
        const granted = permissionState === 'granted';
        
        if (granted) {
          window.addEventListener('devicemotion', handleDeviceMotion);
          setAccessGranted(true);
        }
        
        return granted;
      } catch (error) {
        console.error('Error requesting motion permission:', error);
        return false;
      }
    } 
    // For browsers that don't require permission
    else if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', handleDeviceMotion);
      setAccessGranted(true);
      return true;
    }
    
    console.warn('DeviceMotion API not available in this browser');
    return false;
  }, [handleDeviceMotion]);
  
  // Revoke access
  const revokeAccess = useCallback(() => {
    window.removeEventListener('devicemotion', handleDeviceMotion);
    setAccessGranted(false);
  }, [handleDeviceMotion]);
  
  // Cleanup listener on unmount
  useEffect(() => {
    return () => {
      if (accessGranted) {
        window.removeEventListener('devicemotion', handleDeviceMotion);
      }
      
      if (shakeTimeoutRef.current !== null) {
        window.clearTimeout(shakeTimeoutRef.current);
      }
    };
  }, [accessGranted, handleDeviceMotion]);
  
  // Normalized acceleration data (for easier movement calculations)
  const normalizedAcceleration = {
    x: motion.accelerationIncludingGravity.x !== null ? 
       Math.max(-1, Math.min(1, motion.accelerationIncludingGravity.x / 9.8)) : 0,
    y: motion.accelerationIncludingGravity.y !== null ?
       Math.max(-1, Math.min(1, motion.accelerationIncludingGravity.y / 9.8)) : 0,
    z: motion.accelerationIncludingGravity.z !== null ?
       Math.max(-1, Math.min(1, motion.accelerationIncludingGravity.z / 9.8)) : 0
  };
  
  return {
    motion,
    normalizedAcceleration,
    isShaking,
    accessGranted,
    requestAccess,
    revokeAccess
  };
};