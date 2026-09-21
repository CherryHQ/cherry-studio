import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { AutoReadCoordinator } from '../AutoReadCoordinator'
import type { SpeechPlaybackStartResult } from '../SpeechPlaybackService'
import { VoiceDomainError } from '../VoiceService'

const message = (id: string, text = 'natural answer'): CherryUIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      { type: 'reasoning', text: 'private reasoning' },
      { type: 'text', text },
      { type: 'dynamic-tool', toolName: 'Shell', toolCallId: 'tool-1', state: 'output-available', output: 'secret' }
    ]
  }) as CherryUIMessage

function createHarness() {
  const playback = {
    start: vi.fn(async (): Promise<SpeechPlaybackStartResult> => ({ status: 'started' })),
    stopAutoRead: vi.fn(async () => true)
  }
  const reportError = vi.fn()
  const coordinator = new AutoReadCoordinator({ playback, reportError })
  return { coordinator, playback, reportError }
}

describe('AutoReadCoordinator', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('plays only natural-language text for an eligible live completion', async () => {
    const { coordinator, playback } = createHarness()

    await expect(
      coordinator.consume({
        enabled: true,
        message: message('message-1'),
        attemptId: 7,
        isAbort: false,
        isError: false
      })
    ).resolves.toEqual({ status: 'started', key: 'auto-read:message-1:7' })

    expect(playback.start).toHaveBeenCalledWith({
      text: 'natural answer',
      trigger: 'auto_read',
      mode: 'document',
      confirmed: false,
      sourceLabel: 'message',
      sourceEntityId: 'message-1'
    })
  })

  it('claims each completion once while allowing a newer attempt', async () => {
    const { coordinator, playback } = createHarness()
    const completion = {
      enabled: true,
      message: message('message-1'),
      attemptId: 7,
      isAbort: false,
      isError: false
    }

    await coordinator.consume(completion)
    await expect(coordinator.consume(completion)).resolves.toMatchObject({ status: 'skipped', reason: 'duplicate' })
    await coordinator.consume({ ...completion, attemptId: 8 })

    expect(playback.start).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['disabled', { enabled: false }],
    ['ineligible', { eligible: false }],
    ['aborted', { isAbort: true }],
    ['failed', { isError: true }]
  ])('skips %s completions before playback', async (_label, override) => {
    const { coordinator, playback } = createHarness()
    await coordinator.consume({
      enabled: true,
      message: message(`message-${_label}`),
      attemptId: 1,
      isAbort: false,
      isError: false,
      ...override
    })
    expect(playback.start).not.toHaveBeenCalled()
  })

  it('skips user and tool-only messages', async () => {
    const { coordinator, playback } = createHarness()
    await coordinator.consume({
      enabled: true,
      message: { ...message('user-1'), role: 'user' },
      attemptId: 1,
      isAbort: false,
      isError: false
    })
    await coordinator.consume({
      enabled: true,
      message: message('tool-only', '   '),
      attemptId: 1,
      isAbort: false,
      isError: false
    })
    expect(playback.start).not.toHaveBeenCalled()
  })

  it('keeps busy and long-text skips non-blocking and does not queue', async () => {
    const { coordinator, playback, reportError } = createHarness()
    playback.start
      .mockRejectedValueOnce(new VoiceDomainError('busy'))
      .mockResolvedValueOnce({ status: 'skipped', reason: 'too_long', normalizedLength: 5_001 })

    await expect(
      coordinator.consume({
        enabled: true,
        message: message('busy'),
        attemptId: 1,
        isAbort: false,
        isError: false
      })
    ).resolves.toMatchObject({ status: 'skipped', reason: 'busy' })
    await coordinator.consume({
      enabled: true,
      message: message('long'),
      attemptId: 1,
      isAbort: false,
      isError: false
    })

    expect(playback.start).toHaveBeenCalledTimes(2)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('keeps a controller abort silent without misreporting it as busy', async () => {
    const { coordinator, playback, reportError } = createHarness()
    playback.start.mockRejectedValueOnce(new VoiceDomainError('aborted'))

    await expect(
      coordinator.consume({
        enabled: true,
        message: message('aborted-during-start'),
        attemptId: 1,
        isAbort: false,
        isError: false
      })
    ).resolves.toMatchObject({ status: 'skipped', reason: 'aborted' })
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports a stable failure once without retaining private text', async () => {
    const { coordinator, playback, reportError } = createHarness()
    const privateCanary = 'PRIVATE_TTS_CANARY_/secret/path.wav'
    playback.start.mockRejectedValue(new VoiceDomainError('voice_unavailable'))
    const completion = {
      enabled: true,
      message: message('failed-message', privateCanary),
      attemptId: 3,
      isAbort: false,
      isError: false
    }

    await coordinator.consume(completion)
    await coordinator.consume(completion)

    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith('voice_unavailable')
    expect(JSON.stringify(coordinator)).not.toContain(privateCanary)
  })

  it('stops an owned auto run only when the preference transitions off', async () => {
    const { coordinator, playback } = createHarness()

    await coordinator.setEnabled(false)
    await coordinator.setEnabled(true)
    await coordinator.setEnabled(false)
    await coordinator.setEnabled(false)

    expect(playback.stopAutoRead).toHaveBeenCalledOnce()
  })
})
