// src/renderer/src/components/IndicatorLight.tsx
import React from 'react'

interface IndicatorLightProps {
  color: string
  size?: number
  shadow?: boolean
  style?: React.CSSProperties
  animation?: boolean
}

const IndicatorLight: React.FC<IndicatorLightProps> = ({ color, size = 8, shadow = true, style, animation = true }) => {
  const actualColor = color === 'green' ? '#22c55e' : color
  return (
    <div
      className="rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: actualColor,
        boxShadow: shadow ? `0 0 6px ${actualColor}` : 'none',
        animation: animation ? 'pulse 2s infinite' : 'none',
        ...style
      }}
    />
  )
}

export default IndicatorLight
