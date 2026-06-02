import { AccordionTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import type { BaseNavigatorSectionTriggerProps } from './types'

const BaseNavigatorSectionTrigger = ({
  label,
  itemCount,
  leadingSlot,
  actionSlot,
  onContextMenu
}: BaseNavigatorSectionTriggerProps) => {
  return (
    <div
      className="group/grp flex h-8 w-full items-center gap-1 rounded-[10px] px-2 text-sm transition-colors hover:bg-accent/60"
      onContextMenu={onContextMenu}>
      <div className="min-w-0 flex-1">
        <AccordionTrigger
          className={cn(
            'min-w-0 justify-start gap-1.5 rounded-md py-0 text-left font-normal text-foreground-secondary leading-none hover:no-underline focus-visible:ring-0 focus-visible:ring-offset-0',
            '[&[data-state=closed]>svg]:-rotate-90 [&[data-state=open]>svg]:rotate-0',
            '[&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-foreground-muted',
            'motion-safe:[&>svg]:duration-[150ms] motion-safe:[&>svg]:ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:[&>svg]:transition-none'
          )}>
          <div className="flex min-w-0 items-center gap-1.5">
            {leadingSlot}
            <span className="min-w-0 truncate">{label}</span>
            <span className="shrink-0 text-foreground-muted tabular-nums leading-none">{itemCount}</span>
          </div>
        </AccordionTrigger>
      </div>

      {actionSlot ? <div className="ml-0.5 flex size-6 shrink-0 items-center justify-center">{actionSlot}</div> : null}
    </div>
  )
}

export default BaseNavigatorSectionTrigger
