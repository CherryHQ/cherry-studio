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

export interface PersistentRightPaneTransitionPlan {
  animateTo: TargetAndTransition
  completedMode: RightPaneLayoutMode
  deferUntilNextFrame: boolean
  runningState: PersistentRightPaneVisualState
  setBeforeStart?: TargetAndTransition
  settledState: PersistentRightPaneVisualState
}

export const RIGHT_PANE_CLIP_COLLAPSED = 'inset(0% 0% 0% 100%)'
export const RIGHT_PANE_CLIP_REVEALED = 'inset(0% 0% 0% 0%)'

// The full-width surface reveals only the strip occupied by the docked pane, so
// maximize/minimize never blanks that region while the layout width changes.
export function getRightPaneDockedClip(width: string | number): string {
  return `inset(0% 0% 0% calc(100% - ${typeof width === 'number' ? `${width}px` : width}))`
}

export function isClosedRightPanePhase(phase: PersistentRightPanePhase): boolean {
  return phase === 'closed'
}

export function isFullWidthRightPanePhase(phase: PersistentRightPanePhase): boolean {
  return phase === 'maximizing' || phase === 'maximized' || phase === 'minimizing' || phase === 'closing-maximized'
}

export function getInitialPersistentRightPaneState(targetMode: RightPaneLayoutMode): PersistentRightPaneVisualState {
  if (targetMode === 'docked') return { phase: 'docked', reservesDockedSpace: true }
  if (targetMode === 'maximized') return { phase: 'maximized', reservesDockedSpace: false }
  return { phase: 'closed', reservesDockedSpace: false }
}

export function planPersistentRightPaneTransition(
  currentPhase: PersistentRightPanePhase,
  targetMode: RightPaneLayoutMode,
  {
    dockedClip,
    reduceMotion
  }: {
    dockedClip: string
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
    const closingFromMaximized = isFullWidthRightPanePhase(currentPhase)
    return {
      animateTo: { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 0, transition },
      completedMode: 'closed',
      deferUntilNextFrame: false,
      runningState: {
        phase: closingFromMaximized ? 'closing-maximized' : 'closing-docked',
        reservesDockedSpace: false
      },
      settledState: {
        phase: 'closed',
        reservesDockedSpace: false
      }
    }
  }

  if (targetMode === 'docked') {
    if (isFullWidthRightPanePhase(currentPhase) && !isClosedRightPanePhase(currentPhase)) {
      return {
        animateTo: { clipPath: dockedClip, opacity: 1, transition },
        completedMode: 'docked',
        deferUntilNextFrame: false,
        runningState: { phase: 'minimizing', reservesDockedSpace: true },
        settledState: { phase: 'docked', reservesDockedSpace: true }
      }
    }

    return {
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, transition },
      completedMode: 'docked',
      deferUntilNextFrame: false,
      runningState: { phase: 'opening-docked', reservesDockedSpace: true },
      settledState: { phase: 'docked', reservesDockedSpace: true }
    }
  }

  // A docked origin starts from its visible strip; a closed origin starts fully
  // collapsed. Deferring that reveal lets the full-width layout commit first.
  const resetBeforeReveal = !isFullWidthRightPanePhase(currentPhase) || isClosedRightPanePhase(currentPhase)
  const setBeforeStart = resetBeforeReveal
    ? {
        clipPath: isClosedRightPanePhase(currentPhase) ? RIGHT_PANE_CLIP_COLLAPSED : dockedClip,
        opacity: 1
      }
    : undefined

  return {
    animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, transition },
    completedMode: 'maximized',
    deferUntilNextFrame: resetBeforeReveal,
    runningState: {
      phase: 'maximizing',
      reservesDockedSpace: !isClosedRightPanePhase(currentPhase)
    },
    setBeforeStart,
    settledState: { phase: 'maximized', reservesDockedSpace: false }
  }
}
