import {
  Arrow as RadixArrow,
  Content as RadixContent,
  Portal as RadixPortal,
  Provider as RadixProvider,
  Root as RadixRoot,
  Trigger as RadixTrigger
} from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '../../lib/utils'

type Side = 'top' | 'bottom' | 'left' | 'right'
type Align = 'start' | 'center' | 'end'

function parsePlacement(placement?: string): { side: Side; align: Align } {
  const mapping: Record<string, { side: Side; align: Align }> = {
    top: { side: 'top', align: 'center' },
    'top-start': { side: 'top', align: 'start' },
    'top-end': { side: 'top', align: 'end' },
    bottom: { side: 'bottom', align: 'center' },
    'bottom-start': { side: 'bottom', align: 'start' },
    'bottom-end': { side: 'bottom', align: 'end' },
    bottomRight: { side: 'bottom', align: 'end' },
    left: { side: 'left', align: 'center' },
    'left-start': { side: 'left', align: 'start' },
    'left-end': { side: 'left', align: 'end' },
    right: { side: 'right', align: 'center' },
    'right-start': { side: 'right', align: 'start' },
    'right-end': { side: 'right', align: 'end' }
  }
  return mapping[placement ?? 'top'] ?? { side: 'top', align: 'center' }
}

// --- Compound component exports (for advanced usage) ---

export type TooltipProviderProps = React.ComponentProps<typeof RadixProvider>
export type TooltipRootProps = React.ComponentProps<typeof RadixRoot>
export type TooltipTriggerProps = React.ComponentProps<typeof RadixTrigger>
export type TooltipContentProps = React.ComponentProps<typeof RadixContent>

function TooltipProvider({ delayDuration = 0, ...props }: TooltipProviderProps) {
  return <RadixProvider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function TooltipRoot({ delayDuration = 0, ...props }: TooltipRootProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <RadixRoot data-slot="tooltip" delayDuration={delayDuration} {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: TooltipTriggerProps) {
  return <RadixTrigger data-slot="tooltip-trigger" {...props} />
}

const contentStyles =
  'z-50 max-w-60 rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[0px_6px_12px_0px_rgba(0,0,0,0.2)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'

function TooltipContent({ className, sideOffset = 4, children, ...props }: TooltipContentProps) {
  return (
    <RadixPortal>
      <RadixContent
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(contentStyles, className)}
        {...props}>
        {children}
        <RadixArrow className="fill-background [&>path:first-child]:fill-border" />
      </RadixContent>
    </RadixPortal>
  )
}

// --- Backward-compatible flat API (drop-in replacement for HeroUI Tooltip) ---

export interface TooltipProps {
  children?: React.ReactNode
  content?: React.ReactNode
  title?: React.ReactNode
  placement?: string
  delay?: number
  closeDelay?: number
  showArrow?: boolean
  classNames?: {
    content?: string
    placeholder?: string
  }
  className?: string
  isDisabled?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

export const Tooltip = ({
  children,
  content,
  title,
  placement,
  delay = 0,
  closeDelay,
  showArrow = true,
  classNames,
  className,
  isDisabled,
  isOpen,
  onOpenChange,
  onClick
}: TooltipProps) => {
  const [open, setOpen] = React.useState(false)

  const tooltipContent = content ?? title
  if (!tooltipContent || isDisabled) {
    return (
      <div className={cn('relative z-10 inline-block', classNames?.placeholder)} onClick={onClick}>
        {children}
      </div>
    )
  }

  const { side, align } = parsePlacement(placement)

  const useControlledClose = closeDelay != null && closeDelay > 0
  const useControlledOpen = isOpen != null

  const handleOpenChange = useControlledClose
    ? (nextOpen: boolean) => {
        if (nextOpen) {
          setOpen(true)
        } else {
          setTimeout(() => setOpen(false), closeDelay)
        }
      }
    : undefined

  const controlledProps: Partial<React.ComponentProps<typeof RadixRoot>> = {}
  if (useControlledOpen) {
    controlledProps.open = isOpen
    if (onOpenChange) controlledProps.onOpenChange = onOpenChange
  } else if (useControlledClose) {
    controlledProps.open = open
    controlledProps.onOpenChange = handleOpenChange
  }

  return (
    <RadixProvider delayDuration={delay}>
      <RadixRoot delayDuration={delay} {...controlledProps}>
        <RadixTrigger asChild>
          <div className={cn('relative z-10 inline-block', classNames?.placeholder)} onClick={onClick}>
            {children}
          </div>
        </RadixTrigger>
        <RadixPortal>
          <RadixContent
            data-slot="tooltip-content"
            side={side}
            align={align}
            sideOffset={4}
            className={cn(contentStyles, classNames?.content, className)}>
            {tooltipContent}
            {showArrow && <RadixArrow className="fill-background [&>path:first-child]:fill-border" />}
          </RadixContent>
        </RadixPortal>
      </RadixRoot>
    </RadixProvider>
  )
}

// --- NormalTooltip (convenience wrapper using compound components) ---

interface NormalTooltipProps extends TooltipRootProps {
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
    <TooltipRoot {...tooltipProps}>
      <TooltipTrigger asChild={asChild} {...triggerProps}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} {...contentProps}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  )
}

export { NormalTooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger }
