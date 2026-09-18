import React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

interface Props {
  thinkingTimeText: React.ReactNode
  /** Optional node rendered between the title text and the chevron (used for the copy button). */
  trailing?: React.ReactNode
}

const ThinkingEffect: React.FC<Props> = ({ thinkingTimeText, trailing }) => {
  return (
    <div
      className={cn(
        'pointer-events-none relative flex min-h-7 w-full items-center gap-1 overflow-hidden rounded-lg py-0.5 text-[13px] text-muted-foreground select-none'
      )}>
      <div className="flex shrink-0 items-center">
        <div className="truncate text-[13px] leading-5 font-normal text-muted-foreground">{thinkingTimeText}</div>
      </div>
      {trailing}
    </div>
  )
}

export default ThinkingEffect
