import { GripVertical } from 'lucide-react'
import * as React from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '../../lib/utils'

type ResizablePanelGroupProps = React.ComponentProps<typeof ResizablePrimitive.Group> & {
  direction?: 'horizontal' | 'vertical'
}

function ResizablePanelGroup({ className, direction, orientation, ...props }: ResizablePanelGroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      orientation={orientation ?? direction ?? 'horizontal'}
      className={cn('h-full w-full', className)}
      {...props}
    />
  )
}

const ResizablePanel = ResizablePrimitive.Panel

type ResizableHandleProps = React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}

function ResizableHandle({ className, withHandle, ...props }: ResizableHandleProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'group relative flex h-full w-px shrink-0 items-center justify-center bg-border transition-colors',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2',
        'hover:bg-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'data-[separator=active]:bg-primary/50 data-[separator=focus]:bg-border-strong',
        'aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full',
        'aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2',
        'aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full',
        'aria-[orientation=horizontal]:after:-translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2',
        '[&[aria-orientation=horizontal]>div]:rotate-90',
        className
      )}
      {...props}>
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-background shadow-xs">
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
export type { ResizableHandleProps, ResizablePanelGroupProps }
