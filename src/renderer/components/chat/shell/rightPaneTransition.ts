import type { TargetAndTransition } from 'motion/react'

import { CHAT_SHELL_TRANSITION } from './paneLayout'

export type RightPaneLayoutMode = 'closed' | 'docked' | 'maximized'

export type PersistentRightPanePhase =
  | 'closed'
  | 'opening-docked'
  | 'docked'
  | 'closing-docked'
  | 'maximizing'
  | 'maximized'
  | 'minimizing'
  | 'closing-maximized'

export interface PersistentRightPaneVisualState {
  phase: PersistentRightPanePhase
  reservesDockedSpace: boolean
}

export type PersistentRightPaneMotionState = TargetAndTransition

export interface PersistentRightPaneTransitionPlan {
  animateTo: TargetAndTransition
  completedMode: RightPaneLayoutMode
  deferUntilNextFrame: boolean
  runningState: PersistentRightPaneVisualState
  setBeforeStart?: TargetAndTransition
  settledState: PersistentRightPaneVisualState
}

export interface PersistentRightPaneReconnectPlan {
  completedMode?: RightPaneLayoutMode
  motionState: PersistentRightPaneMotionState
  settledState: PersistentRightPaneVisualState
}

/**
 * A restore has only the pane travelling — the composer drops behind it at the click and the
 * centre is already laid out — so it needs longer than a maximize to read as one motion.
 */
const RIGHT_PANE_RESTORE_TRANSITION = { duration: 0.42, ease: CHAT_SHELL_TRANSITION.ease } as const

export const RIGHT_PANE_CLIP_COLLAPSED = 'inset(0% 0% 0% 100%)'
export const RIGHT_PANE_CLIP_REVEALED = 'inset(0% 0% 0% 0%)'
/** Resolves against the main region, so spanning it never depends on a measurement. */
export const RIGHT_PANE_WIDTH_FULL = '100%'

export function isClosedRightPanePhase(phase: PersistentRightPanePhase): boolean {
  return phase === 'closed'
}

export function isFullWidthRightPanePhase(phase: PersistentRightPanePhase): boolean {
  return phase === 'maximizing' || phase === 'maximized' || phase === 'minimizing' || phase === 'closing-maximized'
}

/**
 * The transition the pane box runs in this phase. The docked spacer rides the same one: the pane's
 * left edge and the centre's right edge travel the identical path, so they must travel it together.
 */
export function getRightPanePhaseTransition(phase: PersistentRightPanePhase) {
  return phase === 'minimizing' ? RIGHT_PANE_RESTORE_TRANSITION : CHAT_SHELL_TRANSITION
}

export function getInitialPersistentRightPaneState(targetMode: RightPaneLayoutMode): PersistentRightPaneVisualState {
  if (targetMode === 'docked') return { phase: 'docked', reservesDockedSpace: true }
  if (targetMode === 'maximized') return { phase: 'maximized', reservesDockedSpace: false }
  return { phase: 'closed', reservesDockedSpace: false }
}

export function getSettledRightPaneMode(phase: PersistentRightPanePhase): RightPaneLayoutMode | null {
  if (phase === 'closed' || phase === 'docked' || phase === 'maximized') return phase
  return null
}

export function getPersistentRightPaneMotionState(
  targetMode: RightPaneLayoutMode,
  dockedWidth: string | number
): PersistentRightPaneMotionState {
  const width = targetMode === 'maximized' ? RIGHT_PANE_WIDTH_FULL : dockedWidth

  return targetMode === 'closed'
    ? { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 0, width }
    : { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width }
}

export function planPersistentRightPaneReconnect(
  currentPhase: PersistentRightPanePhase,
  targetMode: RightPaneLayoutMode,
  dockedWidth: string | number
): PersistentRightPaneReconnectPlan {
  const settledMode = getSettledRightPaneMode(currentPhase)

  return {
    completedMode: settledMode === targetMode ? undefined : targetMode,
    motionState: getPersistentRightPaneMotionState(targetMode, dockedWidth),
    settledState: getInitialPersistentRightPaneState(targetMode)
  }
}

export function planPersistentRightPaneTransition(
  currentPhase: PersistentRightPanePhase,
  targetMode: RightPaneLayoutMode,
  {
    dockedWidth,
    reduceMotion
  }: {
    dockedWidth: string | number
    reduceMotion: boolean
  }
): PersistentRightPaneTransitionPlan | null {
  if (
    (targetMode === 'closed' && isClosedRightPanePhase(currentPhase)) ||
    (targetMode === 'docked' && currentPhase === 'docked') ||
    (targetMode === 'maximized' && currentPhase === 'maximized')
  ) {
    return null
  }

  const transition = reduceMotion ? { duration: 0 } : CHAT_SHELL_TRANSITION

  if (targetMode === 'closed') {
    // Width is left out so a close interrupting a resize keeps the box where that motion had
    // reached; committing the width its closing phase implies reads as the pane resizing again
    // on its way out.
    return {
      animateTo: { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 0, transition },
      completedMode: 'closed',
      deferUntilNextFrame: false,
      runningState: {
        phase: isFullWidthRightPanePhase(currentPhase) ? 'closing-maximized' : 'closing-docked',
        reservesDockedSpace: false
      },
      settledState: {
        phase: 'closed',
        reservesDockedSpace: false
      }
    }
  }

  // Both reveals re-declare the full target state instead of only what they expect to have
  // changed, so one that interrupts a close resumes from wherever it left the pane.
  if (targetMode === 'docked') {
    const runningPhase = isFullWidthRightPanePhase(currentPhase) ? 'minimizing' : 'opening-docked'
    return {
      // The box itself carries the shrink, so the pane content reflows into its docked layout
      // with the motion instead of committing once the motion has finished.
      animateTo: {
        clipPath: RIGHT_PANE_CLIP_REVEALED,
        opacity: 1,
        width: dockedWidth,
        transition: reduceMotion ? transition : getRightPanePhaseTransition(runningPhase)
      },
      completedMode: 'docked',
      deferUntilNextFrame: false,
      runningState: {
        phase: runningPhase,
        reservesDockedSpace: true
      },
      settledState: { phase: 'docked', reservesDockedSpace: true }
    }
  }

  // A closed pane has no box to grow from: it starts fully collapsed at its full width and the
  // clip wipes that in, deferred a frame so the full-width layout commits first.
  const revealFromClosed = isClosedRightPanePhase(currentPhase)

  return {
    animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL, transition },
    completedMode: 'maximized',
    deferUntilNextFrame: revealFromClosed,
    runningState: {
      phase: 'maximizing',
      // Released up front so the composer covering the pane widens with the click instead of
      // snapping once the box has already arrived at full width.
      reservesDockedSpace: false
    },
    setBeforeStart: revealFromClosed
      ? { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL }
      : undefined,
    settledState: { phase: 'maximized', reservesDockedSpace: false }
  }
}
