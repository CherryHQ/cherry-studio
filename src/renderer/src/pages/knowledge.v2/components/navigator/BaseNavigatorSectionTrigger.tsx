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
      className="group/grp flex w-full items-center gap-1.5 px-1.5 py-1 text-foreground/45 text-xs transition-colors hover:text-foreground/60"
      onContextMenu={onContextMenu}>
      <div className="min-w-0 flex-1">
        <AccordionTrigger
          className={cn(
            'justify-end gap-1.5 rounded-none py-0 font-normal text-inherit text-xs leading-none hover:no-underline focus-visible:ring-0 focus-visible:ring-offset-0',
            '[&[data-state=closed]>svg]:-rotate-90 [&[data-state=open]>svg]:rotate-0',
            '[&>svg]:size-2.5 [&>svg]:shrink-0 [&>svg]:text-inherit',
            'flex-row-reverse'
          )}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {leadingSlot}
            <span className="truncate font-medium tracking-widest">{label}</span>
          </div>
        </AccordionTrigger>
      </div>

      <span className="shrink-0 text-muted-foreground/40 text-xs">{itemCount}</span>
      {actionSlot}
    </div>
  )
}

export default BaseNavigatorSectionTrigger
