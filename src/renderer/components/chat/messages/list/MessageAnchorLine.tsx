import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { classNames } from '@renderer/utils/style'
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { usePartsMap } from '../blocks/MessagePartsContext'
import type { MessageListItem } from '../types'

interface MessageLineProps {
  messages: MessageListItem[]
  /** Message under the viewport-top reading line; highlights its turn's tick. */
  activeMessageId?: string | null
  /** 0–1 fade driven by the content's rail gutter — the rail eases in/out with width. */
  railOpacity?: number
  /** Older turns exist beyond the loaded pages — anchor the strip to the bottom
   * and fade its top as a "more above" hint. */
  hasOlder?: boolean
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
/** Below this usable height the rail is cramped, so hide it. */
const RAIL_MIN_HEIGHT_PX = 220
/** Fixed minimum gap kept above the first and below the last tick — the ticks
 * never enter this zone, and it stays put while the strip scrolls. */
const RAIL_MIN_EDGE_MARGIN_PX = 24
/** Constant spacing between ticks. It never varies with the turn count (few → a
 * centred cluster); once the ticks outgrow the rail it scrolls instead. */
const RAIL_TICK_PITCH_PX = 10
/** Length of the fade applied to whichever end still has ticks scrolled past it. */
const RAIL_FADE_PX = 44
/** With fewer turns there is nothing worth anchoring — the rail stays hidden. */
const RAIL_MIN_TURNS = 5

const tickTransitionClassName =
  'transition-[width,height,background-color] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] [will-change:width]'

const MessageAnchorLine: FC<MessageLineProps> = ({
  messages,
  activeMessageId,
  railOpacity = 1,
  hasOlder = false,
  scrollToMessageId
}) => {
  const partsMap = usePartsMap()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const railScrollRef = useRef<HTMLDivElement>(null)

  /** Rail height in px; drives every tick position so they never depend on DOM reads. */
  const [railHeight, setRailHeight] = useState(0)
  /** The rail's own scroll offset (only moves when the user wheels the rail itself). */
  const [scrollTop, setScrollTop] = useState(0)
  /** Cursor Y relative to the rail's top; null when not hovering. */
  const [mouseY, setMouseY] = useState<number | null>(null)
  /** Once the composer inset leaves too little height, the rail is cramped — hide it. */
  const tooShort = railHeight > 0 && railHeight < RAIL_MIN_HEIGHT_PX
  const active = railOpacity > 0.02 && !tooShort

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

  // Tick geometry — CONSTANT pitch, so spacing never varies with the turn count.
  // viewport = railHeight − 2·edgeMargin (the space between the fixed margins).
  // • ticks fit      → centred within the viewport, wider margins.
  // • ticks overflow → the strip scrolls inside the fixed margins.
  // The margins live OUTSIDE the scroll area, so they never move while scrolling,
  // and every query (nearest tick, wave, card) is arithmetic against `scrollTop`.
  const geometry = useMemo(() => {
    const count = turns.length
    const viewport = Math.max(0, railHeight - RAIL_MIN_EDGE_MARGIN_PX * 2)
    const content = count * RAIL_TICK_PITCH_PX
    const free = Math.max(0, viewport - content)
    // Fully loaded conversations centre the cluster. Partially loaded ones
    // anchor it to the bottom (the newest turns, where the user enters), so
    // older turns streaming in later grow upward without moving a single
    // visible tick.
    const padTop = hasOlder ? free : free / 2
    const padBottom = free - padTop
    // Center of tick `index` in rail coordinates: fixed margin + top pad +
    // its slot, projected into the viewport by the strip's own scroll offset.
    const centerOf = (index: number) =>
      RAIL_MIN_EDGE_MARGIN_PX + padTop + index * RAIL_TICK_PITCH_PX + RAIL_TICK_PITCH_PX / 2 - scrollTop
    return { padTop, padBottom, centerOf }
  }, [turns.length, railHeight, scrollTop, hasOlder])

  // Nearest tick to the cursor, only when the cursor is genuinely near one.
  const focusedIndex = useMemo(() => {
    if (mouseY === null || turns.length === 0 || railHeight === 0) return null
    const raw = Math.round((mouseY - geometry.centerOf(0)) / RAIL_TICK_PITCH_PX)
    const index = Math.min(Math.max(raw, 0), turns.length - 1)
    return Math.abs(mouseY - geometry.centerOf(index)) <= FOCUS_MAX_DISTANCE ? index : null
  }, [mouseY, turns.length, railHeight, geometry])

  const handleMouseMove = (e: React.MouseEvent) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    setMouseY(e.clientY - wrapper.getBoundingClientRect().top)
  }

