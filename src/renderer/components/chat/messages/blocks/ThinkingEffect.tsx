import { cn } from '@cherrystudio/ui/lib/utils'
import React from 'react'

interface Props {
  thinkingTimeText: React.ReactNode
  /** Optional node rendered between the title text and the chevron (used for the copy button). */
  trailing?: React.ReactNode
}

const ThinkingEffect: React.FC<Props> = ({ thinkingTimeText, trailing }) => {
  return (
    <div
      className={cn(
        'pointer-events-none relative flex min-h-7 w-full select-none items-center gap-1 overflow-hidden rounded-lg py-0.5 text-[13px] text-foreground-secondary'
      )}>
      <div className="flex min-w-0 items-center">
        <div className="truncate font-normal text-[13px] text-foreground-secondary leading-5">{thinkingTimeText}</div>
      </div>
      {trailing}
    </div>
  )
}

export default ThinkingEffect
