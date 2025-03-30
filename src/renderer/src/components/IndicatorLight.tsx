// src/renderer/src/components/IndicatorLight.tsx
import React from 'react'
import styled from 'styled-components'

interface IndicatorLightProps {
  color: string
  size?: number
  shadow?: boolean
  style?: React.CSSProperties
  animation?: boolean
}

const Light = styled.div<{
  color: string
  size: number
  shadow?: boolean
  style?: React.CSSProperties
  animation?: boolean
}>`
  width: ${({ size }) => size}px;
  height: ${({ size }) => size}px;
  border-radius: 50%;
  background-color: ${({ color }) => color};
  box-shadow: ${({ shadow, color }) => (shadow ? `0 0 6px ${color}` : 'none')};
  animation: ${({ animation }) => (animation ? 'pulse 2s infinite' : 'none')};

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
    100% {
      opacity: 1;
    }
  }
`

const IndicatorLight: React.FC<IndicatorLightProps> = ({ color, size = 8, shadow = true, style, animation = true }) => {
  const actualColor = color === 'green' ? '#22c55e' : color
  return <Light color={actualColor} size={size} shadow={shadow} style={style} animation={animation} />
}

export default IndicatorLight
