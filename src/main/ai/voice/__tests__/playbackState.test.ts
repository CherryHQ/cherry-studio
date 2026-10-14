import { describe, expect, it } from 'vitest'

import {
  applyPlaybackCommand,
  applyPlaybackReport,
  completePlaybackSynthesis,
  createPlaybackSnapshot,
  createPlaybackState
} from '../playbackState'

const sessionId = '00000000-0000-4000-8000-000000000001'

describe('playback command and observation contract', () => {
  it('recovers a paused audio failure with a fresh playing attempt', () => {
    const ready = completePlaybackSynthesis(createPlaybackState())
    const paused = applyPlaybackCommand(ready, 'pause', true)
    const failed = applyPlaybackReport(paused, {
      sessionId,
      attemptId: ready.attemptId,
      commandRevision: ready.commandRevision,
      phase: 'failed'
    })
    expect(createPlaybackSnapshot(failed, true).availableCommands).toEqual(['retry', 'stop'])

    const retrying = applyPlaybackCommand(failed, 'retry', true)
    expect(retrying.desired).toBe('playing')
    expect(retrying.attemptId).not.toBe(failed.attemptId)
    expect(retrying.observed).not.toBe('playing')
    const playing = applyPlaybackReport(retrying, {
      sessionId,
      attemptId: retrying.attemptId,
      commandRevision: retrying.commandRevision,
      phase: 'playing'
    })
    expect(playing).toMatchObject({ observed: 'playing', pendingCommand: null })
    expect(createPlaybackSnapshot(playing, true).availableCommands).toEqual(['pause', 'stop'])
  })

  it('keeps a newer pause when an older play confirmation arrives', () => {
    const ready = completePlaybackSynthesis(createPlaybackState())
    const paused = applyPlaybackCommand(ready, 'pause', true)
    const late = applyPlaybackReport(paused, {
      sessionId,
      attemptId: ready.attemptId,
      commandRevision: ready.commandRevision,
      phase: 'playing'
    })
    expect(late).toBe(paused)
    const confirmed = applyPlaybackReport(late, {
      sessionId,
      attemptId: paused.attemptId,
      commandRevision: paused.commandRevision,
      phase: 'paused'
    })
    expect(confirmed).toMatchObject({ desired: 'paused', observed: 'paused', pendingCommand: null })
  })

  it('ignores failures and completion from the previous audio attempt', () => {
    const ready = completePlaybackSynthesis(createPlaybackState())
    const failed = applyPlaybackReport(ready, { sessionId, ...ready, phase: 'failed' })
    const retrying = applyPlaybackCommand(failed, 'retry', true)
    for (const phase of ['failed', 'ended', 'completed', 'playing'] as const) {
      expect(applyPlaybackReport(retrying, { sessionId, ...ready, phase })).toBe(retrying)
    }
    expect(applyPlaybackCommand(retrying, 'retry', true)).toBe(retrying)
  })

  it('does not lose a current audio error to a late success or pause acknowledgment', () => {
    const ready = completePlaybackSynthesis(createPlaybackState())
    const paused = applyPlaybackCommand(ready, 'pause', true)
    const failed = applyPlaybackReport(paused, { sessionId, ...ready, phase: 'failed' })
    expect(failed.failure?.stage).toBe('playback')
    expect(applyPlaybackReport(failed, { sessionId, ...paused, phase: 'paused' })).toBe(failed)
    expect(applyPlaybackReport(failed, { sessionId, ...ready, phase: 'playing' })).toBe(failed)
  })

  it('keeps stop authoritative and never advertises retry without retained audio', () => {
    const ready = completePlaybackSynthesis(createPlaybackState())
    const stopping = applyPlaybackCommand(ready, 'stop', true)
    expect(applyPlaybackReport(stopping, { sessionId, ...ready, phase: 'playing' })).toBe(stopping)
    expect(applyPlaybackReport(stopping, { sessionId, ...ready, phase: 'failed' })).toBe(stopping)
    expect(createPlaybackSnapshot(stopping, true).availableCommands).toEqual(['stop'])
    const failed = applyPlaybackReport(ready, { sessionId, ...ready, phase: 'failed' })
    expect(createPlaybackSnapshot(failed, false).availableCommands).toEqual(['stop'])
    expect(() => applyPlaybackCommand(failed, 'retry', false)).toThrow()
  })
})
