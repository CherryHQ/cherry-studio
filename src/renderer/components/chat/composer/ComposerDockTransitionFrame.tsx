import { useOptionalQuickPanel } from '@renderer/components/chat/composer/panelEngine'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

import {
  ChatBottomOverlayInsetProvider,
  type ChatBottomOverlayInsets,
  useSetChatMaximizedOverlayBottomInset
} from '../layout/ChatViewportInsetContext'
import { getComposerDockMotionAttributes, useComposerDockMotionTransition } from '../motion/composerDockMotion'

const COMPOSER_MESSAGE_GAP_PX = 16
const COMPOSER_OVERLAY_GAP_PX = 16

export type ComposerDockPlacement = 'home' | 'docked'

interface ComposerDockTransitionFrameProps {
  placement: ComposerDockPlacement
  main: ReactNode
  composer: ReactNode
  homeHeader?: ReactNode
  mainVisible?: boolean
  /** Lift the composer above a full-area overlay (e.g. a maximized side pane). */
  composerElevated?: boolean
  overlay?: ReactNode
}

interface ComposerInlineInsets {
  left: number
  right: number
}

export default function ComposerDockTransitionFrame({
  placement,
  main,
  composer,
  homeHeader,
  mainVisible = placement === 'docked',
  composerElevated = false,
  overlay
}: ComposerDockTransitionFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const [bottomOverlayInsets, setBottomOverlayInsets] = useState<ChatBottomOverlayInsets | null>(null)
  const [composerInlineInsets, setComposerInlineInsets] = useState<ComposerInlineInsets>({ left: 0, right: 0 })
  const isDocked = placement === 'docked'
  const hasComposer = Boolean(composer)
  const dockMotionTransition = useComposerDockMotionTransition(placement)
  const dockMotionAttributes = getComposerDockMotionAttributes(dockMotionTransition)
  const quickPanel = useOptionalQuickPanel()
  const setMaximizedOverlayBottomInset = useSetChatMaximizedOverlayBottomInset()

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
    if (!node) {
      setMaximizedOverlayBottomInset(0)
      return
    }

    const updateInset = () => {
      if (!isDocked || !hasComposer) {
        setBottomOverlayInsets(null)
        setComposerInlineInsets({ left: 0, right: 0 })
        setMaximizedOverlayBottomInset(0)
        return
      }
      const insetTarget =
        node.querySelector<HTMLElement>('[data-composer-viewport-inset-target]') ??
        node.querySelector<HTMLElement>('[data-composer-inputbar]')
      const root = rootRef.current
      if (!insetTarget || !root) {
        setBottomOverlayInsets(null)
        setComposerInlineInsets({ left: 0, right: 0 })
        setMaximizedOverlayBottomInset(0)
        return
      }
      const insetTargetRect = insetTarget.getBoundingClientRect()
      const composerRect = node.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      const scroller = root.querySelector<HTMLElement>('[data-message-virtual-list-scroller]')
      const scrollerRect = scroller?.getBoundingClientRect()
      const scrollerClientWidth = scroller?.clientWidth ?? 0
      setBottomOverlayInsets({
        contentBottomPadding: Math.max(0, insetTargetRect.bottom - composerRect.top + COMPOSER_MESSAGE_GAP_PX),
        scrollerBottomMargin: Math.max(0, rootRect.bottom - insetTargetRect.bottom)
      })
      setComposerInlineInsets({
        left: scrollerRect ? Math.max(0, scrollerRect.left - rootRect.left) : 0,
        right: scrollerRect ? Math.max(0, rootRect.right - scrollerRect.left - scrollerClientWidth) : 0
      })
      setMaximizedOverlayBottomInset(Math.max(0, rootRect.bottom - composerRect.top + COMPOSER_OVERLAY_GAP_PX))
    }
    updateInset()

    if (typeof ResizeObserver === 'undefined') {
      return () => setMaximizedOverlayBottomInset(0)
    }

    const observer = new ResizeObserver(updateInset)
    if (rootRef.current) observer.observe(rootRef.current)
    observer.observe(node)
    const insetTarget =
      node.querySelector<HTMLElement>('[data-composer-viewport-inset-target]') ??
      node.querySelector<HTMLElement>('[data-composer-inputbar]')
    if (insetTarget) observer.observe(insetTarget)
    const scroller = rootRef.current?.querySelector<HTMLElement>('[data-message-virtual-list-scroller]')
    if (scroller) observer.observe(scroller)
    return () => {
      observer.disconnect()
      setMaximizedOverlayBottomInset(0)
    }
  }, [hasComposer, isDocked, setMaximizedOverlayBottomInset])

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
          'absolute inset-x-0 w-full',
          composerElevated ? 'z-50' : 'z-10',
          isDocked
            ? 'bottom-0'
            : 'pointer-events-none top-0 bottom-0 flex items-center pb-[12vh] has-[.inputbar-container.expanded]:pb-0'
        )}>
        <div className="pointer-events-auto w-full">
          {!isDocked && homeHeader ? <div className="mb-6 flex justify-center">{homeHeader}</div> : null}
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
