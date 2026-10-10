import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import * as voice from '../index'
import { speechPlaybackService } from '../SpeechPlaybackService'
import { VoiceDomainError } from '../VoiceService'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: vi.fn()
}))

const readTextAloud = (
  voice as typeof voice & {
    readTextAloud: (input: {
      text: string
      mode: 'selection' | 'document'
      sourceLabel: 'selection' | 'document' | 'preview'
      sourceEntityId: string
      focusOnClose?: () => void
      isCurrent?: () => boolean
    }) => Promise<void>
  }
).readTextAloud

describe('readTextAloud', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(popup.confirm).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(openSettingsTab).mockReset()
  })

  it.each([
    ['selection', 'selection'],
    ['document', 'preview']
  ] as const)('starts manual %s playback with %s provenance', async (mode, sourceLabel) => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({ status: 'started' })

    await readTextAloud({ text: 'Readable content', mode, sourceLabel, sourceEntityId: 'entity-1' })

    expect(start).toHaveBeenCalledWith({
      text: 'Readable content',
      trigger: 'manual',
      mode,
      confirmed: false,
      sourceLabel,
      sourceEntityId: 'entity-1'
    })
  })

  it('requires confirmation above 5,000 normalized characters and preserves focus', async () => {
    const start = vi
      .spyOn(speechPlaybackService, 'start')
      .mockResolvedValueOnce({ status: 'confirmation_required', normalizedLength: 5_001 })
      .mockResolvedValueOnce({ status: 'started' })
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    const focusOnClose = vi.fn()

    await readTextAloud({
      text: 'x'.repeat(5_001),
      mode: 'document',
      sourceLabel: 'document',
      sourceEntityId: 'entity-long',
      focusOnClose
    })

    expect(popup.confirm).toHaveBeenCalledWith({
      title: 'settings.voice.playback.long_text.title',
      content: 'settings.voice.playback.long_text.description',
      okText: 'common.confirm',
      cancelText: 'common.cancel',
      focusOnClose
    })
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1]?.[0]).toEqual({ ...start.mock.calls[0]?.[0], confirmed: true })
    expect(focusOnClose).toHaveBeenCalled()
  })

  it('does not start confirmed playback when the user cancels', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({
      status: 'confirmation_required',
      normalizedLength: 5_001
    })
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)

    await readTextAloud({
      text: 'x'.repeat(5_001),
      mode: 'document',
      sourceLabel: 'document',
      sourceEntityId: 'entity-long'
    })

    expect(start).toHaveBeenCalledOnce()
  })

  it('does not start or show an old action after its source context is replaced', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({
      status: 'confirmation_required',
      normalizedLength: 5_001
    })
    let current = true
    vi.mocked(popup.confirm).mockImplementationOnce(async () => {
      current = false
      return true
    })

    await readTextAloud({
      text: 'x'.repeat(5_001),
      mode: 'selection',
      sourceLabel: 'selection',
      sourceEntityId: 'old-action',
      isCurrent: () => current
    })

    expect(start).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['model_required', 'asset_required', 'unsupported', 'voice_unavailable'] as const)(
    'offers Voice Settings for %s without putting private text in feedback',
    async (reason) => {
      vi.spyOn(speechPlaybackService, 'start').mockRejectedValue(new VoiceDomainError(reason))
      const secret = 'PRIVATE_CANARY_TEXT_42'

      await readTextAloud({
        text: secret,
        mode: 'selection',
        sourceLabel: 'selection',
        sourceEntityId: 'safe-id'
      })

      const feedback = vi.mocked(toast.error).mock.calls[0]?.[0]
      expect(feedback).toEqual({
        title: reason === 'model_required' ? 'settings.voice.status.unconfigured' : `settings.voice.status.${reason}`,
        action: { label: 'settings.voice.action.open_settings', onClick: expect.any(Function) }
      })
      expect(JSON.stringify(feedback)).not.toContain(secret)
      if (feedback && typeof feedback === 'object' && 'action' in feedback) {
        await feedback.action?.onClick?.()
      }
      expect(openSettingsTab).toHaveBeenCalledWith('/settings/voice')
    }
  )

  it.each(['busy', 'aborted', 'operation_failed'] as const)(
    'shows stable %s feedback without a Settings action',
    async (reason) => {
      vi.spyOn(speechPlaybackService, 'start').mockRejectedValue(new VoiceDomainError(reason))

      await readTextAloud({
        text: 'Readable content',
        mode: 'document',
        sourceLabel: 'document',
        sourceEntityId: 'safe-id'
      })

      expect(toast.error).toHaveBeenCalledWith({
        title:
          reason === 'operation_failed'
            ? 'settings.voice.status.operation_failed'
            : `settings.voice.playback.error.${reason}`
      })
      expect(openSettingsTab).not.toHaveBeenCalled()
    }
  )
})
