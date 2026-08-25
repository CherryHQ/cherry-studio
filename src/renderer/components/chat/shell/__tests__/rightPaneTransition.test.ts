import { describe, expect, it } from 'vitest'

import {
  getInitialPersistentRightPaneState,
  getPersistentRightPaneMotionState,
  getRightPanePhaseTransition,
  type PersistentRightPanePhase,
  planPersistentRightPaneReconnect,
  planPersistentRightPaneTransition,
  RIGHT_PANE_CLIP_COLLAPSED,
  RIGHT_PANE_CLIP_REVEALED,
  RIGHT_PANE_WIDTH_FULL,
  type RightPaneLayoutMode
} from '../rightPaneTransition'

const dockedWidth = 'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))'

function plan(currentPhase: PersistentRightPanePhase, targetMode: RightPaneLayoutMode, reduceMotion = false) {
  return planPersistentRightPaneTransition(currentPhase, targetMode, { dockedWidth, reduceMotion })
}

describe('planPersistentRightPaneTransition', () => {
  it.each([
    ['closed', { phase: 'closed', reservesDockedSpace: false }],
    ['docked', { phase: 'docked', reservesDockedSpace: true }],
    ['maximized', { phase: 'maximized', reservesDockedSpace: false }]
  ] as const)('creates the %s initial state', (targetMode, expected) => {
    expect(getInitialPersistentRightPaneState(targetMode)).toEqual(expected)
  })

  it('runs the docked spacer on the same transition the box runs in that phase', () => {
    // The pane's left edge and the centre's right edge travel one identical path. Giving the
    // spacer its own timing leaves the composer arriving before or after the pane it sits on.
    expect(getRightPanePhaseTransition('minimizing')).toEqual(plan('maximized', 'docked')?.animateTo.transition)
    expect(getRightPanePhaseTransition('maximizing')).toEqual(plan('docked', 'maximized')?.animateTo.transition)
    expect(getRightPanePhaseTransition('opening-docked')).toEqual(plan('closed', 'docked')?.animateTo.transition)
  })

  it('grows the box into full width and releases the docked space up front', () => {
    const maximize = plan('docked', 'maximized')

    // Wiping a clip instead would hold the box at full width from the first frame, with the pane
    // content laid out for it behind a docked-width strip, and would keep the composer covering
    // the pane at its docked width until the animation ended.
    expect(maximize).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL },
      completedMode: 'maximized',
      deferUntilNextFrame: false,
      runningState: { phase: 'maximizing', reservesDockedSpace: false },
      settledState: { phase: 'maximized', reservesDockedSpace: false }
    })
    expect(maximize?.setBeforeStart).toBeUndefined()
  })

  it('wipes a closed pane straight into full width, having no box to grow from', () => {
    expect(plan('closed', 'maximized')).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL },
      deferUntilNextFrame: true,
      runningState: { phase: 'maximizing', reservesDockedSpace: false },
      setBeforeStart: { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL }
    })
  })

  it('shrinks the box back so the docked layout arrives with the motion', () => {
    // A clip wipe holds the pane at full width for the whole animation, so its content only
    // reaches the docked layout once the box commits at the end.
    expect(plan('maximizing', 'docked')).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: dockedWidth },
      completedMode: 'docked',
      deferUntilNextFrame: false,
      runningState: { phase: 'minimizing', reservesDockedSpace: true },
      settledState: { phase: 'docked', reservesDockedSpace: true }
    })
  })

  it('gives the restore longer than the maximize, having only the pane to travel', () => {
    const restoreMs = plan('maximized', 'docked')?.animateTo.transition?.duration
    const maximizeMs = plan('docked', 'maximized')?.animateTo.transition?.duration

    expect(restoreMs).toBeGreaterThan(maximizeMs as number)
    // An open from closed is not a restore: it keeps the shared shell duration.
    expect(plan('closed', 'docked')?.animateTo.transition?.duration).toBe(maximizeMs)
    // Reduced motion overrides both.
    expect(plan('maximized', 'docked', true)?.animateTo.transition).toEqual({ duration: 0 })
  })

  it.each([
    ['docked', 'closing-docked'],
    ['maximizing', 'closing-maximized'],
    ['maximized', 'closing-maximized'],
    ['minimizing', 'closing-maximized']
  ] as const)('plans %s to close through the matching layout', (phase, runningPhase) => {
    const close = plan(phase, 'closed')

    expect(close).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 0 },
      completedMode: 'closed',
      runningState: { phase: runningPhase, reservesDockedSpace: false },
      settledState: { phase: 'closed', reservesDockedSpace: false }
    })
    // Naming a width here would resize the pane on its way out whenever the close interrupts a
    // maximize or a restore; leaving it out keeps the box where that motion had reached.
    expect(close?.animateTo).not.toHaveProperty('width')
  })

  it.each([
    ['closing-docked', 'maximized', RIGHT_PANE_WIDTH_FULL],
    ['closing-maximized', 'maximized', RIGHT_PANE_WIDTH_FULL],
    ['closing-maximized', 'docked', dockedWidth]
  ] as const)('restores %s into %s from wherever the close left it', (phase, targetMode, width) => {
    // Each reveal re-declares clip, opacity and width together, so a close caught mid-fade
    // cannot leave the pane part-collapsed, part-transparent, or stuck at the wrong width.
    expect(plan(phase, targetMode)).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width }
    })
  })

  it('plans a closed pane opening directly into the docked layout', () => {
    expect(plan('closed', 'docked')).toMatchObject({
      animateTo: { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: dockedWidth },
      completedMode: 'docked',
      runningState: { phase: 'opening-docked', reservesDockedSpace: true }
    })
  })

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

  it.each([
    ['closed', { clipPath: RIGHT_PANE_CLIP_COLLAPSED, opacity: 0, width: dockedWidth }],
    ['docked', { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: dockedWidth }],
    ['maximized', { clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1, width: RIGHT_PANE_WIDTH_FULL }]
  ] as const)('provides the canonical %s Motion state', (targetMode, expected) => {
    // A settled pane re-declares the container-relative width, so it keeps tracking the region
    // instead of holding the pixel value the last animation resolved.
    expect(getPersistentRightPaneMotionState(targetMode, dockedWidth)).toEqual(expected)
  })
})
