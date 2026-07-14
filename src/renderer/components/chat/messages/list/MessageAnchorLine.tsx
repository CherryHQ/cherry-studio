import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { classNames } from '@renderer/utils/style'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePartsMap } from '../blocks/MessagePartsContext'
import type { MessageListItem } from '../types'

interface MessageLineProps {
  messages: MessageListItem[]
  /** Message currently at the viewport center; highlights its turn's tick. */
  activeMessageId?: string | null
  /** Fades the rail out (and disables it) when the chat column is too narrow. */
  visible?: boolean
  scrollToMessageId?: (messageId: string) => void
}

/** One conversation turn: a user question plus the replies that follow it. */
interface AnchorTurn {
  /** Turn start message — the scroll target. */
  anchorId: string
  userMessageId?: string
  assistantMessageId?: string
  memberIds: string[]
}

const TICK_BASE_WIDTH = 6
/** The hovered tick leads the wave without towering over it. */
const TICK_PEAK_WIDTH = 20
/** Neighbouring ticks swell towards the peak so the wave reads as one shape. */
const TICK_WAVE_BONUS = 10
const HOVER_FALLOFF_DISTANCE = 56
/** Beyond this distance from the nearest tick, nothing is focused and no card shows. */
const FOCUS_MAX_DISTANCE = 24
/** Keep the preview card's center away from the rail's vertical edges. */
const PREVIEW_EDGE_INSET = 56
const PREVIEW_MAX_CHARS = 240

const tickTransitionClassName =
  'transition-[width,height,background-color] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] [will-change:width]'

