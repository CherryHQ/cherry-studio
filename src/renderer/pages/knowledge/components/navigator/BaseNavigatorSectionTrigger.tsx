import { AccordionTrigger, HStack } from '@cherrystudio/ui'
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
    <HStack
      gap={1}
      className="group/grp h-8 w-full rounded-[10px] px-2 text-sm transition-colors hover:bg-accent/60"
      onContextMenu={onContextMenu}>
      <div className="min-w-0 flex-1">
        <AccordionTrigger
          className={cn(
            'min-w-0 justify-start gap-1.5 rounded-md py-0 text-left font-normal text-foreground-secondary leading-none hover:no-underline focus-visible:ring-0 focus-visible:ring-offset-0',
            '[&[data-state=closed]>svg]:-rotate-90 [&[data-state=open]>svg]:rotate-0',
            '[&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-foreground-muted',
            'motion-safe:[&>svg]:duration-[150ms] motion-safe:[&>svg]:ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:[&>svg]:transition-none'
          )}>
          <HStack gap={1} className="min-w-0">
            {leadingSlot}
            <span className="min-w-0 truncate">{label}</span>
            <span className="shrink-0 text-foreground-muted tabular-nums leading-none">{itemCount}</span>
          </HStack>
        </AccordionTrigger>
      </div>

      {actionSlot ? <div className="ml-0.5 flex size-6 shrink-0 items-center justify-center">{actionSlot}</div> : null}
    </HStack>
  )
}

export default BaseNavigatorSectionTrigger
