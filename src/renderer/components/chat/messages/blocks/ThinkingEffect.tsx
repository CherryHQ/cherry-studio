import { ChevronDown } from 'lucide-react'
import React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

interface Props {
  thinkingTimeText: React.ReactNode
  /** Optional node rendered between the title text and the chevron (used for the copy button). */
  trailing?: React.ReactNode
  /** Whether the thinking content panel is currently expanded. Controls chevron orientation. */
  isExpanded?: boolean
}

const ThinkingEffect: React.FC<Props> = ({ thinkingTimeText, trailing, isExpanded = false }) => {
  return (
    <div
      className={cn(
        'pointer-events-none relative flex min-h-7 w-full items-center gap-1 overflow-hidden rounded-lg py-0.5 text-[13px] text-muted-foreground select-none'
      )}>
      <div className="flex shrink-0 items-center">
        <div className="truncate text-[13px] leading-5 font-normal text-muted-foreground">{thinkingTimeText}</div>
      </div>
      {trailing}
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'ml-auto size-3.5 shrink-0 opacity-60 transition-[transform,opacity] motion-reduce:transition-none group-hover/thought:opacity-100',
          isExpanded && 'rotate-180'
        )}
      />
    </div>
  )
}

export default ThinkingEffect
