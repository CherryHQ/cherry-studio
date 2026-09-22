import {
  Arrow as RadixArrow,
  Content as RadixContent,
  Portal as RadixPortal,
  Provider as RadixProvider,
  Root as RadixRoot,
  Trigger as RadixTrigger
} from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

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

/** 清扫延迟 = 退出动画窗口 + 余量：正常实例在退出窗口内自行卸载，此期间不触发清扫。 */
const TOOLTIP_SWEEP_DELAY_MS = TOOLTIP_EXIT_ANIMATION_MS + 50
/** open 态重检周期：打开的内容无法仅凭 data-state 区分活实例与残骸，需周期性核对 trigger 引用。 */
export const STALE_OPEN_SWEEP_MS = 3000
/** 清扫目标：本组件门控渲染且带清扫标记的内容（原生属性查询，避免逐元素 JS 判定）。 */
const SWEEPABLE_CONTENT_SELECTOR = '[data-slot="tooltip-content"][data-tooltip-sweepable]'

/**
 * 受控 + 挂载生命周期：受控（controlledOpen 非空）时外部权威、内部状态不参与；
 * 非受控时内部状态跟随 Radix 开关。`Tooltip` 与 `TooltipRoot` 共用，避免两路漂移。
 */
function useTooltipController(
  controlledOpen: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
  defaultOpen = false,
  disabled = false
) {
  const [innerOpen, setInnerOpen] = React.useState(controlledOpen ?? defaultOpen)
  const [wasControlled, setWasControlled] = React.useState(controlledOpen != null)
  if (wasControlled !== (controlledOpen != null)) {
    setWasControlled(controlledOpen != null)
    // 受控期间内部态不更新，切回非受控时必须复位，否则会复活切换前的陈旧 open
    if (controlledOpen == null) setInnerOpen(false)
  }
  const effectiveOpen = controlledOpen != null ? controlledOpen : disabled ? false : innerOpen
  const contentVisible = useTooltipUnmountDelay(effectiveOpen)
  // disabled 早退后组件仍挂载，内部打开态必须复位，否则重新启用时会不经 hover 直接打开
  React.useEffect(() => {
    if (disabled) setInnerOpen(false)
  }, [disabled])
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (controlledOpen == null) setInnerOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )
  return { contentVisible, effectiveOpen, handleOpenChange }
}

/**
 * 孤儿清扫器（模块级，单例）：Radix portal content 在重挂风暴中可能失去 React owner 而
 * 永久残留。closed 连续存活超过清扫延迟即移除；open 态（instant-open/delayed-open）无法
 * 仅凭 data-state 区分活实例与残骸，周期性核对「仍被 floating-ui 定位」且「trigger 仍通过
 * aria-describedby 引用 content 内 role=tooltip span 的 id」两个存活特征：超过一个重检
 * 周期两者皆无才移除，任一存在则续期。不依赖任何实例生命周期（实例卸载会取消其
 * timer，故清扫必须与实例生命周期解耦）。只清扫渲染时带 data-tooltip-sweepable 的内容
 * （即本组件非显式 forceMount 的门控渲染内容）；显式 forceMount 内容由用户持有，不受影响。
 */
