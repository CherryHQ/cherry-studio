import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import type { ComponentProps } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  orientation?: 'vertical' | 'horizontal' | 'both'
  viewportProps?: ComponentProps<'div'> & { [key: `data-${string}`]: string | number | boolean | undefined }
  contentProps?: ComponentProps<'div'>
}

function ScrollArea({
  className,
  children,
  hidden,
  type = 'scroll',
  scrollHideDelay = 1500,
  orientation = 'vertical',
  viewportProps,
  contentProps,
  ...props
}: ScrollAreaProps) {
  const axes = orientation === 'both' ? (['vertical', 'horizontal'] as const) : [orientation]

  return (
    <ScrollAreaPrimitive.Root
      {...props}
      hidden={hidden}
      data-slot="scroll-area"
      type={type}
      scrollHideDelay={scrollHideDelay}
      className={cn(
        'relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]',
        className,
        hidden && 'hidden!'
      )}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        {...viewportProps}
        disableImplicitContentElement
        className={cn('min-h-0 min-w-0 [scrollbar-gutter:auto]!', viewportProps?.className)}>
        <ScrollAreaPrimitive.Content
          {...contentProps}
          data-slot="scroll-area-content"
          style={{ display: orientation === 'vertical' ? undefined : 'table', ...contentProps?.style }}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {axes.map((axis) => (
        <ScrollAreaPrimitive.Scrollbar
          key={axis}
          data-slot="scroll-area-scrollbar"
          orientation={axis}
          className={cn(
            'group/scrollbar z-10 flex touch-none duration-200 select-none data-[state=hidden]:animate-out data-[state=hidden]:fade-out-0 motion-reduce:animate-none',
            axis === 'vertical' ? 'w-3 py-0.5 pr-0.5' : 'h-3 flex-col px-0.5 pb-0.5'
          )}>
          <ScrollAreaPrimitive.Thumb
            data-slot="scroll-area-thumb"
            className={cn(
              'relative flex-1 rounded-full border-solid border-transparent bg-[var(--scrollbar-thumb,color-mix(in_srgb,var(--foreground)_15%,transparent))] bg-clip-padding transition-[border-width,background-color] duration-150 group-hover/scrollbar:bg-[var(--scrollbar-thumb-hover,color-mix(in_srgb,var(--foreground)_20%,transparent))] motion-reduce:transition-none',
              axis === 'vertical'
                ? 'border-x-[3px] group-hover/scrollbar:border-x-0'
                : 'border-y-[3px] group-hover/scrollbar:border-y-0'
            )}
          />
        </ScrollAreaPrimitive.Scrollbar>
      ))}
      {orientation === 'both' && <ScrollAreaPrimitive.Corner />}
    </ScrollAreaPrimitive.Root>
  )
}

export { ScrollArea }
