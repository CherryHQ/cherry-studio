import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { cn } from '@renderer/utils/style'

import { CHAT_NARROW_MAX_WIDTH, CHAT_NARROW_MIN_WIDTH, CHAT_NARROW_SIDE_PADDING_TOTAL } from './paneLayout'
import { getVerticalSplitterProps } from './splitterA11y'
import { type ChatNarrowResizeSide, useChatNarrowWidthResize } from './useChatNarrowWidthResize'

const HANDLE_BASE_CLASS =
  'group/narrow-handle pointer-events-auto absolute top-4 bottom-4 w-5 cursor-col-resize focus-visible:outline-none'
const HANDLE_HAIRLINE_CLASS =
  'pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent opacity-0 transition-opacity duration-200'
const HANDLE_CAPSULE_CLASS =
  'pointer-events-none absolute left-1/2 flex h-9 w-[10px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/90 bg-background/95 shadow-xs backdrop-blur-xs transition-[opacity,transform,border-color,box-shadow] duration-150'
const HANDLE_INNER_BAR_CLASS = 'h-3.5 w-[2px] rounded-full bg-muted-foreground/55 transition-colors duration-150'

function clampGripY(clientY: number, rect: DOMRect): number {
  return Math.min(Math.max(28, clientY - rect.top), Math.max(28, rect.height - 28))
}

interface ChatNarrowWidthHandlesProps {
  stageRef: RefObject<HTMLDivElement | null>
  visible: boolean
}

