import type { TargetAndTransition, Transition } from 'motion/react'

interface ConversationIslandMotionInput {
  exiting: boolean
  reducedMotion: boolean
}

interface ConversationIslandMotionPlan {
  initial: TargetAndTransition | false
  animate: TargetAndTransition
  transition: Transition
}

const VISIBLE: TargetAndTransition = { opacity: 1, scaleX: 1, scaleY: 1 }

export function resolveConversationIslandMotion({
  exiting,
  reducedMotion
}: ConversationIslandMotionInput): ConversationIslandMotionPlan {
  if (reducedMotion) {
    return {
      initial: false,
      animate: VISIBLE,
      transition: { duration: 0 }
    }
  }

  if (exiting) {
    return {
      initial: false,
      animate: { opacity: 0, scaleX: 0.96, scaleY: 0.82 },
      transition: { duration: 0.18, ease: [0.4, 0, 1, 1] }
    }
  }

  return {
    initial: { opacity: 0, scaleX: 0.9, scaleY: 0.72 },
    animate: VISIBLE,
    transition: { type: 'spring', stiffness: 224, damping: 25, mass: 1 }
  }
}
