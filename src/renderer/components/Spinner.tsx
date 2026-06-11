import { Search } from 'lucide-react'
import { motion } from 'motion/react'

interface Props {
  text: React.ReactNode
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

const Searching = motion.create('div')

export default function Spinner({ text }: Props) {
  return (
    <Searching
      className="flex items-center gap-1 p-0"
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
    </Searching>
  )
}
