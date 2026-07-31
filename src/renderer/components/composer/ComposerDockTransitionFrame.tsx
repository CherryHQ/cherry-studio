import {
  ChatBottomOverlayInsetProvider,
  type ChatBottomOverlayInsets
} from '@renderer/components/chat/layout/ChatViewportInsetContext'
import {
  getComposerDockMotionAttributes,
  useComposerDockMotionTransition
} from '@renderer/components/chat/motion/composerDockMotion'
import { useOptionalQuickPanel } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

const COMPOSER_MESSAGE_GAP_PX = 16

export type ComposerDockPlacement = 'home' | 'docked'

interface ComposerDockTransitionFrameProps {
  placement: ComposerDockPlacement
  main: ReactNode
  composer: ReactNode
  mainVisible?: boolean
  /** Lift the composer above a full-area overlay (e.g. a maximized side pane). */
  composerElevated?: boolean
  overlay?: ReactNode
}

interface ComposerInlineInsets {
  left: number
  right: number
}

const ZERO_COMPOSER_INLINE_INSETS: ComposerInlineInsets = { left: 0, right: 0 }

function findComposerViewportInsetTarget(node: HTMLElement): HTMLElement | null {
  const activeLayer = node.querySelector<HTMLElement>('[data-composer-active-layer]')
  const targetRoot = activeLayer ?? node

  return (
    targetRoot.querySelector<HTMLElement>('[data-composer-viewport-inset-target]') ??
    targetRoot.querySelector<HTMLElement>('[data-composer-inputbar]')
  )
}

export default function ComposerDockTransitionFrame({
  placement,
  main,
  composer,
  mainVisible = placement === 'docked',
  composerElevated = false,
  overlay
}: ComposerDockTransitionFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const [bottomOverlayInsets, setBottomOverlayInsets] = useState<ChatBottomOverlayInsets | null>(null)
  const [composerInlineInsets, setComposerInlineInsets] = useState<ComposerInlineInsets>(ZERO_COMPOSER_INLINE_INSETS)
  const isDocked = placement === 'docked'
  const hasComposer = Boolean(composer)
  const dockMotionTransition = useComposerDockMotionTransition(placement)
  const dockMotionAttributes = getComposerDockMotionAttributes(dockMotionTransition)
  const quickPanel = useOptionalQuickPanel()

  // Home placement asks the quick panel to fill the available height above the input.
  // Pushed explicitly through context (no DOM contract); no-op when there is no provider.
  const setQuickPanelFill = quickPanel?.setFillToAvailableHeight
  useLayoutEffect(() => {
    if (!setQuickPanelFill) return
    setQuickPanelFill(placement === 'home')
    return () => setQuickPanelFill(false)
  }, [placement, setQuickPanelFill])

  useLayoutEffect(() => {
    const node = composerRef.current
    if (!node) return
    let observer: ResizeObserver | null = null
    let observedInsetTarget: HTMLElement | null = null

    const updateInset = () => {
      if (!isDocked || !hasComposer) {
        setBottomOverlayInsets(null)
        setComposerInlineInsets((current) =>
          current.left === 0 && current.right === 0 ? current : ZERO_COMPOSER_INLINE_INSETS
        )
        return
      }
      const insetTarget = findComposerViewportInsetTarget(node)
      if (observer && insetTarget !== observedInsetTarget) {
        if (observedInsetTarget) observer.unobserve(observedInsetTarget)
        if (insetTarget) observer.observe(insetTarget)
        observedInsetTarget = insetTarget
      }
      const root = rootRef.current
      if (!insetTarget || !root) {
        setBottomOverlayInsets(null)
        setComposerInlineInsets((current) =>
          current.left === 0 && current.right === 0 ? current : ZERO_COMPOSER_INLINE_INSETS
        )
        return
      }
      const insetTargetRect = insetTarget.getBoundingClientRect()
      // A composer mid-swap (e.g. its lazy chunk still loading behind Suspense)
      // measures as a zero rect. Deriving insets from it would push the message
      // list's bottom margin to the full stage height and collapse the list to
      // zero height, so keep the last good insets until the composer lays out.
      if (insetTargetRect.width === 0 && insetTargetRect.height === 0) return
      const composerRect = node.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      const scroller = root.querySelector<HTMLElement>('[data-message-virtual-list-scroller]')
      const scrollerRect = scroller?.getBoundingClientRect()
      const scrollerClientWidth = scroller?.clientWidth ?? 0
      const nextBottomOverlayInsets = {
        contentBottomPadding: Math.max(0, insetTargetRect.bottom - composerRect.top + COMPOSER_MESSAGE_GAP_PX),
        scrollerBottomMargin: Math.max(0, rootRect.bottom - insetTargetRect.bottom)
      }
      const nextComposerInlineInsets = {
        left: scrollerRect ? Math.max(0, scrollerRect.left - rootRect.left) : 0,
        right: scrollerRect ? Math.max(0, rootRect.right - scrollerRect.left - scrollerClientWidth) : 0
      }
      setBottomOverlayInsets((current) =>
        current?.contentBottomPadding === nextBottomOverlayInsets.contentBottomPadding &&
        current.scrollerBottomMargin === nextBottomOverlayInsets.scrollerBottomMargin
          ? current
          : nextBottomOverlayInsets
      )
      setComposerInlineInsets((current) =>
        current.left === nextComposerInlineInsets.left && current.right === nextComposerInlineInsets.right
          ? current
          : nextComposerInlineInsets
      )
    }
    updateInset()

    if (typeof ResizeObserver === 'undefined') return

    observer = new ResizeObserver(updateInset)
    if (rootRef.current) observer.observe(rootRef.current)
    observer.observe(node)
    const scroller = rootRef.current?.querySelector<HTMLElement>('[data-message-virtual-list-scroller]')
    if (scroller) observer.observe(scroller)
    updateInset()

    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(updateInset)
    mutationObserver?.observe(node, {
      attributes: true,
      attributeFilter: ['data-composer-active-layer', 'data-composer-active-override'],
      subtree: true
    })

    return () => {
      mutationObserver?.disconnect()
      observer?.disconnect()
    }
  }, [hasComposer, isDocked])

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ChatBottomOverlayInsetProvider value={bottomOverlayInsets}>
        <div
          className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', !mainVisible && 'pointer-events-none')}
          style={{ opacity: mainVisible ? 1 : 0 }}>
          {main}
        </div>
      </ChatBottomOverlayInsetProvider>

      <div
        data-composer-dock-layer=""
        style={
          isDocked
            ? {
                paddingInlineStart: composerInlineInsets.left,
                paddingInlineEnd: composerInlineInsets.right
              }
            : undefined
        }
        className={cn(
          // The whole dock stack stays click-through: the layer, the wrapper, and
          // any width-capped centering inside the composer all span or flank the
          // pane, so pointer events are re-enabled only by the composer content
          // roots (ComposerSurface's NarrowLayout and the override composers).
          'pointer-events-none absolute inset-x-0 w-full',
          composerElevated ? 'z-50' : 'z-10',
          isDocked ? 'bottom-0' : 'top-0 bottom-0 flex items-center pb-[12vh] has-[.inputbar-container.expanded]:pb-0'
        )}>
        <div className="w-full">
          <div
            ref={composerRef}
            data-composer-dock-surface=""
            data-composer-dock-motion={dockMotionAttributes?.motion}
            className={cn('w-full', dockMotionAttributes?.className)}>
            {composer}
          </div>
        </div>
      </div>

      {overlay}
    </div>
  )
}
