import type { FC } from 'react'
import { memo, useMemo } from 'react'

interface HighlightTextProps {
  text: string
  keyword: string
  caseSensitive?: boolean
  className?: string
}

/**
 * Text highlighting component that marks keyword matches
 */
const HighlightText: FC<HighlightTextProps> = ({ text, keyword, caseSensitive = false, className }) => {
  const highlightedText = useMemo(() => {
    if (!keyword || !text) {
      return <span>{text}</span>
    }

    // Escape regex special characters
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const flags = caseSensitive ? 'g' : 'gi'
    const regex = new RegExp(`(${escapedKeyword})`, flags)

    // Split text by keyword matches
    const parts = text.split(regex)

    return (
      <>
        {parts.map((part, index) => {
          // Check if part matches keyword
          const isMatch = regex.test(part)
          regex.lastIndex = 0 // Reset regex state

          if (isMatch) {
            return <mark key={index}>{part}</mark>
          }
          return <span key={index}>{part}</span>
        })}
      </>
    )
  }, [text, keyword, caseSensitive])

  const combinedClassName = className ? `ant-typography ${className}` : 'ant-typography'

  return <span className={combinedClassName}>{highlightedText}</span>
}

export default memo(HighlightText)
