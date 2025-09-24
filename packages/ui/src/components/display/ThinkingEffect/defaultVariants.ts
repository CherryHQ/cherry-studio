import type { Variants } from 'motion/react'
export const lightbulbVariants: Variants = {
  active: {
    opacity: [1, 0.2, 1],
    transition: {
      duration: 1.2,
      ease: 'easeInOut',
      times: [0, 0.5, 1],
      repeat: Infinity
    }
  },
  idle: {
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: 'easeInOut'
    }
  }
}

export const lightbulbSoftVariants: Variants = {
  active: {
    opacity: [1, 0.5, 1],
    transition: {
      duration: 2,
      ease: 'easeInOut',
      times: [0, 0.5, 1],
      repeat: Infinity
    }
  },
  idle: {
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: 'easeInOut'
    }
  }
}
