import { motion } from 'framer-motion'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

interface ConfettiProps {
  duration?: number
}

interface Particle {
  id: number
  x: number
  color: string
  delay: number
  rotation: number
  scale: number
}

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE']

const Confetti: FC<ConfettiProps> = ({ duration = 2000 }) => {
  const [particles, setParticles] = useState<Particle[]>([])
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    // Generate particles
    const newParticles: Particle[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100, // percentage across screen
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 0.5,
      rotation: Math.random() * 360,
      scale: 0.5 + Math.random() * 0.5
    }))
    setParticles(newParticles)

    // Hide after duration
    const timer = setTimeout(() => {
      setIsVisible(false)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration])

  if (!isVisible) return null

  return (
    <Container>
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          initial={{
            y: -20,
            x: `${particle.x}vw`,
            opacity: 1,
            rotate: particle.rotation,
            scale: particle.scale
          }}
          animate={{
            y: '100vh',
            rotate: particle.rotation + 720,
            opacity: [1, 1, 0]
          }}
          transition={{
            duration: 2,
            delay: particle.delay,
            ease: 'easeOut'
          }}
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            backgroundColor: particle.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px'
          }}
        />
      ))}
    </Container>
  )
}

const Container = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1200;
  overflow: hidden;
`

export default Confetti
