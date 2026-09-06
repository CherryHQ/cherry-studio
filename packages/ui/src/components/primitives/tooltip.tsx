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

/** Close-after 挂载窗口，与退出动画时长一致：Radix Presence 靠 animationend 卸载，布局重排可能吞掉该事件
 * 导致 content 永久残留，这里把卸载交给确定性 timer，动画只是视觉表现。 */
export const TOOLTIP_EXIT_ANIMATION_MS = 150

function useTooltipUnmountDelay(open: boolean): boolean {
  const [visible, setVisible] = React.useState(open)
  React.useEffect(() => {
    if (open) {
      setVisible(true)
      return
    }
    const timer = window.setTimeout(() => setVisible(false), TOOLTIP_EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [open])
  return visible
}

/** 清扫延迟 = 退出动画窗口 + 余量：先让其他实例的退出动画走完，再移除 closed 残骸。 */
const TOOLTIP_SWEEP_DELAY_MS = TOOLTIP_EXIT_ANIMATION_MS + 50

/**
 * 受控 + 挂载生命周期：受控（controlledOpen 非空）时外部权威、内部状态不参与；
 * 非受控时内部状态跟随 Radix 开关。`Tooltip` 与 `TooltipRoot` 共用，避免两路漂移。
 */
function useTooltipController(
  controlledOpen: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
  defaultOpen = false,
  sweepContainer?: Element | DocumentFragment | null
) {
  const [innerOpen, setInnerOpen] = React.useState(controlledOpen ?? defaultOpen)
  const defaultPortalContainer = usePortalContainer()
  const effectiveOpen = controlledOpen != null ? controlledOpen : innerOpen
  const contentVisible = useTooltipUnmountDelay(effectiveOpen)
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (controlledOpen == null) setInnerOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )
  const sweepTarget = sweepContainer ?? defaultPortalContainer ?? document.body
  React.useEffect(() => {
    if (contentVisible) return
    const timer = window.setTimeout(() => {
      // 清扫失去 React owner 的 closed 残骸；延迟到自身退出窗口之外，避免误删仍在淡出的 peer
      sweepTarget
        .querySelectorAll?.('[data-slot="tooltip-content"][data-state="closed"]')
        .forEach((node) => node.remove())
    }, TOOLTIP_SWEEP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [contentVisible, sweepTarget])
  return { contentVisible, effectiveOpen, handleOpenChange }
}

/** 由 TooltipRoot 提供，让低层 TooltipContent 走同一套挂载接管；无 Provider 时保持原行为。 */
const TooltipOverlayContext = React.createContext<boolean | null>(null)

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

function TooltipRoot({ delayDuration = 0, open: openProp, defaultOpen, onOpenChange, ...props }: TooltipRootProps) {
  const { contentVisible, effectiveOpen, handleOpenChange } = useTooltipController(openProp, onOpenChange, defaultOpen)
  return (
    <TooltipOverlayContext value={contentVisible}>
      <TooltipProvider delayDuration={delayDuration}>
        <RadixRoot
          data-slot="tooltip"
          delayDuration={delayDuration}
          open={effectiveOpen}
          onOpenChange={handleOpenChange}
          {...props}
        />
      </TooltipProvider>
    </TooltipOverlayContext>
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
  'z-[80] w-fit max-w-80 origin-(--radix-tooltip-content-transform-origin) rounded-md bg-neutral-900 px-3 py-1.5 text-neutral-50 text-xs leading-relaxed whitespace-normal break-words data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 dark:bg-neutral-100 dark:text-neutral-900 [-webkit-app-region:no-drag]'

const arrowStyles =
  'z-[80] -translate-y-px fill-neutral-900 stroke-neutral-900 stroke-2 dark:fill-neutral-100 dark:stroke-neutral-100 [paint-order:stroke_fill]'

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  portalContainer,
  showArrow = true,
  ...props
}: TooltipContentProps) {
  const defaultPortalContainer = usePortalContainer()
  const contentVisible = React.use(TooltipOverlayContext)
  if (contentVisible === false) return null
  const container = portalContainer ?? defaultPortalContainer ?? undefined
  const arrow = showArrow ? <RadixArrow width={12} height={6} className={arrowStyles} /> : null
  // 有 overlay context（TooltipRoot 组合）时挂载由门控接管：forceMount + 150ms 退出窗口；
  // 独立使用保持 Radix 原生 presence 卸载。
  if (contentVisible !== null) {
    return (
      <RadixPortal container={container} forceMount>
        <RadixContent
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          forceMount
          className={cn(contentStyles, className)}
          {...props}>
          {children}
          {arrow}
        </RadixContent>
      </RadixPortal>
    )
  }
  return (
    <RadixPortal container={container}>
      <RadixContent
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(contentStyles, className)}
        {...props}>
        {children}
        {arrow}
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
  /** Let the child own the trigger element and its semantics. */
  asChild?: boolean
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
  portalContainer,
  asChild = false
}: TooltipProps) => {
  const tooltipContent = content ?? title
  const defaultPortalContainer = usePortalContainer()
  const { contentVisible, effectiveOpen, handleOpenChange } = useTooltipController(
    isOpen,
    onOpenChange,
    false,
    portalContainer
  )
  const triggerWrapperClassName = cn(
    'relative z-10',
    fullWidthTrigger ? 'block w-full min-w-0 max-w-full' : 'inline-block',
    classNames?.placeholder
  )

  if (!tooltipContent || isDisabled) {
    if (asChild) return children

    return (
      <div className={triggerWrapperClassName} onClick={onClick}>
        {children}
      </div>
    )
  }

  const { side, align } = parsePlacement(placement)

  return (
    <TooltipProvider delayDuration={delay}>
      <RadixRoot delayDuration={delay} open={effectiveOpen} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          {asChild ? (
            children
          ) : (
            <div className={triggerWrapperClassName} onClick={onClick}>
              {children}
            </div>
          )}
        </TooltipTrigger>
        {contentVisible && (
          <RadixPortal container={portalContainer ?? defaultPortalContainer ?? undefined} forceMount>
            <RadixContent
              data-slot="tooltip-content"
              forceMount
              side={side}
              align={align}
              sideOffset={sideOffset}
              className={cn(contentStyles, classNames?.content, className)}>
              {tooltipContent}
              {showArrow && <RadixArrow width={12} height={6} className={arrowStyles} />}
            </RadixContent>
          </RadixPortal>
        )}
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