export function ChatNarrowWidthHandles({ stageRef, visible }: ChatNarrowWidthHandlesProps) {
  const { t } = useTranslation()
  const leftHandleRef = useRef<HTMLDivElement>(null)
  const rightHandleRef = useRef<HTMLDivElement>(null)
  const leftGripRef = useRef<HTMLDivElement>(null)
  const rightGripRef = useRef<HTMLDivElement>(null)
  const widthBadgeRef = useRef<HTMLSpanElement>(null)
  const liveWidthRef = useRef<number | null>(null)
  const stageWidthRef = useRef<number | null>(null)
  const [badgeInward, setBadgeInward] = useState(false)

  const handleLiveWidthChange = useCallback((width: number) => {
    liveWidthRef.current = width
    if (widthBadgeRef.current) {
      widthBadgeRef.current.textContent = `${width}px`
    }
    const sw = stageWidthRef.current
    const nextInward = Boolean(sw && sw > 0 && sw - width - CHAT_NARROW_SIDE_PADDING_TOTAL < 140)
    setBadgeInward((prev) => (prev === nextInward ? prev : nextInward))
  }, [])

  const { isResizing, activeSide, narrowWidth, startResizing, setNarrowWidth, resetNarrowWidth } =
    useChatNarrowWidthResize(stageRef, { onLiveWidthChange: handleLiveWidthChange })
  const [narrowMode] = usePreference('chat.narrow_mode')
  const { forceWideLayout, railGutterPx, sidePaddingPx } = useChatLayoutMode()
  const [stageWidth, setStageWidth] = useState<number | null>(null)
  const [hoveredSide, setHoveredSide] = useState<ChatNarrowResizeSide | null>(null)

  const syncGripTop = useCallback((topValue: string) => {
    if (leftGripRef.current) leftGripRef.current.style.top = topValue
    if (rightGripRef.current) rightGripRef.current.style.top = topValue
  }, [])

  const updateGripFromClientY = useCallback(
    (clientY: number, rect?: DOMRect) => {
      const targetRect =
        rect ?? leftHandleRef.current?.getBoundingClientRect() ?? rightHandleRef.current?.getBoundingClientRect()
      if (!targetRect || targetRect.height <= 0) return
      syncGripTop(`${Math.round(clampGripY(clientY, targetRect))}px`)
    },
    [syncGripTop]
  )

  useEffect(() => {
    if (!isResizing) {
      liveWidthRef.current = null
      setHoveredSide(
        leftHandleRef.current?.matches(':hover') ? 'left' : rightHandleRef.current?.matches(':hover') ? 'right' : null
      )
      return
    }

    const onMouseMove = (event: MouseEvent) => {
      const activeHandle = activeSide === 'left' ? leftHandleRef.current : rightHandleRef.current
      updateGripFromClientY(event.clientY, activeHandle?.getBoundingClientRect())
    }
    document.addEventListener('mousemove', onMouseMove)
    return () => document.removeEventListener('mousemove', onMouseMove)
  }, [activeSide, isResizing, updateGripFromClientY])

  useEffect(() => {
    const element = stageRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const applyStageWidth = (rawWidth: number) => {
      const resolved = rawWidth > 0 ? rawWidth : null
      stageWidthRef.current = resolved
      setStageWidth(resolved)
    }
    applyStageWidth(element.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      applyStageWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [stageRef])

  const hasRoom =
    stageWidth === null || stageWidth === 0 || stageWidth > CHAT_NARROW_MIN_WIDTH + CHAT_NARROW_SIDE_PADDING_TOTAL + 16
  if (!visible || !narrowMode || forceWideLayout || !hasRoom) return null

  const effectiveMaxWidth =
    stageWidth && stageWidth > 0
      ? Math.min(
          CHAT_NARROW_MAX_WIDTH,
          Math.max(CHAT_NARROW_MIN_WIDTH, Math.floor(stageWidth - CHAT_NARROW_SIDE_PADDING_TOTAL))
        )
      : CHAT_NARROW_MAX_WIDTH

  const displayedBadgeWidth = liveWidthRef.current ?? narrowWidth

  const renderSideHandle = (side: ChatNarrowResizeSide) => {
    const isLeft = side === 'left'
    const isPrimaryHover = hoveredSide === side
    const isMirrorHover = hoveredSide !== null && hoveredSide !== side
    const isAnyHovered = hoveredSide !== null
    const handleRef = isLeft ? leftHandleRef : rightHandleRef
    const gripRef = isLeft ? leftGripRef : rightGripRef
    const badgePositionClass = isLeft
      ? badgeInward
        ? 'left-full ml-2'
        : 'right-full mr-2'
      : badgeInward
        ? 'right-full mr-2'
        : 'left-full ml-2'

    return (
      <div
        ref={handleRef}
        data-chat-narrow-resize-handle={side}
        onMouseEnter={(event: ReactMouseEvent<HTMLDivElement>) => {
          setHoveredSide(side)
          updateGripFromClientY(event.clientY, event.currentTarget.getBoundingClientRect())
        }}
        onMouseMove={(event: ReactMouseEvent<HTMLDivElement>) => {
          if (!isResizing) {
            updateGripFromClientY(event.clientY, event.currentTarget.getBoundingClientRect())
          }
        }}
        onMouseLeave={() => {
          setHoveredSide((current) => (current === side ? null : current))
        }}
        onFocus={() => syncGripTop('50%')}
        onMouseDown={(event) => {
          updateGripFromClientY(event.clientY, event.currentTarget.getBoundingClientRect())
          startResizing(side, event)
        }}
        onDoubleClick={resetNarrowWidth}
        {...getVerticalSplitterProps({
          width: narrowWidth,
          min: CHAT_NARROW_MIN_WIDTH,
          max: effectiveMaxWidth,
          label: t('common.resize_panel'),
          onResize: setNarrowWidth,
          invert: isLeft
        })}
        className={cn(HANDLE_BASE_CLASS, isLeft ? 'right-full' : 'left-full')}>
        <div
          className={cn(
            HANDLE_HAIRLINE_CLASS,
            isAnyHovered && 'opacity-80',
            'group-focus-visible/narrow-handle:opacity-80',
            isResizing && 'via-border-strong opacity-100'
          )}
        />
        <div
          ref={gripRef}
          style={{ top: '50%' }}
          className={cn(
            HANDLE_CAPSULE_CLASS,
            'scale-95 opacity-0',
            isMirrorHover && 'scale-95 opacity-55',
            isPrimaryHover && 'scale-100 opacity-100',
            'group-focus-visible/narrow-handle:scale-100 group-focus-visible/narrow-handle:opacity-100',
            isResizing && 'scale-100 border-border-strong opacity-100 shadow-sm'
          )}>
          <div
            className={cn(
              HANDLE_INNER_BAR_CLASS,
              (isPrimaryHover || isResizing) && 'bg-foreground/80',
              'group-focus-visible/narrow-handle:bg-foreground/80'
            )}
          />
          {isResizing && activeSide === side && (
            <span
              ref={widthBadgeRef}
              data-chat-narrow-width-badge=""
              className={cn(
                'pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md border border-border/80 bg-popover px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-popover-foreground tabular-nums shadow-xs',
                badgePositionClass
              )}>
              {displayedBadgeWidth}px
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-chat-narrow-resize-overlay=""
      data-resizing={isResizing || undefined}
      data-hovered-side={hoveredSide ?? undefined}
      className="group/chat-narrow-resize pointer-events-none absolute inset-0 z-[9] flex justify-center overflow-hidden">
      <div
        className="box-border h-full w-full"
        style={{
          maxWidth: 'calc(var(--chat-narrow-width, 800px) + 3rem)',
          paddingLeft: sidePaddingPx + railGutterPx,
          paddingRight: sidePaddingPx + railGutterPx
        }}>
        <div className="relative h-full w-full">
          {renderSideHandle('left')}
          {renderSideHandle('right')}
        </div>
      </div>
    </div>
  )
}
