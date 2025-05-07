"use client"

import type React from "react"
import { cn } from "@/shared"
import Image from "next/image"
import { AnimatePresence, motion } from "framer-motion"
import type { StaticImageData } from "next/image"

// Import images directly here since this component is only loaded client-side
import screen1 from "@public/assets/games/screenes/468.png"
import screen2 from "@public/assets/games/screenes/p+1.png"
import screen3 from "@public/assets/games/screenes/Dead roll.png"
import screen4 from "@public/assets/games/screenes/5.png"
import screen5 from "@public/assets/games/screenes/p+6.png"
import screen6 from "@public/assets/games/screenes/toak.png"
import screen7 from "@public/assets/games/screenes/467.png"

interface Props {
  className?: string
  isVisible: boolean
  result: number[]
  onClose: () => void
}

const getScreenImage = (dice: number[]): StaticImageData => {
  const sorted = [...dice].sort((a, b) => a - b)

  if (sorted[0] === 1 && sorted[1] === 2 && sorted[2] === 3) {
    return screen1
  }

  if (sorted[0] === 4 && sorted[1] === 5 && sorted[2] === 6) {
    return screen7
  }

  if (dice[0] === dice[1] && dice[1] === dice[2]) {
    return screen6
  }

  let pairValue: number | null = null
  if (dice[0] === dice[1] && dice[0] !== dice[2]) {
    pairValue = dice[0]
  } else if (dice[1] === dice[2] && dice[1] !== dice[0]) {
    pairValue = dice[1]
  } else if (dice[0] === dice[2] && dice[0] !== dice[1]) {
    pairValue = dice[0]
  }

  if (pairValue !== null) {
    if (pairValue === 6) {
      return screen5
    }
    if (pairValue === 1) {
      return screen2
    }
    if ([2, 3, 4, 5].includes(pairValue)) {
      return screen4
    }
  }

  return screen3
}

export const DynamicRollScreen: React.FC<Props> = ({ className, isVisible, result, onClose }) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <div className="fixed top-0 left-0 bottom-0 right-0 w-full h-full z-[100]">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 20,
              duration: 0.4,
            }}
            className={cn("fixed top-0 right-0 left-0 bottom-0 w-full h-full z-[90]", className)}
          >
            <motion.div
              animate={{
                x: [0, -10, 10, -10, 10, 0],
              }}
              transition={{
                type: "tween",
                duration: 0.5,
                ease: "easeInOut",
              }}
              onClick={onClose}
            >
              <Image
                src={getScreenImage(result) || "/placeholder.svg"}
                className="w-full h-full"
                alt="Base Screen"
                placeholder="blur"
                priority
              />
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
