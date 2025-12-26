import { cn } from '@cherrystudio/ui/utils/index'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

export type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root>
export type TooltipTriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger>
export type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content>

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  // eslint-disable-next-line
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ delayDuration = 0, ...props }: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipPrimitive.Root data-slot="tooltip" delayDuration={delayDuration} {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({ className, sideOffset = 0, children, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className
        )}
        {...props}>
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

interface NormalTooltipProps extends TooltipProps {
  content: React.ReactNode
  side?: TooltipContentProps['side']
  align?: TooltipContentProps['align']
  sideOffset?: TooltipContentProps['sideOffset']
  className?: string
  asChild?: boolean
  triggerProps?: Omit<TooltipTriggerProps, 'children'>
  contentProps?: TooltipContentProps
}

const NormalTooltip = ({
  children,
  content,
  side,
  align,
  sideOffset,
  asChild = true,
  triggerProps,
  contentProps,
  ...tooltipProps
}: NormalTooltipProps) => {
  return (
    <Tooltip {...tooltipProps}>
      <TooltipTrigger asChild={asChild} {...triggerProps}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} {...contentProps}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export { NormalTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
