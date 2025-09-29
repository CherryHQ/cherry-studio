// Original: src/renderer/src/components/Spinner.tsx
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'

interface Props {
  text: React.ReactNode
  className?: string
}

// Define variants for the spinner animation
const spinnerVariants = {
  defaultColor: {
    color: '#2a2a2a'
  },
  dimmed: {
    color: '#8C9296'
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
