export const lightbulbVariants = {
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

export const lightbulbSoftVariants = {
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
