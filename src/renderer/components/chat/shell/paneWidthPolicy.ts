import { ARTIFACT_RIGHT_PANE_MIN_WIDTH, CHAT_CENTER_FLOOR_WIDTH, CHAT_CENTER_MIN_USABLE_WIDTH } from './paneLayout'

const CENTER_MIN = CHAT_CENTER_MIN_USABLE_WIDTH

/** The pane's own floor; panes declare it, so a list never inherits the artifact pane's. */
const DEFAULT_PANE_MIN = ARTIFACT_RIGHT_PANE_MIN_WIDTH

/**
 * Docked right-pane width for a given main-region width. Yield order: the pane
 * yields first (stored → PANE_MIN while the center keeps CENTER_MIN), then the
 * center yields (CENTER_MIN → floor with the pane pinned at PANE_MIN), and below
 * PANE_MIN + floor both shrink proportionally so neither ever collapses to zero.
 */
export function resolveDockedPaneWidth(available: number, resolvedWidth: number, paneMin = DEFAULT_PANE_MIN): number {
  if (available <= 0) return 0
  return Math.max(
    Math.min(resolvedWidth, available - CENTER_MIN),
    Math.min(paneMin, (available * paneMin) / (paneMin + CHAT_CENTER_FLOOR_WIDTH))
  )
}

/**
 * CSS mirror of {@link resolveDockedPaneWidth}; `100%` resolves against the
 * main-region (the pane's containing block and the spacer's flex parent).
 */
export function buildDockedPaneWidthExpression(resolvedWidth: number | string, paneMin = DEFAULT_PANE_MIN): string {
  const resolved = typeof resolvedWidth === 'number' ? `${resolvedWidth}px` : resolvedWidth
  const total = paneMin + CHAT_CENTER_FLOOR_WIDTH
  return `max(min(${resolved}, calc(100% - ${CENTER_MIN}px)), min(${paneMin}px, calc(100% * ${paneMin} / ${total})))`
}

/** The largest width pointer/keyboard resizing can currently make visible. */
export function getPaneSpaceCap(available: number, paneMin = DEFAULT_PANE_MIN): number {
  return Math.max(paneMin, available - CENTER_MIN)
}

export interface PredictCenterWidthInput {
  shellWidth: number
  listWidth: number
  /** Docked-open: presentation open and not maximized. */
  paneOpen: boolean
  paneWidth: number
  paneMin?: number
}

/**
 * Center width the layout would settle at with the list expanded — independent
 * of whether the list currently is expanded, so collapse/restore decisions have
 * no feedback loop.
 */
export function predictCenterWidth({
  shellWidth,
  listWidth,
  paneOpen,
  paneWidth,
  paneMin
}: PredictCenterWidthInput): number {
  const available = shellWidth - listWidth
  return available - (paneOpen ? resolveDockedPaneWidth(available, paneWidth, paneMin) : 0)
}

const RESTORE_HYSTERESIS = 4

/** Level-based collapse with a small restore hysteresis against float jitter. */
export function evaluateAutoCollapse(predictedCenter: number, currentlyCollapsed: boolean): boolean {
  if (predictedCenter < CENTER_MIN) return true
  if (predictedCenter >= CENTER_MIN + RESTORE_HYSTERESIS) return false
  return currentlyCollapsed
}
