import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

type ScrollAreaProps = React.ComponentProps<'div'> & {
  rootClassName?: string
}

/** The ref and div props target the native scroll viewport. */
function ScrollArea({ className, rootClassName, children, ref, ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type="scroll"
      scrollHideDelay={1200}
      className={cn('relative min-h-0 min-w-0 flex-1', rootClassName)}>
      <ScrollAreaPrimitive.Viewport
        {...props}
        data-slot="scroll-area-viewport"
        ref={ref}
        className={cn('size-full [scrollbar-gutter:auto]!', className)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        orientation="vertical"
        className="group/scrollbar flex w-3 touch-none py-0.5 pr-0.5 duration-200 select-none data-[state=hidden]:animate-out data-[state=hidden]:fade-out-0 motion-reduce:animate-none">
        <ScrollAreaPrimitive.Thumb
          data-slot="scroll-area-thumb"
          className="relative flex-1 rounded-full border-x-[3px] border-transparent bg-[var(--scrollbar-thumb)] bg-clip-padding transition-[border-width,background-color] duration-150 group-hover/scrollbar:border-x-0 group-hover/scrollbar:bg-[var(--scrollbar-thumb-hover)] motion-reduce:transition-none"
        />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}

export { ScrollArea }
