import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  isActive: boolean
  type: 'input' | 'output'
}

const VoiceVisualizer: React.FC<Props> = ({ isActive, type }) => {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    const drawVisualizer = () => {
      ctx.clearRect(0, 0, width, height)

      if (!isActive) {
        // 绘制静态波形
        ctx.beginPath()
        ctx.moveTo(0, height / 2)
        ctx.lineTo(width, height / 2)
        ctx.strokeStyle = type === 'input' ? 'var(--color-text-2)' : 'var(--color-primary)'
        ctx.lineWidth = 2
        ctx.stroke()
        return
      }

      // 绘制动态波形
      const barCount = 30
      const barWidth = width / barCount
      const color = type === 'input' ? 'var(--color-text-1)' : 'var(--color-primary)'

      for (let i = 0; i < barCount; i++) {
        const barHeight = Math.random() * (height / 2) + 10
        const x = i * barWidth
        const y = height / 2 - barHeight / 2

        ctx.fillStyle = color
        ctx.fillRect(x, y, barWidth - 2, barHeight)
      }

      animationRef.current = requestAnimationFrame(drawVisualizer)
    }

    drawVisualizer()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isActive, type])

  return (
    <Container $type={type}>
      <Label>{type === 'input' ? t('voice_call.you') : t('voice_call.ai')}</Label>
      <Canvas ref={canvasRef} width={200} height={50} />
    </Container>
  )
}

const Container = styled.div<{ $type: 'input' | 'output' }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 45%;
  border-radius: 8px;
  padding: 10px;
  background-color: ${(props) => (props.$type === 'input' ? 'var(--color-background-3)' : 'var(--color-primary-bg)')};
`

const Label = styled.div`
  margin-bottom: 8px;
  font-weight: bold;
`

const Canvas = styled.canvas`
  width: 100%;
  height: 50px;
`

export default VoiceVisualizer
