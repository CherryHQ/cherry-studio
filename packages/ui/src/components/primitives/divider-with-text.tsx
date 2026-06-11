// Original: src/renderer/components/DividerWithText.tsx
import type { CSSProperties } from 'react'
import React from 'react'

interface DividerWithTextProps {
  text: string
  style?: CSSProperties
  className?: string
}

const DividerWithText: React.FC<DividerWithTextProps> = ({ text, style, className = '' }) => {
  return (
    <div className={`flex items-center my-0 ${className}`} style={style}>
      <span className="text-xs text-muted-foreground mr-2">{text}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

export default DividerWithText
