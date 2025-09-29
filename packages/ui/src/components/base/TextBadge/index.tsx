// Original: src/renderer/src/components/TextBadge.tsx
import type { FC } from 'react'

interface TextBadgeProps {
  text: string
  style?: React.CSSProperties
  className?: string
}

const TextBadge: FC<TextBadgeProps> = ({ text, style, className = '' }) => {
  return (
    <span
      className={`text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded font-medium ${className}`}
      style={style}>
      {text}
    </span>
  )
}

export default TextBadge
