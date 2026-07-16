import { describe, expect, it } from 'vitest'

import {
  getInitialPersistentRightPaneState,
  type PersistentRightPanePhase,
  planPersistentRightPaneTransition,
  RIGHT_PANE_CLIP_COLLAPSED,
  RIGHT_PANE_CLIP_REVEALED,
  type RightPaneLayoutMode
} from '../rightPaneTransition'

const dockedClip = 'inset(0% 0% 0% calc(100% - 460px))'

function plan(currentPhase: PersistentRightPanePhase, targetMode: RightPaneLayoutMode) {
  return planPersistentRightPaneTransition(currentPhase, targetMode, {
    dockedClip,
    reduceMotion: false
  })
}

describe('planPersistentRightPaneTransition', () => {
  it.each([
    ['closed', { phase: 'closed', reservesDockedSpace: false }],
    ['docked', { phase: 'docked', reservesDockedSpace: true }],
    ['maximized', { phase: 'maximized', reservesDockedSpace: false }]
  ] as const)('creates the %s initial state', (targetMode, expected) => {
    expect(getInitialPersistentRightPaneState(targetMode)).toEqual(expected)
  })

  it('plans a docked-to-maximized wipe while preserving docked space', () => {
    expect(plan('docked', 'maximized')).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1 },
      completedMode: 'maximized',
      deferUntilNextFrame: true,
      runningState: { phase: 'maximizing', reservesDockedSpace: true },
      setBeforeStart: { clipPath: dockedClip, opacity: 1 },
      settledState: { phase: 'maximized', reservesDockedSpace: false }
    })
  })

  it('plans a closed-to-maximized reveal without reserving docked space', () => {
    expect(plan('closed', 'maximized')).toMatchObject({
      runningState: { phase: 'maximizing', reservesDockedSpace: false },
      setBeforeStart: { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 1 }
    })
  })

  it('plans an interrupted maximize back to the docked strip', () => {
    expect(plan('maximizing', 'docked')).toMatchObject({
      animateTo: { clipPath: dockedClip, opacity: 1 },
      completedMode: 'docked',
      deferUntilNextFrame: false,
      runningState: { phase: 'minimizing', reservesDockedSpace: true },
      settledState: { phase: 'docked', reservesDockedSpace: true }
    })
  })

  it.each([
    ['docked', 'closing-docked'],
    ['maximizing', 'closing-maximized'],
    ['maximized', 'closing-maximized']
  ] as const)('plans %s to close through the matching layout', (phase, runningPhase) => {
    expect(plan(phase, 'closed')).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 0 },
      completedMode: 'closed',
      runningState: { phase: runningPhase, reservesDockedSpace: false },
      settledState: { phase: 'closed', reservesDockedSpace: false }
    })
  })

  it('plans a closed pane opening directly into the docked layout', () => {
    expect(plan('closed', 'docked')).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1 },
      completedMode: 'docked',
      runningState: { phase: 'opening-docked', reservesDockedSpace: true }
    })
  })

  it.each([
    ['closed', 'closed'],
    ['docked', 'docked'],
    ['maximized', 'maximized']
  ] as const)('returns no plan when %s already satisfies %s', (phase, targetMode) => {
    expect(plan(phase, targetMode)).toBeNull()
  })
})