function setupTooltipOrphanSweeper(): void {
  const pending = new WeakMap<Element, number>()
  const observedRoots = new WeakSet<Document | ShadowRoot>()
  // 已观察 shadow root 的弱引用清单，替代「全文档元素级遍历 + 逐元素递归」的引用搜索
  const shadowRoots: WeakRef<ShadowRoot>[] = []
  /** 查找对某 contentId 的 trigger 引用：document 单查询 + 已观察 shadow root 逐个单查询。
   * 只覆盖已观察的 shadow root（宿主插入后迟 attach 的 root 为已知边界）；iframe 不可达。 */
  const hasActiveAriaReference = (tooltipId: string): boolean => {
    const selector = `[aria-describedby~="${CSS.escape(tooltipId)}"]`
    if (document.querySelector(selector)) return true
    for (let i = shadowRoots.length - 1; i >= 0; i--) {
      const root = shadowRoots[i].deref()
      // 顺带压缩死引用：WeakRef 清理不会缩短数组，索引必须自己收缩
      if (!root) {
        shadowRoots.splice(i, 1)
        continue
      }
      if (root.isConnected && root.querySelector(selector)) return true
    }
    return false
  }
  /** 内容是否脱离 popper 定位：活实例恒被 floating-ui 定位（wrapper 保有 transform），
   * popper 失去 floating 元素时该 transform 会被移除；删除中断（React 抛错）的残骸不在覆盖内。 */
  const isUnpositioned = (node: Element): boolean => {
    const wrapper = node.parentElement
    return !wrapper?.hasAttribute('data-radix-popper-content-wrapper') || !wrapper.style.transform
  }
  const cancelPending = (node: Element) => {
    const previous = pending.get(node)
    if (previous != null) window.clearTimeout(previous)
    pending.delete(node)
  }
  const maybeSweep = (node: Element) => {
    // 任何状态变化都取消旧 timer：reopen 后再 close 时，旧 timer 不得截断新一轮退出窗口
    cancelPending(node)
    const state = node.getAttribute('data-state')
    if (state === 'closed') {
      pending.set(
        node,
        window.setTimeout(() => {
          pending.delete(node)
          // 复查标记：排队期间调用方可能已开启 forceMount（内容回到用户持有，不得清扫）
          if (
            node.isConnected &&
            node.hasAttribute('data-tooltip-sweepable') &&
            node.getAttribute('data-state') === 'closed'
          ) {
            node.remove()
          }
        }, TOOLTIP_SWEEP_DELAY_MS)
      )
    } else if (state) {
      // open 态：无 trigger 引用 = 失去活跃 owner 的残骸；仍被引用则续期重检
      // （覆盖「打开后超过一个周期才失去 owner」的残骸，而非只清扫打开瞬间即孤儿的内容）
      pending.set(
        node,
        window.setTimeout(() => {
          if (!node.isConnected || !node.hasAttribute('data-tooltip-sweepable')) {
            pending.delete(node)
            return
          }
          if (node.getAttribute('data-state') === 'closed') {
            pending.delete(node)
            maybeSweep(node) // 刚关闭，重新走 closed 窗口
            return
          }
          // 内容里可能有多个 role=tooltip（用户内容自身可含）：任一 id 被 trigger 引用即活实例；
          // 无候选（数组为空）时 every 恒真，必须保留 length 判断以免误删
          const tooltipIds = Array.from(node.querySelectorAll<HTMLElement>('[role="tooltip"][id]'))
            .map((el) => el.id)
            .filter(Boolean)
          // 仍被定位即活实例；不能只看 aria 引用——trigger 自带 aria-describedby 会覆盖 Radix 的引用
          if (tooltipIds.length > 0 && isUnpositioned(node) && tooltipIds.every((id) => !hasActiveAriaReference(id))) {
            pending.delete(node)
            node.remove()
            return
          }
          maybeSweep(node)
        }, STALE_OPEN_SWEEP_MS)
      )
    }
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target as Element
        if (target.getAttribute('data-slot') === 'tooltip-content') {
          // 标记被移除 = 内容回到调用方持有（如 forceMount 打开）：撤销排队中的清扫
          if (target.hasAttribute('data-tooltip-sweepable')) {
            maybeSweep(target)
          } else {
            cancelPending(target)
          }
        }
        continue
      }
      for (const node of mutation.addedNodes) {
        const element = node as Element
        const isElement = element.nodeType === 1
        if (!isElement && element.nodeType !== 11) continue // 元素或 DocumentFragment（其子树整体追加）
        // content 内部元素（arrow/svg/文本）的 churn 与关闭判定无关
        if (isElement && element.parentElement?.getAttribute('data-slot') === 'tooltip-content') continue
        // 一条原生属性查询取代逐元素 JS 遍历：大子树挂载时不再做 O(子树) 的 JS 工作
        if (isElement && element.matches(SWEEPABLE_CONTENT_SELECTOR)) maybeSweep(element)
        for (const target of element.querySelectorAll(SWEEPABLE_CONTENT_SELECTOR)) {
          maybeSweep(target)
        }
        // shadow 宿主没有对应选择器，只查节点自身与直接子级（宿主随深层子树一并插入不在支持范围）
        if (isElement && element.shadowRoot) scanShadowTree(element.shadowRoot)
        for (const child of element.children) {
          if (child.shadowRoot) scanShadowTree(child.shadowRoot)
        }
      }
    }
  })
  // shadow 边界不穿透：已挂 root 的宿主连同其内容一并纳入观察，嵌套宿主逐层递归
  function scanShadowTree(root: ShadowRoot): void {
    ensureObserved(root)
    for (const el of root.querySelectorAll(SWEEPABLE_CONTENT_SELECTOR)) {
      maybeSweep(el)
    }
    for (const child of root.children) {
      if (child.shadowRoot) scanShadowTree(child.shadowRoot)
    }
  }
  function ensureObserved(root: Document | ShadowRoot): void {
    if (observedRoots.has(root)) return
    observedRoots.add(root)
    if (root instanceof ShadowRoot) shadowRoots.push(new WeakRef(root))
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-tooltip-sweepable']
    })
  }
  ensureObserved(document)
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  setupTooltipOrphanSweeper()
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
// Radix Tooltip 的打开态 data-state 是 instant-open/delayed-open（非 open），选择器必须用子串匹配
const contentStyles =
  'z-[80] w-fit max-w-80 origin-(--radix-tooltip-content-transform-origin) rounded-md bg-neutral-900 px-3 py-1.5 text-neutral-50 text-xs leading-relaxed whitespace-normal break-words data-[state*=open]:animate-in data-[state*=open]:fade-in-0 data-[state*=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 dark:bg-neutral-100 dark:text-neutral-900 [-webkit-app-region:no-drag]'

