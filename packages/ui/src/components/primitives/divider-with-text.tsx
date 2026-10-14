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
    <div className={`my-0 flex items-center ${className}`} style={style}>
      <span className="mr-2 text-xs text-gray-600 dark:text-gray-400">{text}</span>
      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

export default DividerWithText
