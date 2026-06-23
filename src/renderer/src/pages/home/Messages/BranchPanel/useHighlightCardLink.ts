import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useHighlightCardLink — P1-S2d item 1: bidirectional card ↔ source-highlight
 * linkage, driven entirely from outside the frozen `sourceHighlight.ts`.
 *
 * The source-passage `<span class="branch-anchor-highlight" data-branch-id=…>`
 * elements are injected into the main thread by `sourceHighlight.ts`; the branch
 * cards live in a sibling `BranchPane`. Their only shared DOM ancestor is the
 * Chat `#chat` container, whose ref the host passes in as `containerRef`.
 *
 * Mechanism (no protected file touched):
 *   - card → highlight: the card's hover handlers call `handleCardMouseEnter`,
 *     which imperatively toggles the `is-emphasized` class on the matching
 *     spans (rule lives in `index.css`, NOT in `sourceHighlight.ts`).
 *   - highlight → card: a delegated `mouseover`/`click` listener on the shared
 *     ancestor reads `data-branch-id` off the hovered span; hover emphasises the
 *     matching card (via the returned `hoveredBranchId`), click expands + scrolls
 *     it (`onActivateBranch`).
 *
 * Isolation invariant: `hoveredBranchId` is the consumer's (BranchPane) local
 * state, so hover churn re-renders only the panel — never the `<Messages>`
 * subtree. The span side is pure imperative DOM, so it does not re-render React
 * at all.
 */

const EMPHASIS_CLASS = 'is-emphasized'
const SPAN_SELECTOR = '.branch-anchor-highlight'
/** Card hovers originate inside this region; the span delegation ignores them
 *  so the card's own hover handlers stay authoritative for that direction. */
const PANEL_SELECTOR = '[data-testid="branch-pane-scroll"]'

function escapeAttrValue(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')
}

/**
 * Imperatively emphasise the source-passage spans of ONE branch (or clear all).
 * Always clears every emphasised span first so only the active branch is lit.
 */
function emphasizeSpans(branchId: string | null): void {
  document.querySelectorAll(`${SPAN_SELECTOR}.${EMPHASIS_CLASS}`).forEach((el) => el.classList.remove(EMPHASIS_CLASS))
  if (!branchId) return
  document
    .querySelectorAll(`${SPAN_SELECTOR}[data-branch-id="${escapeAttrValue(branchId)}"]`)
    .forEach((el) => el.classList.add(EMPHASIS_CLASS))
}

function branchIdOfSpan(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest(SPAN_SELECTOR)?.getAttribute('data-branch-id') ?? null
}

function isInsidePanel(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PANEL_SELECTOR) !== null
}

interface Options {
  /** Shared ancestor of both the highlight spans and the branch cards (`#chat`). */
  containerRef?: RefObject<HTMLElement | null>
  /** Click on a highlight → expand + scroll its card into view. */
  onActivateBranch: (branchId: string) => void
}

interface Result {
  /** The branch whose card should be emphasised right now (or null). */
  hoveredBranchId: string | null
  handleCardMouseEnter: (branchId: string) => void
  handleCardMouseLeave: () => void
}

export function useHighlightCardLink({ containerRef, onActivateBranch }: Options): Result {
  const [hoveredBranchId, setHoveredBranchId] = useState<string | null>(null)
  const hoveredRef = useRef<string | null>(null)

  const setHovered = useCallback((branchId: string | null) => {
    if (hoveredRef.current === branchId) return
    hoveredRef.current = branchId
    setHoveredBranchId(branchId)
    emphasizeSpans(branchId)
  }, [])

  const handleCardMouseEnter = useCallback((branchId: string) => setHovered(branchId), [setHovered])
  const handleCardMouseLeave = useCallback(() => setHovered(null), [setHovered])

  // highlight → card: delegate hover + click on the shared ancestor.
  useEffect(() => {
    const root = containerRef?.current
    if (!root) return

    const onMouseOver = (event: Event) => {
      // Card hovers are owned by the card handlers; only the main-thread side
      // (spans + surrounding text) drives the span→card direction here.
      if (isInsidePanel(event.target)) return
      setHovered(branchIdOfSpan(event.target))
    }
    const onClick = (event: Event) => {
      if (isInsidePanel(event.target)) return
      const branchId = branchIdOfSpan(event.target)
      if (branchId) onActivateBranch(branchId)
    }

    root.addEventListener('mouseover', onMouseOver)
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('mouseover', onMouseOver)
      root.removeEventListener('click', onClick)
    }
  }, [containerRef, onActivateBranch, setHovered])

  // Clear any lingering span emphasis when the panel unmounts.
  useEffect(() => () => emphasizeSpans(null), [])

  return { hoveredBranchId, handleCardMouseEnter, handleCardMouseLeave }
}