const arrowStyles =
  'z-[80] -translate-y-px fill-neutral-900 stroke-neutral-900 stroke-2 dark:fill-neutral-100 dark:stroke-neutral-100 [paint-order:stroke_fill]'

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  portalContainer,
  showArrow = true,
  forceMount,
  ...props
}: TooltipContentProps) {
  const defaultPortalContainer = usePortalContainer()
  const contentVisible = React.use(TooltipOverlayContext)
  // 显式 forceMount 保留 Radix 公共契约（closed 也常驻 DOM），豁免 150ms 门控
  if (contentVisible === false && !forceMount) return null
  const container = portalContainer ?? defaultPortalContainer ?? undefined
  const arrow = showArrow ? <RadixArrow width={12} height={6} className={arrowStyles} /> : null
  // 有 overlay context（TooltipRoot 组合）时挂载由门控接管：forceMount + 150ms 退出窗口；
  // 显式 forceMount 内容由用户持有生命周期，不带清扫标记；独立使用保持 Radix 原生 presence 卸载。
  if (contentVisible !== null) {
    return (
      <RadixPortal container={container} forceMount>
        <RadixContent
          data-slot="tooltip-content"
          data-tooltip-sweepable={forceMount ? undefined : ''}
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
    // Portal 层也须 forceMount：其内部 Presence 同样会在 closed 时卸载整棵子树
    <RadixPortal container={container} forceMount={forceMount ? true : undefined}>
      <RadixContent
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        forceMount={forceMount}
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
  const disabled = !tooltipContent || isDisabled
  const { contentVisible, effectiveOpen, handleOpenChange } = useTooltipController(
    isOpen,
    onOpenChange,
    false,
    disabled
  )
  const triggerWrapperClassName = cn(
    'relative z-10',
    fullWidthTrigger ? 'block w-full max-w-full min-w-0' : 'inline-block',
    classNames?.placeholder
  )

  if (disabled) {
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
              data-tooltip-sweepable
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
