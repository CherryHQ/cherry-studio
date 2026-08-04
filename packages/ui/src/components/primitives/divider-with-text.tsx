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
      <span className="mr-2 text-xs text-muted-foreground">{text}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

export default DividerWithText
