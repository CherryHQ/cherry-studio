// Original: src/renderer/components/Spinner.tsx
import { Search } from 'lucide-react'
import { motion } from 'motion/react'

interface Props {
  text: React.ReactNode
  className?: string
}

// Define variants for the spinner animation
const spinnerVariants = {
  defaultColor: {
    color: 'var(--color-foreground)'
  },
  dimmed: {
    color: 'var(--color-foreground-muted)'
  }
}

export default function Spinner({ text, className = '' }: Props) {
  return (
    <motion.div
      className={`flex items-center gap-1 p-0 ${className}`}
      variants={spinnerVariants}
      initial="defaultColor"
      animate={['defaultColor', 'dimmed']}
      transition={{
        duration: 0.8,
        repeat: Infinity,
        repeatType: 'reverse',
        ease: 'easeInOut'
      }}>
      <Search size={16} style={{ color: 'unset' }} />
      <span>{text}</span>
    </motion.div>
  )
}
