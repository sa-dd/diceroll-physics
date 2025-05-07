"use client"

import React, { useState, useEffect } from 'react';
import type { DeviceOrientation } from './hooks/use-device-orientation';

interface OrientationDebugProps {
  orientation: DeviceOrientation | null;
  sensorInfo?: any; // Additional sensor fusion info if available
  enabled?: boolean;
}

export const OrientationDebug: React.FC<OrientationDebugProps> = ({ 
  orientation, 
  sensorInfo,
  enabled = true 
}) => {
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [lastTime, setLastTime] = useState(Date.now());

  // Calculate FPS
  useEffect(() => {
    if (!enabled) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed > 0) {
        setFps(Math.round((frameCount / elapsed) * 1000));
        setFrameCount(0);
        setLastTime(now);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [enabled, frameCount, lastTime]);

  // Increment frame counter whenever orientation updates
  useEffect(() => {
    if (!enabled) return;
    setFrameCount(prev => prev + 1);
  }, [orientation, enabled]);

  if (!enabled) return null;

  return (
    <div className="fixed top-5 right-5 z-[999] bg-black bg-opacity-70 text-white p-3 rounded-lg text-xs font-mono max-w-[300px] shadow-lg">
      <div className="text-center font-bold mb-2 text-sm border-b border-gray-500 pb-1">
        Device Orientation Debug
      </div>
      
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <div className="text-gray-300">Alpha (Yaw):</div>
        <div className="text-green-300 font-bold">
          {orientation?.alpha !== null ? orientation?.alpha?.toFixed(2) + '°' : 'null'}
        </div>
        
        <div className="text-gray-300">Beta (Pitch):</div>
        <div className="text-green-300 font-bold">
          {orientation?.beta !== null ? orientation?.beta?.toFixed(2) + '°' : 'null'}
        </div>
        
        <div className="text-gray-300">Gamma (Roll):</div>
        <div className="text-green-300 font-bold">
          {orientation?.gamma !== null ? orientation?.gamma?.toFixed(2) + '°' : 'null'}
        </div>
        
        <div className="text-gray-300">Absolute:</div>
        <div className="text-green-300 font-bold">
          {orientation?.absolute !== undefined ? String(orientation.absolute) : 'null'}
        </div>
        
        <div className="text-gray-300">FPS:</div>
        <div className="text-green-300 font-bold">{fps}</div>
      </div>

      {sensorInfo && (
        <>
          <div className="mt-2 pt-1 border-t border-gray-500 font-bold text-sm">
            Sensor Fusion Data
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1">
            <div className="text-gray-300">Processed Yaw:</div>
            <div className="text-blue-300 font-bold">{sensorInfo.processedYaw}°</div>
            
            <div className="text-gray-300">Neutral Yaw:</div>
            <div className="text-blue-300 font-bold">{sensorInfo.neutralYaw}°</div>
            
            <div className="text-gray-300">Yaw Difference:</div>
            <div className="text-blue-300 font-bold">{sensorInfo.yawDiff}°</div>
            
            <div className="text-gray-300">Activity:</div>
            <div className="text-blue-300 font-bold">{sensorInfo.rollPitchActivity}</div>
          </div>
        </>
      )}
    </div>
  );
};