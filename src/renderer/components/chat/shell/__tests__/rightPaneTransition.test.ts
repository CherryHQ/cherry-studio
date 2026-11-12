import { describe, expect, it } from 'vitest'

import {
  getInitialPersistentRightPaneState,
  getPersistentRightPaneMotionState,
  type PersistentRightPanePhase,
  planPersistentRightPaneReconnect,
  planPersistentRightPaneTransition,
  RIGHT_PANE_CLIP_REVEALED,
  RIGHT_PANE_WIDTH_FULL,
  type RightPaneLayoutMode
} from '../rightPaneTransition'

const dockedWidth = 'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))'

function plan(currentPhase: PersistentRightPanePhase, targetMode: RightPaneLayoutMode, reduceMotion = false) {
  return planPersistentRightPaneTransition(currentPhase, targetMode, { dockedWidth, reduceMotion })
}

describe('planPersistentRightPaneTransition', () => {
  it('drops the animation duration under reduced motion', () => {
    expect(plan('docked', 'maximized', true)?.animateTo.transition).toEqual({ duration: 0 })
    expect(plan('maximized', 'docked', true)?.animateTo.transition).toEqual({ duration: 0 })
  })

  it.each([
    ['closed', 'closed'],
    ['docked', 'docked'],
    ['maximized', 'maximized']
  ] as const)('returns no plan when %s already satisfies %s', (phase, targetMode) => {
    expect(plan(phase, targetMode)).toBeNull()
  })
})

describe('planPersistentRightPaneReconnect', () => {
  it.each([
    ['closed', 'closed'],
    ['docked', 'docked'],
    ['maximized', 'maximized']
  ] as const)('restores a settled %s mode without reporting another completion', (phase, targetMode) => {
    expect(planPersistentRightPaneReconnect(phase, targetMode, dockedWidth)).toEqual({
      completedMode: undefined,
      motionState: getPersistentRightPaneMotionState(targetMode, dockedWidth),
      settledState: getInitialPersistentRightPaneState(targetMode)
    })
  })

  it.each([
    ['opening-docked', 'docked'],
    ['closing-docked', 'closed'],
    ['maximizing', 'maximized'],
    ['minimizing', 'docked'],
    ['closing-maximized', 'closed']
  ] as const)('settles an interrupted %s phase to %s and reports completion', (phase, targetMode) => {
    expect(planPersistentRightPaneReconnect(phase, targetMode, dockedWidth)).toEqual({
      completedMode: targetMode,
      motionState: getPersistentRightPaneMotionState(targetMode, dockedWidth),
      settledState: getInitialPersistentRightPaneState(targetMode)
    })
  })

  it('settles to a target that changed while effects were disconnected', () => {
    expect(planPersistentRightPaneReconnect('docked', 'maximized', dockedWidth)).toEqual({
      completedMode: 'maximized',
      motionState: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL },
      settledState: { phase: 'maximized', reservesDockedSpace: false }
    })
  })
})
