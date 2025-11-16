// Original: src/renderer/src/components/DividerWithText.tsx
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
      <span className="text-xs text-gray-600 dark:text-gray-400 mr-2">{text}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

export default DividerWithText
