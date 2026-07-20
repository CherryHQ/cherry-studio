import { GripVertical } from 'lucide-react'
import * as React from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '../../lib/utils'

type PrimitiveGroupProps = React.ComponentProps<typeof ResizablePrimitive.Group>
type PrimitivePanelProps = React.ComponentProps<typeof ResizablePrimitive.Panel>
type PrimitiveSeparatorProps = React.ComponentProps<typeof ResizablePrimitive.Separator>

type ResizablePanelGroupProps = Partial<
  Pick<
    PrimitiveGroupProps,
    'children' | 'className' | 'defaultLayout' | 'disabled' | 'id' | 'onLayoutChange' | 'onLayoutChanged' | 'style'
  >
> & {
  direction?: PrimitiveGroupProps['orientation']
  onLayout?: PrimitiveGroupProps['onLayoutChanged']
}

type ResizablePanelProps = Partial<
  Pick<
    PrimitivePanelProps,
    | 'children'
    | 'className'
    | 'collapsedSize'
    | 'collapsible'
    | 'defaultSize'
    | 'disabled'
    | 'id'
    | 'maxSize'
    | 'minSize'
    | 'onResize'
    | 'style'
  >
>

type ResizableHandleProps = Partial<
  Pick<PrimitiveSeparatorProps, 'children' | 'className' | 'disabled' | 'id' | 'style'>
> & {
  withHandle?: boolean
}

function ResizablePanelGroup({
  className,
  direction = 'horizontal',
  onLayout,
  onLayoutChanged,
  ...props
}: ResizablePanelGroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      orientation={direction}
      onLayoutChanged={onLayoutChanged ?? onLayout}
      className={cn('h-full w-full', className)}
      {...props}
    />
  )
}

function ResizablePanel(props: ResizablePanelProps) {
  return <ResizablePrimitive.Panel {...props} />
}

function ResizableHandle({ children, className, withHandle, ...props }: ResizableHandleProps) {
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
      {children ??
        (withHandle && (
          <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-background shadow-xs">
            <GripVertical className="size-2.5 text-muted-foreground" />
          </div>
        ))}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
export type { ResizableHandleProps, ResizablePanelGroupProps, ResizablePanelProps }
