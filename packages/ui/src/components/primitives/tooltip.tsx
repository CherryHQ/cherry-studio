import { cn } from '@cherrystudio/ui/lib/utils'
import {
  Arrow as RadixArrow,
  Content as RadixContent,
  Portal as RadixPortal,
  Provider as RadixProvider,
  Root as RadixRoot,
  Trigger as RadixTrigger
} from '@radix-ui/react-tooltip'
import * as React from 'react'

import { type Direction, type LogicalSide, type PhysicalInlineSide, resolveInlineSide, useDirection } from './direction'
import { usePortalContainer } from './portal-container'

type PhysicalSide = 'top' | 'bottom' | PhysicalInlineSide
type TooltipSide = 'top' | 'bottom' | LogicalSide
type Align = 'start' | 'center' | 'end'
type TooltipPlacement =
  | TooltipSide
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'start-start'
  | 'start-end'
  | 'end-start'
  | 'end-end'

const LOGICAL_SIDES = new Set<string>(['top', 'bottom', 'start', 'end'])
const PHYSICAL_SIDES = new Set<string>(['top', 'bottom', 'left', 'right'])
const ALIGNS = new Set<string>(['start', 'center', 'end'])

function resolveSide(side: TooltipSide, direction: Direction): PhysicalSide {
  if (side === 'start' || side === 'end') return resolveInlineSide(side, direction)
  return side
}

/**
 * Placement also reaches this component from untyped call sites. Physical sides still resolve as
 * themselves so pre-logical callers keep rendering where they always did; anything unrecognised
 * falls back to the default rather than reaching Radix as an invalid side.
 */
function parsePlacement(
  placement: TooltipPlacement | undefined,
  direction: Direction
): { side: PhysicalSide; align: Align } {
  const [rawSide, rawAlign] = (placement ?? 'top').split('-')
  const align = rawAlign !== undefined && ALIGNS.has(rawAlign) ? (rawAlign as Align) : 'center'

  if (LOGICAL_SIDES.has(rawSide)) return { side: resolveSide(rawSide as TooltipSide, direction), align }
  if (PHYSICAL_SIDES.has(rawSide)) return { side: rawSide as PhysicalSide, align }
  return { side: 'top', align }
}

export type TooltipProviderProps = React.ComponentProps<typeof RadixProvider>
export type TooltipRootProps = React.ComponentProps<typeof RadixRoot>
export type TooltipTriggerProps = React.ComponentProps<typeof RadixTrigger>
export type TooltipContentProps = Omit<React.ComponentProps<typeof RadixContent>, 'side'> & {
  portalContainer?: React.ComponentProps<typeof RadixPortal>['container']
  showArrow?: boolean
  side?: TooltipSide
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

// no-drag punches the popup's area out of any titlebar drag region it overlaps,
// so hover/click reach the items instead of the window-drag hit test (Electron).
const contentStyles =
  'z-[80] w-fit max-w-80 origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-neutral-900 px-3 py-1.5 text-neutral-50 text-xs leading-relaxed whitespace-normal break-words fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 [-webkit-app-region:no-drag]'

const arrowStyles = 'z-[80] -translate-y-px fill-neutral-900 stroke-neutral-900 stroke-2 [paint-order:stroke_fill]'

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  portalContainer,
  showArrow = true,
  side,
  ...props
}: TooltipContentProps) {
  const defaultPortalContainer = usePortalContainer()
  const direction = useDirection()
  return (
    <RadixPortal container={portalContainer ?? defaultPortalContainer ?? undefined}>
      <RadixContent
        data-slot="tooltip-content"
        side={side === undefined ? undefined : resolveSide(side, direction)}
        sideOffset={sideOffset}
        className={cn(contentStyles, className)}
        {...props}>
        {children}
        {showArrow && <RadixArrow width={12} height={6} className={arrowStyles} />}
      </RadixContent>
    </RadixPortal>
  )
}

export interface TooltipProps {
  children?: React.ReactNode
  content?: React.ReactNode
  title?: React.ReactNode
  placement?: TooltipPlacement
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
  const direction = useDirection()
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

  const { side, align } = parsePlacement(placement, direction)

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
            className={cn(contentStyles, classNames?.content, className)}>
            {tooltipContent}
            {showArrow && <RadixArrow width={12} height={6} className={arrowStyles} />}
          </RadixContent>
        </RadixPortal>
      </RadixRoot>
    </TooltipProvider>
  )
}

interface NormalTooltipProps extends TooltipRootProps {
  content: React.ReactNode
  side?: TooltipSide
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
export type { NormalTooltipProps, TooltipPlacement, TooltipSide }
