"use client"

import type React from "react"
import dynamic from "next/dynamic"

// Import types only to avoid server-side execution
import type * as THREE from "three"
import type * as CANNON from "cannon-es"

// Dynamically import components that use browser APIs
const DiceGame = dynamic(() => import("./dice-game").then((mod) => mod.DiceGame), {
  ssr: false,
  loading: () => <div className="w-full h-screen flex items-center justify-center">Loading game...</div>,
})

export type Cube = {
  mesh: THREE.Mesh
  body: CANNON.Body
}

interface Props {
  className?: string
}

export const GameBoard: React.FC<Props> = ({ className }) => {
  return <DiceGame className={className} />
}