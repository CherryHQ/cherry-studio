import type { Variants } from 'motion/react'

const reducedPageVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.01 }
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.01 }
  }
}

const reducedStaggerContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      delayChildren: 0,
      staggerChildren: 0
    }
  }
}

const reducedStaggerItemVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.01 }
  }
}

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.32,
      ease: 'easeOut'
    }
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: {
      duration: 0.2,
      ease: 'easeOut'
    }
  }
}

export const staggerContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      delayChildren: 0.04,
      staggerChildren: 0.07
    }
  }
}

export const staggerItemVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.26,
      ease: 'easeOut'
    }
  }
}

export const logoItemVariants: Variants = {
  initial: { opacity: 0, scale: 0.98, y: 6 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: 'easeOut'
    }
  }
}

export const getMotionConfig = (reducedMotion: boolean) => ({
  pageVariants: reducedMotion ? reducedPageVariants : pageVariants,
  staggerContainerVariants: reducedMotion ? reducedStaggerContainerVariants : staggerContainerVariants,
  staggerItemVariants: reducedMotion ? reducedStaggerItemVariants : staggerItemVariants,
  logoItemVariants: reducedMotion ? reducedStaggerItemVariants : logoItemVariants
})
