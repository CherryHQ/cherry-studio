import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { CherryMessagePart } from '@shared/data/types/message'

import { readMessageAloud } from '../messagePlayback'
import { speechPlaybackService } from '../SpeechPlaybackService'
import { VoiceDomainError } from '../VoiceService'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: vi.fn()
}))

const parts = (...items: Array<Record<string, unknown>>) => items as CherryMessagePart[]

describe('readMessageAloud', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(openSettingsTab).mockReset()
  })

  it('sends only natural-language text parts through shared manual playback with message provenance', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({ status: 'started' })
    const messageParts = parts(
      { type: 'reasoning', text: 'private reasoning' },
      { type: 'text', text: '# Public answer' },
      { type: 'dynamic-tool', toolCallId: 'tool-1', toolName: 'read', state: 'output-available' },
      { type: 'data-terminal', data: { output: 'private terminal output' } },
      { type: 'text', text: 'Second paragraph.' },
      { type: 'file', mediaType: 'image/png', url: 'file:///private.png' }
    )

    await readMessageAloud({ messageId: 'message-42', parts: messageParts })

    expect(start).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith({
      text: '# Public answer\n\nSecond paragraph.',
      trigger: 'manual',
      mode: 'document',
      confirmed: false,
      sourceLabel: 'message',
      sourceEntityId: 'message-42'
    })
    expect(popup.confirm).not.toHaveBeenCalled()
  })

  it('does not start playback again when the user cancels the long-text confirmation', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({
      status: 'confirmation_required',
      normalizedLength: 5_001
    })
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const focusOnClose = vi.fn()

    await readMessageAloud({
      messageId: 'message-long',
      parts: parts({ type: 'text', text: 'x'.repeat(5_001) }),
      focusOnClose
    })

    expect(start).toHaveBeenCalledOnce()
    expect(popup.confirm).toHaveBeenCalledWith({
      title: 'settings.voice.playback.long_text.title',
      content: 'settings.voice.playback.long_text.description',
      okText: 'common.confirm',
      cancelText: 'common.cancel',
      focusOnClose
    })
  })

  it('reuses the exact text and starts one confirmed playback after long-text confirmation', async () => {
    const start = vi
      .spyOn(speechPlaybackService, 'start')
      .mockResolvedValueOnce({ status: 'confirmation_required', normalizedLength: 5_001 })
      .mockResolvedValueOnce({ status: 'started' })
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    const text = 'x'.repeat(5_001)

    await readMessageAloud({ messageId: 'message-long', parts: parts({ type: 'text', text }) })

    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1]?.[0]).toEqual({
      ...start.mock.calls[0]?.[0],
      confirmed: true
    })
  })

  it('does nothing for a message without a natural-language text part', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({ status: 'started' })

    await readMessageAloud({
      messageId: 'message-tool-only',
      parts: parts(
        { type: 'reasoning', text: 'private reasoning' },
        { type: 'dynamic-tool', toolCallId: 'tool-1', toolName: 'read', state: 'output-available' }
      )
    })

    expect(start).not.toHaveBeenCalled()
    expect(popup.confirm).not.toHaveBeenCalled()
  })

  it.each(['model_required', 'voice_unavailable', 'unsupported', 'asset_required', 'license_unverified'] as const)(
    'shows a Voice Settings recovery action for %s without exposing message text',
    async (reason) => {
      vi.spyOn(speechPlaybackService, 'start').mockRejectedValue(new VoiceDomainError(reason))
      const secret = 'private response that must not enter feedback'

      await readMessageAloud({ messageId: 'message-secret', parts: parts({ type: 'text', text: secret }) })

      expect(toast.error).toHaveBeenCalledOnce()
      expect(toast.error).toHaveBeenCalledWith({
        title: reason === 'model_required' ? 'settings.voice.status.unconfigured' : `settings.voice.status.${reason}`,
        action: {
          label: 'settings.voice.action.open_settings',
          onClick: expect.any(Function)
        }
      })
      const feedback = vi.mocked(toast.error).mock.calls[0]?.[0]
      expect(JSON.stringify(feedback)).not.toContain(secret)

      if (feedback && typeof feedback === 'object' && 'action' in feedback) {
        await feedback.action?.onClick?.()
      }
      expect(openSettingsTab).toHaveBeenCalledWith('/settings/voice')
    }
  )

  it.each(['busy', 'aborted'] as const)(
    'shows stable manual feedback for %s without a misleading settings action',
    async (reason) => {
      vi.spyOn(speechPlaybackService, 'start').mockRejectedValue(new VoiceDomainError(reason))

      await readMessageAloud({ messageId: 'message-1', parts: parts({ type: 'text', text: 'Answer' }) })

      expect(toast.error).toHaveBeenCalledWith({ title: `settings.voice.playback.error.${reason}` })
      expect(openSettingsTab).not.toHaveBeenCalled()
    }
  )

  it('maps unknown failures to stable operation feedback without leaking the native error', async () => {
    vi.spyOn(speechPlaybackService, 'start').mockRejectedValue(new Error('secret native adapter failure'))

    await readMessageAloud({ messageId: 'message-1', parts: parts({ type: 'text', text: 'Answer' }) })

    expect(toast.error).toHaveBeenCalledWith({ title: 'settings.voice.status.operation_failed' })
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('secret native adapter failure')
    expect(i18n.t).toBeTypeOf('function')
  })
})
