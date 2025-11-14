// Original: src/renderer/src/components/IndicatorLight.tsx
import React from 'react'

interface IndicatorLightProps {
  color: string
  size?: number
  shadow?: boolean
  style?: React.CSSProperties
  animation?: boolean
  className?: string
}

const IndicatorLight: React.FC<IndicatorLightProps> = ({
  color,
  size = 8,
  shadow = true,
  style,
  animation = true,
  className = ''
}) => {
  const actualColor = color === 'green' ? '#22c55e' : color

  return (
    <div
      className={`rounded-full ${animation ? 'animate-pulse' : ''} ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: actualColor,
        boxShadow: shadow ? `0 0 6px ${actualColor}` : 'none',
        ...style
      }}
    />
  )
}

export default IndicatorLight
