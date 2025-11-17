// Original: src/renderer/src/components/ExpandableText.tsx
import { Button } from '@heroui/react'
import { memo, useCallback, useState } from 'react'

interface ExpandableTextProps {
  text: string
  style?: React.CSSProperties
  className?: string
  expandText?: string
  collapseText?: string
  lineClamp?: number
  ref?: React.RefObject<HTMLDivElement>
}

const ExpandableText = ({
  text,
  style,
  className = '',
  expandText = 'Expand',
  collapseText = 'Collapse',
  lineClamp = 1,
  ref
}: ExpandableTextProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return (
    <div
      ref={ref}
      className={`flex ${isExpanded ? 'flex-col' : 'flex-row items-center'} gap-2 ${className}`}
      style={style}>
      <div
        className={`overflow-hidden ${
          isExpanded ? '' : lineClamp === 1 ? 'text-ellipsis whitespace-nowrap' : `line-clamp-${lineClamp}`
        } ${isExpanded ? '' : 'flex-1'}`}>
        {text}
      </div>
      <Button size="sm" variant="light" color="primary" onClick={toggleExpand} className="min-w-fit px-2">
        {isExpanded ? collapseText : expandText}
      </Button>
    </div>
  )
}

ExpandableText.displayName = 'ExpandableText'

export default memo(ExpandableText)