const MessageAnchorLine: FC<MessageLineProps> = ({ messages, activeMessageId, visible = true, scrollToMessageId }) => {
  const partsMap = usePartsMap()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tickRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  /** Cursor Y in rail-list coordinates; null when not hovering. */
  const [mouseY, setMouseY] = useState<number | null>(null)
  const [listOffsetY, setListOffsetY] = useState(0)
  const [focused, setFocused] = useState<{ index: number; top: number } | null>(null)

  const turns = useMemo<AnchorTurn[]>(() => {
    const result: AnchorTurn[] = []
    let current: AnchorTurn | null = null
    for (const message of messages) {
      if (message.type === 'clear') continue
      if (message.role === 'user') {
        current = { anchorId: message.id, userMessageId: message.id, memberIds: [message.id] }
        result.push(current)
        continue
      }
      if (!current) {
        current = { anchorId: message.id, memberIds: [] }
        result.push(current)
      }
      current.memberIds.push(message.id)
      if (!current.assistantMessageId && message.role === 'assistant') {
        current.assistantMessageId = message.id
      }
    }
    return result
  }, [messages])

  const turnIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>()
    turns.forEach((turn, index) => turn.memberIds.forEach((id) => map.set(id, index)))
    return map
  }, [turns])

  const activeTurnIndex =
    activeMessageId != null ? (turnIndexByMessageId.get(activeMessageId) ?? turns.length - 1) : turns.length - 1

  const calculateWaveBonus = useCallback(
    (turnAnchorId: string) => {
      if (mouseY === null) return 0
      const element = tickRefs.current.get(turnAnchorId)
      const listElement = listRef.current
      if (!element || !listElement) return 0
      const rect = element.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2 - listElement.getBoundingClientRect().top
      const distance = Math.abs(centerY - mouseY)
      const falloff = Math.max(0, 1 - distance / HOVER_FALLOFF_DISTANCE)
      return TICK_WAVE_BONUS * falloff ** 1.5
    },
    [mouseY]
  )

  const handleMouseMove = (e: React.MouseEvent) => {
    const wrapper = wrapperRef.current
    const list = listRef.current
    if (!wrapper || !list) return
    const wrapperRect = wrapper.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    setMouseY(e.clientY - listRect.top)

    // Rail taller than the viewport: slide it with the cursor so every tick stays reachable.
    if (listRect.height > wrapperRect.height) {
      const ratio = (e.clientY - wrapperRect.top) / wrapperRect.height
      const maxOffset = (listRect.height - wrapperRect.height) / 2
      setListOffsetY(maxOffset * (1 - ratio * 2))
    } else {
      setListOffsetY(0)
    }

    let nearest: { index: number; centerY: number; distance: number } | null = null
    for (const [index, turn] of turns.entries()) {
      const element = tickRefs.current.get(turn.anchorId)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const distance = Math.abs(centerY - e.clientY)
      if (!nearest || distance < nearest.distance) {
        nearest = { index, centerY, distance }
      }
    }
    // Only focus (and show the card) while the cursor is actually near a tick —
    // hovering the empty stretch of the rail should not pin the last card.
    setFocused(
      nearest && nearest.distance <= FOCUS_MAX_DISTANCE
        ? {
            index: nearest.index,
            top: Math.min(
              Math.max(nearest.centerY - wrapperRect.top, PREVIEW_EDGE_INSET),
              Math.max(wrapperRect.height - PREVIEW_EDGE_INSET, PREVIEW_EDGE_INSET)
            )
          }
        : null
    )
  }

  const handleMouseLeave = () => {
    setMouseY(null)
    setListOffsetY(0)
    setFocused(null)
  }

  // Falling below the width threshold mid-hover would otherwise freeze the
  // wave and card in place behind the fade-out.
  useEffect(() => {
    if (visible) return
    setMouseY(null)
    setListOffsetY(0)
    setFocused(null)
  }, [visible])

  if (turns.length === 0) return null

  const isHovering = mouseY !== null
  const focusedTurn = focused !== null ? turns[focused.index] : null
  const getPreviewText = (messageId?: string) =>
    messageId ? getTextFromParts(partsMap?.[messageId] ?? []).slice(0, PREVIEW_MAX_CHARS) : ''
  const focusedQuestion = getPreviewText(focusedTurn?.userMessageId)
  const focusedAnswer = getPreviewText(focusedTurn?.assistantMessageId)

  return (
    <div
      ref={wrapperRef}
      className={classNames(
        // right-4 keeps the ticks clear of the scrollbar gutter (~15px) so the
        // thumb never overlaps them while scrolling. The gutter is 15px because
        // the Scrollbar composite's inline scrollbar-color opts Chromium out of
        // the global 6px ::-webkit-scrollbar styling into the standard CSS
        // scrollbar; scrollbar-gutter:stable only keeps it reserved while hidden.
        'group absolute top-2.5 right-4 bottom-2.5 z-20 w-8 select-none transition-opacity duration-300',
        !visible && 'pointer-events-none opacity-0'
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}>
      <div
        className={classNames(
          'flex h-full flex-col justify-center overflow-hidden transition-opacity duration-150',
          isHovering ? 'opacity-100' : 'opacity-70'
        )}>
        <div
          ref={listRef}
          className="flex flex-col items-end [will-change:transform]"
          style={{ transform: `translateY(${listOffsetY}px)` }}>
          {turns.map((turn, index) => {
            const isActive = index === activeTurnIndex
            const isFocused = focused?.index === index
            // The active turn is marked by color only — every tick keeps the
            // same length at rest; length changes belong to the hover wave.
            const width = isHovering
              ? isFocused
                ? TICK_PEAK_WIDTH
                : TICK_BASE_WIDTH + calculateWaveBonus(turn.anchorId)
              : TICK_BASE_WIDTH
            const emphasized = focused !== null ? isFocused : isActive
            return (
              <div
                key={turn.anchorId}
                ref={(el) => {
                  if (el) tickRefs.current.set(turn.anchorId, el)
                  else tickRefs.current.delete(turn.anchorId)
                }}
                data-message-anchor-tick
                data-active={isActive}
                className="flex h-2.5 w-full cursor-pointer items-center justify-end"
                onClick={() => scrollToMessageId?.(turn.anchorId)}>
                <div
                  className={classNames(
                    'rounded-full',
                    tickTransitionClassName,
                    isFocused ? 'h-0.5' : 'h-[1.5px]',
                    emphasized ? 'bg-foreground' : 'bg-foreground-muted'
                  )}
                  style={{ width }}
                />
              </div>
            )
          })}
        </div>
      </div>
      {focused !== null && (focusedQuestion || focusedAnswer) && (
        <div
          className="-translate-y-1/2 pointer-events-none absolute right-full z-30 w-max max-w-80 rounded-xl border-[0.5px] border-border bg-popover p-3 text-popover-foreground shadow-lg transition-[top] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] dark:bg-neutral-800"
          style={{ top: focused.top }}>
          {focusedQuestion && (
            <div className="line-clamp-1 break-all font-medium text-foreground text-sm">{focusedQuestion}</div>
          )}
          {focusedAnswer && (
            <div
              className={classNames(
                'line-clamp-2 break-all text-foreground-secondary text-sm leading-5',
                focusedQuestion && 'mt-1'
              )}>
              {focusedAnswer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MessageAnchorLine
