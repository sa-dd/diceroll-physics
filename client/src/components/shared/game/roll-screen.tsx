"use client"

import type React from "react"

// Import images dynamically to avoid SSR issues
import dynamic from "next/dynamic"

// Define a placeholder component for SSR
const DynamicRollScreen = dynamic(() => import("./dynamic-roll-screen").then((mod) => mod.DynamicRollScreen), {
  ssr: false,
  loading: () => <div>Loading roll screen...</div>,
})

interface Props {
  className?: string
  isVisible: boolean
  result: number[]
  onClose: () => void
}

export const RollScreen: React.FC<Props> = (props) => {
  return <DynamicRollScreen {...props} />
}