  const handleMouseLeave = () => setMouseY(null)

  // The rail scrolls independently of the conversation and never auto-follows
  // reading, so a tick's on-screen position is stable until the user scrolls
  // the rail itself. Mirror that offset into state so the card and wave track it.
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)

  // Fading out mid-hover would otherwise freeze the wave and card behind the fade.
  useEffect(() => {
    if (!active) setMouseY(null)
  }, [active])

  // Few messages don't need anchoring. Only the rail is gated — the content's
  // gutter (MessageList) follows width alone, so when the turn count crosses
  // this threshold the rail fades into space that already exists, with no jump.
  const hasRail = turns.length >= RAIL_MIN_TURNS

  // Keep the strip's reading anchor stable across async page loads:
  // • on entry, start at the bottom — the user enters at the newest turn;
  // • when older turns prepend, offset the scroll so visible ticks stay put
  //   (the browser clamp lands exactly right when the strip just overflowed);
  // • when new turns append while pinned to the bottom, stay pinned.
  const scrollAnchorRef = useRef<{ firstId: string | null; count: number; entered: boolean }>({
    firstId: null,
    count: 0,
    entered: false
  })
  useLayoutEffect(() => {
    const el = railScrollRef.current
    const anchor = scrollAnchorRef.current
    const firstId = turns[0]?.anchorId ?? null
    if (el) {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
      const added = turns.length - anchor.count
      if (!anchor.entered) {
        el.scrollTop = maxScroll
        anchor.entered = true
      } else if (added > 0 && firstId !== anchor.firstId) {
        el.scrollTop += added * RAIL_TICK_PITCH_PX
      } else if (added > 0 && maxScroll - el.scrollTop <= added * RAIL_TICK_PITCH_PX + 1) {
        el.scrollTop = maxScroll
      }
      setScrollTop(el.scrollTop)
    }
    anchor.firstId = firstId
    anchor.count = turns.length
  }, [turns, railHeight])

  // Track the rail height so tick geometry stays exact across window/composer
  // resizes, and hide the rail once it is too short to be usable. Layout effect
  // keyed on hasRail: messages load asynchronously, so on first run the rail is
  // often not rendered yet (wrapper null) — the effect must re-run once it
  // mounts, and measure before paint or the ticks flash top-aligned.
  useLayoutEffect(() => {
    if (!hasRail) return
    const wrapper = wrapperRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') return
    const update = () => setRailHeight(wrapper.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [hasRail])

  if (!hasRail) return null

  const isHovering = mouseY !== null
  const focusedTurn = focusedIndex !== null ? turns[focusedIndex] : null
  const getPreviewText = (messageId?: string) =>
    messageId ? getTextFromParts(partsMap?.[messageId] ?? []).slice(0, PREVIEW_MAX_CHARS) : ''
  const focusedQuestion = getPreviewText(focusedTurn?.userMessageId)
  const focusedAnswer = getPreviewText(focusedTurn?.assistantMessageId)
  const cardTop =
    focusedIndex !== null
      ? Math.min(
          Math.max(geometry.centerOf(focusedIndex), PREVIEW_EDGE_INSET),
          Math.max(railHeight - PREVIEW_EDGE_INSET, PREVIEW_EDGE_INSET)
        )
      : 0

  const waveBonus = (index: number) => {
    if (mouseY === null) return 0
    const falloff = Math.max(0, 1 - Math.abs(geometry.centerOf(index) - mouseY) / HOVER_FALLOFF_DISTANCE)
    return TICK_WAVE_BONUS * falloff ** 1.5
  }

  // Fade whichever end still has ticks scrolled past it, signalling "there's
  // more" like Codex. Derived from the model — no DOM reads.
  const railViewport = Math.max(0, railHeight - RAIL_MIN_EDGE_MARGIN_PX * 2)
  const maxScroll = Math.max(0, turns.length * RAIL_TICK_PITCH_PX - railViewport)
  // hasOlder keeps the top fade on as a "more above" hint even at rest.
  const fadeTop = scrollTop > 1 || hasOlder
  const fadeBottom = scrollTop < maxScroll - 1
  const railMask =
    fadeTop || fadeBottom
      ? `linear-gradient(to bottom, ${fadeTop ? 'transparent' : 'black'} 0%, black ${fadeTop ? RAIL_FADE_PX : 0}px, black calc(100% - ${fadeBottom ? RAIL_FADE_PX : 0}px), ${fadeBottom ? 'transparent' : 'black'} 100%)`
      : undefined

  return (
    <div
      ref={wrapperRef}
      className={classNames(
        // right-4 keeps the ticks clear of the scrollbar gutter (~15px) so the
        // thumb never overlaps them while scrolling. The gutter is 15px because
        // the Scrollbar composite's inline scrollbar-color opts Chromium out of
        // the global 6px ::-webkit-scrollbar styling into the standard CSS
        // scrollbar; scrollbar-gutter:stable only keeps it reserved while hidden.
        // top-2.5 sits just below the header; bottom-8 keeps the last tick clear
        // of the very bottom edge. The composer is inset to the left of this
        // gutter, so the ticks clear it. Opacity is driven by railOpacity, which
        // already tracks width continuously, so no transition is needed.
        'group absolute top-2.5 right-4 bottom-8 z-20 w-8 select-none',
        !active && 'pointer-events-none'
      )}
      style={{ opacity: active ? railOpacity : 0 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}>
      <div
        ref={railScrollRef}
        onScroll={handleScroll}
        className={classNames(
          // The scroll viewport is inset by the fixed edge margins (top/bottom),
          // so those margins sit OUTSIDE the scroll and never move while the strip
          // scrolls. Ticks fill the viewport (centred when few) and scroll only
          // once they overflow it. It never auto-follows the conversation.
          'absolute inset-x-0 flex flex-col items-end overflow-y-auto transition-opacity duration-150 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          isHovering ? 'opacity-100' : 'opacity-70'
        )}
        style={{
          top: RAIL_MIN_EDGE_MARGIN_PX,
          bottom: RAIL_MIN_EDGE_MARGIN_PX,
          maskImage: railMask,
          WebkitMaskImage: railMask
        }}>
        <div
          className="flex w-full flex-col items-end"
          style={{ paddingTop: geometry.padTop, paddingBottom: geometry.padBottom }}>
          {turns.map((turn, index) => {
            const isActive = index === activeTurnIndex
            const isFocused = index === focusedIndex
            // The active turn is marked by color only — every tick keeps the same
            // length at rest; length changes belong to the hover wave.
            const width = isHovering
              ? isFocused
                ? TICK_PEAK_WIDTH
                : TICK_BASE_WIDTH + waveBonus(index)
              : TICK_BASE_WIDTH
            const emphasized = focusedIndex !== null ? isFocused : isActive
            return (
              <div
                key={turn.anchorId}
                data-message-anchor-tick
                data-active={isActive}
                className="flex w-full shrink-0 cursor-pointer items-center justify-end"
                style={{ height: RAIL_TICK_PITCH_PX }}
                onClick={() => scrollToMessageId?.(turn.anchorId)}>
                <div
                  className={classNames(
                    'rounded-full',
                    tickTransitionClassName,
                    isFocused ? 'h-0.5' : 'h-[1.5px]',
                    emphasized ? 'bg-foreground' : 'bg-border-hover'
                  )}
                  style={{ width }}
                />
              </div>
            )
          })}
        </div>
      </div>
      {focusedIndex !== null && (focusedQuestion || focusedAnswer) && (
        <div
          className="-translate-y-1/2 pointer-events-none absolute right-full z-30 w-max max-w-80 rounded-xl border-[0.5px] border-border bg-popover p-3 text-popover-foreground shadow-lg transition-[top] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] dark:bg-neutral-800"
          style={{ top: cardTop }}>
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
