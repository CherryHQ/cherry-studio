import { ARTIFACT_RIGHT_PANE_MIN_WIDTH, CHAT_CENTER_FLOOR_WIDTH, CHAT_CENTER_MIN_USABLE_WIDTH } from './paneLayout'

const PANE_MIN = ARTIFACT_RIGHT_PANE_MIN_WIDTH
const CENTER_MIN = CHAT_CENTER_MIN_USABLE_WIDTH
const PROPORTIONAL_TOTAL = PANE_MIN + CHAT_CENTER_FLOOR_WIDTH

/**
 * Docked right-pane width for a given main-region width. Yield order: the pane
 * yields first (stored → PANE_MIN while the center keeps CENTER_MIN), then the
 * center yields (CENTER_MIN → floor with the pane pinned at PANE_MIN), and below
 * PANE_MIN + floor both shrink proportionally so neither ever collapses to zero.
 */
export function resolveDockedPaneWidth(available: number, resolvedWidth: number): number {
  if (available <= 0) return 0
  return Math.max(
    Math.min(resolvedWidth, available - CENTER_MIN),
    Math.min(PANE_MIN, (available * PANE_MIN) / PROPORTIONAL_TOTAL)
  )
}

/**
 * CSS mirror of {@link resolveDockedPaneWidth}; `100%` resolves against the
 * main-region (the pane's containing block and the spacer's flex parent).
 */
export function buildDockedPaneWidthExpression(resolvedWidth: number | string): string {
  const resolved = typeof resolvedWidth === 'number' ? `${resolvedWidth}px` : resolvedWidth
  return `max(min(${resolved}, calc(100% - ${CENTER_MIN}px)), min(${PANE_MIN}px, calc(100% * ${PANE_MIN} / ${PROPORTIONAL_TOTAL})))`
}

/** The largest width pointer/keyboard resizing can currently make visible. */
export function getPaneSpaceCap(available: number): number {
  return Math.max(PANE_MIN, available - CENTER_MIN)
}

export interface PredictCenterWidthInput {
  shellWidth: number
  listWidth: number
  /** Docked-open: presentation open and not maximized. */
  paneOpen: boolean
  paneWidth: number
}

/**
 * Center width the layout would settle at with the list expanded — independent
 * of whether the list currently is expanded, so collapse/restore decisions have
 * no feedback loop.
 */
export function predictCenterWidth({ shellWidth, listWidth, paneOpen, paneWidth }: PredictCenterWidthInput): number {
  const available = shellWidth - listWidth
  return available - (paneOpen ? resolveDockedPaneWidth(available, paneWidth) : 0)
}

const RESTORE_HYSTERESIS = 4

/** Level-based collapse with a small restore hysteresis against float jitter. */
export function evaluateAutoCollapse(predictedCenter: number, currentlyCollapsed: boolean): boolean {
  if (predictedCenter < CENTER_MIN) return true
  if (predictedCenter >= CENTER_MIN + RESTORE_HYSTERESIS) return false
  return currentlyCollapsed
}
