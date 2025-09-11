import { Search } from 'lucide-react'
import { motion } from 'motion/react'
import styled from 'styled-components'

interface Props {
  text: React.ReactNode
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

export default function Spinner({ text }: Props) {
  return (
    <Searching
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
const SearchWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  /* font-size: 14px; */
  padding: 0px;
  /* padding-left: 0; */
`
const Searching = motion.create(SearchWrapper)
