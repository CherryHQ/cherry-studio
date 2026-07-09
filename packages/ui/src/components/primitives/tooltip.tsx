import { cn } from '@cherrystudio/ui/lib/utils'
import {
  Content as RadixContent,
  Portal as RadixPortal,
  Provider as RadixProvider,
  Root as RadixRoot,
  Trigger as RadixTrigger
} from '@radix-ui/react-tooltip'
import * as React from 'react'

import { usePortalContainer } from './portal-container'

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

export type TooltipProviderProps = React.ComponentProps<typeof RadixProvider>
export type TooltipRootProps = React.ComponentProps<typeof RadixRoot>
export type TooltipTriggerProps = React.ComponentProps<typeof RadixTrigger>
export type TooltipContentProps = React.ComponentProps<typeof RadixContent> & {
  portalContainer?: React.ComponentProps<typeof RadixPortal>['container']
  showArrow?: boolean
}

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

function TooltipTrigger({ onFocus, ...props }: TooltipTriggerProps) {
  return (
    <RadixTrigger
      data-slot="tooltip-trigger"
      onFocus={(e) => {
        onFocus?.(e)
        // Radix composeEventHandlers respects defaultPrevented
        if (!e.defaultPrevented && !e.target.matches(':focus-visible')) {
          e.preventDefault()
        }
      }}
      {...props}
    />
  )
}

const contentStyles =
  'z-[80] w-fit max-w-80 origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-neutral-900 px-3 py-1.5 text-neutral-50 text-xs leading-relaxed whitespace-normal break-words fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'

const arrowContentStyles =
  "relative before:pointer-events-none before:absolute before:size-2 before:rotate-45 before:rounded-[1px] before:bg-neutral-900 before:content-[''] data-[side=bottom]:before:-top-1 data-[side=bottom]:before:left-1/2 data-[side=bottom]:before:-translate-x-1/2 data-[side=bottom]:data-[align=start]:before:left-3 data-[side=bottom]:data-[align=start]:before:translate-x-0 data-[side=bottom]:data-[align=end]:before:right-3 data-[side=bottom]:data-[align=end]:before:left-auto data-[side=bottom]:data-[align=end]:before:translate-x-0 data-[side=top]:before:-bottom-1 data-[side=top]:before:left-1/2 data-[side=top]:before:-translate-x-1/2 data-[side=top]:data-[align=start]:before:left-3 data-[side=top]:data-[align=start]:before:translate-x-0 data-[side=top]:data-[align=end]:before:right-3 data-[side=top]:data-[align=end]:before:left-auto data-[side=top]:data-[align=end]:before:translate-x-0 data-[side=left]:before:-right-1 data-[side=left]:before:top-1/2 data-[side=left]:before:-translate-y-1/2 data-[side=left]:data-[align=start]:before:top-3 data-[side=left]:data-[align=start]:before:translate-y-0 data-[side=left]:data-[align=end]:before:top-auto data-[side=left]:data-[align=end]:before:bottom-3 data-[side=left]:data-[align=end]:before:translate-y-0 data-[side=right]:before:-left-1 data-[side=right]:before:top-1/2 data-[side=right]:before:-translate-y-1/2 data-[side=right]:data-[align=start]:before:top-3 data-[side=right]:data-[align=start]:before:translate-y-0 data-[side=right]:data-[align=end]:before:top-auto data-[side=right]:data-[align=end]:before:bottom-3 data-[side=right]:data-[align=end]:before:translate-y-0"

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  portalContainer,
  showArrow = true,
  ...props
}: TooltipContentProps) {
  const defaultPortalContainer = usePortalContainer()
  return (
    <RadixPortal container={portalContainer ?? defaultPortalContainer ?? undefined}>
      <RadixContent
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(contentStyles, showArrow && arrowContentStyles, className)}
        {...props}>
        {children}
      </RadixContent>
    </RadixPortal>
  )
}

export interface TooltipProps {
  children?: React.ReactNode
  content?: React.ReactNode
  title?: React.ReactNode
  placement?: string
  delay?: number
  sideOffset?: TooltipContentProps['sideOffset']
  showArrow?: boolean
  fullWidthTrigger?: boolean
  classNames?: {
    content?: string
    placeholder?: string
  }
  className?: string
  isDisabled?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
  portalContainer?: React.ComponentProps<typeof RadixPortal>['container']
}

export const Tooltip = ({
  children,
  content,
  title,
  placement,
  delay = 0,
  sideOffset = 0,
  showArrow = true,
  fullWidthTrigger = false,
  classNames,
  className,
  isDisabled,
  isOpen,
  onOpenChange,
  onClick,
  portalContainer
}: TooltipProps) => {
  const tooltipContent = content ?? title
  const defaultPortalContainer = usePortalContainer()
  const triggerWrapperClassName = cn(
    'relative z-10',
    fullWidthTrigger ? 'block w-full min-w-0 max-w-full' : 'inline-block',
    classNames?.placeholder
  )

  if (!tooltipContent || isDisabled) {
    return (
      <div className={triggerWrapperClassName} onClick={onClick}>
        {children}
      </div>
    )
  }

  const { side, align } = parsePlacement(placement)

  const controlledProps: Partial<TooltipRootProps> = {}
  if (isOpen != null) {
    controlledProps.open = isOpen
    controlledProps.onOpenChange = onOpenChange
  } else if (onOpenChange) {
    controlledProps.onOpenChange = onOpenChange
  }

  return (
    <TooltipProvider delayDuration={delay}>
      <RadixRoot delayDuration={delay} {...controlledProps}>
        <TooltipTrigger asChild>
          <div className={triggerWrapperClassName} onClick={onClick}>
            {children}
          </div>
        </TooltipTrigger>
        <RadixPortal container={portalContainer ?? defaultPortalContainer ?? undefined}>
          <RadixContent
            data-slot="tooltip-content"
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(contentStyles, showArrow && arrowContentStyles, classNames?.content, className)}>
            {tooltipContent}
          </RadixContent>
        </RadixPortal>
      </RadixRoot>
    </TooltipProvider>
  )
}

interface NormalTooltipProps extends TooltipRootProps {
  content: React.ReactNode
  side?: TooltipContentProps['side']
  align?: TooltipContentProps['align']
  sideOffset?: TooltipContentProps['sideOffset']
  className?: string
  asChild?: boolean
  triggerProps?: Omit<TooltipTriggerProps, 'children'>
  contentProps?: TooltipContentProps
  showArrow?: boolean
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
  showArrow = true,
  ...tooltipProps
}: NormalTooltipProps) => {
  return (
    <TooltipRoot {...tooltipProps}>
      <TooltipTrigger asChild={asChild} {...triggerProps}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} showArrow={showArrow} {...contentProps}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  )
}

export { NormalTooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger }
